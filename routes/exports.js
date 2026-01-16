const express = require('express');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Helper function to fetch contribution data for exports
async function fetchContributionData(userId, filters = {}) {
  const {
    groupId,
    contributionType, // 'birthday', 'subscription', 'general', or null for all
    status,
    startDate,
    endDate,
    transactionType, // 'credit' or 'debit'
  } = filters;

  const params = [];
  let paramCount = 1;

  // Build WHERE conditions
  const whereConditions = [];
  
  if (groupId) {
    whereConditions.push(`group_id = $${paramCount++}`);
    params.push(groupId);
  }

  if (status) {
    whereConditions.push(`status = $${paramCount++}`);
    params.push(status);
  }

  // Build WHERE conditions for each contribution type
  let birthdayWhere = whereConditions.length > 0 ? ` AND ${whereConditions.join(' AND ')}` : '';
  let subscriptionWhere = whereConditions.length > 0 ? ` AND ${whereConditions.join(' AND ')}` : '';
  let generalWhere = whereConditions.length > 0 ? ` AND ${whereConditions.join(' AND ')}` : '';

  // Filter by user (contributor or receiver)
  if (userId) {
    const userIdParam = `$${paramCount++}`;
    params.push(userId);
    birthdayWhere += ` AND (birthday_user_id = ${userIdParam} OR contributor_id = ${userIdParam})`;
    subscriptionWhere += ` AND contributor_id = ${userIdParam}`;
    generalWhere += ` AND contributor_id = ${userIdParam}`;
  }

  // Date range filters (use created_at as fallback if contribution_date is NULL)
  if (startDate) {
    const startParam = `$${paramCount++}`;
    params.push(startDate);
    birthdayWhere += ` AND COALESCE(bc.contribution_date, bc.created_at::DATE) >= ${startParam}`;
    subscriptionWhere += ` AND COALESCE(sc.contribution_date, sc.created_at::DATE) >= ${startParam}`;
    generalWhere += ` AND COALESCE(gc.contribution_date, gc.created_at::DATE) >= ${startParam}`;
  }

  if (endDate) {
    const endParam = `$${paramCount++}`;
    params.push(endDate);
    birthdayWhere += ` AND COALESCE(bc.contribution_date, bc.created_at::DATE) <= ${endParam}`;
    subscriptionWhere += ` AND COALESCE(sc.contribution_date, sc.created_at::DATE) <= ${endParam}`;
    generalWhere += ` AND COALESCE(gc.contribution_date, gc.created_at::DATE) <= ${endParam}`;
  }

  // Transaction type filter (for transaction join)
  let transactionTypeFilter = '';
  if (transactionType) {
    transactionTypeFilter = ` AND t.type = $${paramCount++}`;
    params.push(transactionType);
  }

  // Filter by contribution type
  if (contributionType === 'birthday') {
    subscriptionWhere = ' AND 1=0';
    generalWhere = ' AND 1=0';
  } else if (contributionType === 'subscription') {
    birthdayWhere = ' AND 1=0';
    generalWhere = ' AND 1=0';
  } else if (contributionType === 'general') {
    birthdayWhere = ' AND 1=0';
    subscriptionWhere = ' AND 1=0';
  }

  // Build the UNION query to get all contributions
  const query = `
    SELECT 
      id, amount, contribution_date, status, note, created_at,
      group_id, group_name, currency,
      birthday_user_id, birthday_user_name,
      contributor_id, contributor_name,
      receiver_id, receiver_name,
      transaction_type, contribution_type,
      subscription_period_start, subscription_period_end,
      payment_method, payment_provider, provider_transaction_id
    FROM (
      -- Birthday contributions
      SELECT 
        bc.id, bc.amount, bc.contribution_date, bc.status, bc.note, bc.created_at,
        g.id as group_id, g.name as group_name, g.currency,
        u1.id as birthday_user_id, u1.name as birthday_user_name,
        u2.id as contributor_id, u2.name as contributor_name,
        u1.id as receiver_id, u1.name as receiver_name,
        t.type as transaction_type,
        'birthday' as contribution_type,
        NULL::DATE as subscription_period_start,
        NULL::DATE as subscription_period_end,
        bc.payment_method,
        bc.payment_provider,
        bc.provider_transaction_id
      FROM birthday_contributions bc
      LEFT JOIN groups g ON bc.group_id = g.id
      LEFT JOIN users u1 ON bc.birthday_user_id = u1.id
      LEFT JOIN users u2 ON bc.contributor_id = u2.id
      LEFT JOIN transactions t ON bc.transaction_id = t.id
      WHERE 1=1 ${birthdayWhere} ${transactionTypeFilter}
      
      UNION ALL
      
      -- Subscription contributions
      SELECT 
        sc.id, sc.amount, sc.contribution_date, sc.status, sc.note, sc.created_at,
        g.id as group_id, g.name as group_name, g.currency,
        NULL::UUID as birthday_user_id, NULL::TEXT as birthday_user_name,
        u.id as contributor_id, u.name as contributor_name,
        admin_user.id as receiver_id, admin_user.name as receiver_name,
        t.type as transaction_type,
        'subscription' as contribution_type,
        sc.subscription_period_start,
        sc.subscription_period_end,
        sc.payment_method,
        sc.payment_provider,
        sc.provider_transaction_id
      FROM subscription_contributions sc
      LEFT JOIN groups g ON sc.group_id = g.id
      LEFT JOIN users u ON sc.contributor_id = u.id
      LEFT JOIN users admin_user ON g.admin_id = admin_user.id
      LEFT JOIN transactions t ON sc.transaction_id = t.id
      WHERE 1=1 ${subscriptionWhere} ${transactionTypeFilter}
      
      UNION ALL
      
      -- General contributions
      SELECT 
        gc.id, gc.amount, gc.contribution_date, gc.status, gc.note, gc.created_at,
        g.id as group_id, g.name as group_name, g.currency,
        NULL::UUID as birthday_user_id, NULL::TEXT as birthday_user_name,
        u.id as contributor_id, u.name as contributor_name,
        admin_user.id as receiver_id, admin_user.name as receiver_name,
        t.type as transaction_type,
        'general' as contribution_type,
        NULL::DATE as subscription_period_start,
        NULL::DATE as subscription_period_end,
        gc.payment_method,
        gc.payment_provider,
        gc.provider_transaction_id
      FROM general_contributions gc
      LEFT JOIN groups g ON gc.group_id = g.id
      LEFT JOIN users u ON gc.contributor_id = u.id
      LEFT JOIN users admin_user ON g.admin_id = admin_user.id
      LEFT JOIN transactions t ON gc.transaction_id = t.id
      WHERE 1=1 ${generalWhere} ${transactionTypeFilter}
    ) all_contributions
    ORDER BY contribution_date DESC, created_at DESC
  `;

  const result = await pool.query(query, params);
  
  return result.rows.map(contribution => ({
    ...contribution,
    amount: parseFloat(contribution.amount),
  }));
}

// Helper function to calculate tax summary
function calculateTaxSummary(contributions) {
  const summary = {
    totalContributions: contributions.length,
    totalAmount: 0,
    totalReceived: 0,
    totalSent: 0,
    byType: {
      birthday: { count: 0, amount: 0 },
      subscription: { count: 0, amount: 0 },
      general: { count: 0, amount: 0 },
    },
    byCurrency: {},
    byStatus: {},
    dateRange: {
      earliest: null,
      latest: null,
    },
  };

  contributions.forEach(contribution => {
    const amount = contribution.amount;
    const currency = contribution.currency || 'NGN';

    summary.totalAmount += amount;

    if (contribution.transaction_type === 'credit') {
      summary.totalReceived += amount;
    } else if (contribution.transaction_type === 'debit') {
      summary.totalSent += amount;
    }

    // By type
    const type = contribution.contribution_type;
    if (summary.byType[type]) {
      summary.byType[type].count++;
      summary.byType[type].amount += amount;
    }

    // By currency
    if (!summary.byCurrency[currency]) {
      summary.byCurrency[currency] = { count: 0, amount: 0 };
    }
    summary.byCurrency[currency].count++;
    summary.byCurrency[currency].amount += amount;

    // By status
    const status = contribution.status || 'unknown';
    if (!summary.byStatus[status]) {
      summary.byStatus[status] = { count: 0, amount: 0 };
    }
    summary.byStatus[status].count++;
    summary.byStatus[status].amount += amount;

    // Date range
    const date = new Date(contribution.contribution_date || contribution.created_at);
    if (!summary.dateRange.earliest || date < summary.dateRange.earliest) {
      summary.dateRange.earliest = date;
    }
    if (!summary.dateRange.latest || date > summary.dateRange.latest) {
      summary.dateRange.latest = date;
    }
  });

  return summary;
}

// Export contributions as CSV
router.get('/contributions/csv', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { groupId, contributionType, status, startDate, endDate, transactionType } = req.query;

    const contributions = await fetchContributionData(userId, {
      groupId,
      contributionType,
      status,
      startDate,
      endDate,
      transactionType,
    });

    // Generate CSV content
    const headers = [
      'Date',
      'Type',
      'Status',
      'Amount',
      'Currency',
      'Group',
      'Contributor',
      'Receiver',
      'Payment Method',
      'Payment Provider',
      'Transaction ID',
      'Note',
    ];

    const csvRows = [headers.join(',')];

    contributions.forEach(contribution => {
      const row = [
        contribution.contribution_date || contribution.created_at,
        contribution.contribution_type,
        contribution.status,
        contribution.amount,
        contribution.currency || 'NGN',
        `"${(contribution.group_name || '').replace(/"/g, '""')}"`,
        `"${(contribution.contributor_name || '').replace(/"/g, '""')}"`,
        `"${(contribution.receiver_name || contribution.birthday_user_name || '').replace(/"/g, '""')}"`,
        contribution.payment_method || 'manual',
        contribution.payment_provider || '',
        contribution.provider_transaction_id || '',
        `"${((contribution.note || '').replace(/"/g, '""'))}"`,
      ];
      csvRows.push(row.join(','));
    });

    const csvContent = csvRows.join('\n');
    const filename = `contributions_export_${new Date().toISOString().split('T')[0]}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvContent);
  } catch (error) {
    console.error('CSV export error:', error);
    res.status(500).json({ error: 'Server error generating CSV export' });
  }
});

// Export contributions as Excel
router.get('/contributions/excel', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { groupId, contributionType, status, startDate, endDate, transactionType } = req.query;

    const contributions = await fetchContributionData(userId, {
      groupId,
      contributionType,
      status,
      startDate,
      endDate,
      transactionType,
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Contributions');

    // Define columns
    worksheet.columns = [
      { header: 'Date', key: 'date', width: 20 },
      { header: 'Type', key: 'type', width: 15 },
      { header: 'Status', key: 'status', width: 15 },
      { header: 'Amount', key: 'amount', width: 15 },
      { header: 'Currency', key: 'currency', width: 10 },
      { header: 'Group', key: 'group', width: 30 },
      { header: 'Contributor', key: 'contributor', width: 25 },
      { header: 'Receiver', key: 'receiver', width: 25 },
      { header: 'Payment Method', key: 'paymentMethod', width: 15 },
      { header: 'Payment Provider', key: 'paymentProvider', width: 15 },
      { header: 'Transaction ID', key: 'transactionId', width: 30 },
      { header: 'Note', key: 'note', width: 40 },
    ];

    // Style header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' },
    };

    // Add data rows
    contributions.forEach(contribution => {
      worksheet.addRow({
        date: contribution.contribution_date || contribution.created_at,
        type: contribution.contribution_type,
        status: contribution.status,
        amount: contribution.amount,
        currency: contribution.currency || 'NGN',
        group: contribution.group_name || '',
        contributor: contribution.contributor_name || '',
        receiver: contribution.receiver_name || contribution.birthday_user_name || '',
        paymentMethod: contribution.payment_method || 'manual',
        paymentProvider: contribution.payment_provider || '',
        transactionId: contribution.provider_transaction_id || '',
        note: contribution.note || '',
      });
    });

    // Add summary sheet
    const summarySheet = workbook.addWorksheet('Summary');
    const taxSummary = calculateTaxSummary(contributions);

    summarySheet.columns = [
      { header: 'Metric', key: 'metric', width: 30 },
      { header: 'Value', key: 'value', width: 30 },
    ];

    summarySheet.getRow(1).font = { bold: true };
    summarySheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' },
    };

    summarySheet.addRow({ metric: 'Total Contributions', value: taxSummary.totalContributions });
    summarySheet.addRow({ metric: 'Total Amount', value: taxSummary.totalAmount });
    summarySheet.addRow({ metric: 'Total Received', value: taxSummary.totalReceived });
    summarySheet.addRow({ metric: 'Total Sent', value: taxSummary.totalSent });
    summarySheet.addRow({ metric: '', value: '' }); // Empty row
    summarySheet.addRow({ metric: 'Earliest Date', value: taxSummary.dateRange.earliest });
    summarySheet.addRow({ metric: 'Latest Date', value: taxSummary.dateRange.latest });
    summarySheet.addRow({ metric: '', value: '' }); // Empty row

    // By type
    summarySheet.addRow({ metric: 'By Type', value: '' });
    Object.entries(taxSummary.byType).forEach(([type, data]) => {
      summarySheet.addRow({ metric: `  ${type}`, value: `${data.count} contributions - ${data.amount}` });
    });

    // By currency
    summarySheet.addRow({ metric: '', value: '' });
    summarySheet.addRow({ metric: 'By Currency', value: '' });
    Object.entries(taxSummary.byCurrency).forEach(([currency, data]) => {
      summarySheet.addRow({ metric: `  ${currency}`, value: `${data.count} contributions - ${data.amount}` });
    });

    const filename = `contributions_export_${new Date().toISOString().split('T')[0]}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Excel export error:', error);
    res.status(500).json({ error: 'Server error generating Excel export' });
  }
});

// Export contributions as PDF with tax-ready summary
router.get('/contributions/pdf', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { groupId, contributionType, status, startDate, endDate, transactionType } = req.query;

    // Get user info for header
    const userResult = await pool.query('SELECT name, email FROM users WHERE id = $1', [userId]);
    const userName = userResult.rows[0]?.name || 'User';
    const userEmail = userResult.rows[0]?.email || '';

    const contributions = await fetchContributionData(userId, {
      groupId,
      contributionType,
      status,
      startDate,
      endDate,
      transactionType,
    });

    const taxSummary = calculateTaxSummary(contributions);

    const doc = new PDFDocument({ margin: 50 });
    const filename = `contributions_export_${new Date().toISOString().split('T')[0]}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    doc.pipe(res);

    // Header
    doc.fontSize(20).text('Contribution Report', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Generated: ${new Date().toLocaleDateString()}`, { align: 'center' });
    doc.fontSize(10).text(`For: ${userName}${userEmail ? ` (${userEmail})` : ''}`, { align: 'center' });
    doc.moveDown(2);

    // Tax Summary Section
    doc.fontSize(16).text('Tax Summary', { underline: true });
    doc.moveDown();
    doc.fontSize(11);

    doc.text(`Total Contributions: ${taxSummary.totalContributions}`);
    doc.text(`Total Amount: ${taxSummary.totalAmount.toFixed(2)}`);
    doc.text(`Total Received: ${taxSummary.totalReceived.toFixed(2)}`);
    doc.text(`Total Sent: ${taxSummary.totalSent.toFixed(2)}`);
    doc.moveDown();

    if (taxSummary.dateRange.earliest && taxSummary.dateRange.latest) {
      doc.text(`Period: ${taxSummary.dateRange.earliest.toLocaleDateString()} to ${taxSummary.dateRange.latest.toLocaleDateString()}`);
      doc.moveDown();
    }

    // By Type
    doc.text('By Contribution Type:');
    doc.moveDown(0.5);
    Object.entries(taxSummary.byType).forEach(([type, data]) => {
      if (data.count > 0) {
        doc.text(`  ${type.charAt(0).toUpperCase() + type.slice(1)}: ${data.count} contributions - ${data.amount.toFixed(2)}`, { indent: 20 });
      }
    });
    doc.moveDown();

    // By Currency
    doc.text('By Currency:');
    doc.moveDown(0.5);
    Object.entries(taxSummary.byCurrency).forEach(([currency, data]) => {
      doc.text(`  ${currency}: ${data.count} contributions - ${data.amount.toFixed(2)}`, { indent: 20 });
    });
    doc.moveDown(2);

    // Detailed Contributions Section
    doc.fontSize(16).text('Detailed Contributions', { underline: true });
    doc.moveDown();

    let yPosition = doc.y;
    const pageWidth = doc.page.width - 100;
    const pageHeight = doc.page.height - 100;
    const rowHeight = 60;
    let firstRow = true;

    contributions.forEach((contribution, index) => {
      // Check if we need a new page
      if (yPosition + rowHeight > pageHeight) {
        doc.addPage();
        yPosition = 50;
        firstRow = true;
      }

      if (!firstRow) {
        doc.moveTo(50, yPosition).lineTo(pageWidth + 50, yPosition).stroke();
        yPosition += 5;
      }

      doc.fontSize(10);
      const dateStr = contribution.contribution_date || contribution.created_at;
      const date = new Date(dateStr).toLocaleDateString();
      
      doc.text(`Date: ${date}`, 50, yPosition);
      doc.text(`Type: ${contribution.contribution_type}`, 50, yPosition + 15);
      doc.text(`Status: ${contribution.status}`, 50, yPosition + 30);
      doc.text(`Amount: ${contribution.amount.toFixed(2)} ${contribution.currency || 'NGN'}`, 250, yPosition);

      if (contribution.group_name) {
        doc.text(`Group: ${contribution.group_name}`, 250, yPosition + 15);
      }
      if (contribution.contributor_name) {
        doc.text(`Contributor: ${contribution.contributor_name}`, 250, yPosition + 30);
      }

      const receiverName = contribution.receiver_name || contribution.birthday_user_name;
      if (receiverName) {
        doc.text(`Receiver: ${receiverName}`, 450, yPosition);
      }

      if (contribution.note) {
        doc.fontSize(9).text(`Note: ${contribution.note}`, 50, yPosition + 45, { width: pageWidth });
      }

      yPosition += rowHeight;
      firstRow = false;

      if (index < contributions.length - 1) {
        doc.moveDown(0.5);
      }
    });

    // Footer
    doc.fontSize(8).text(
      `This report was generated on ${new Date().toLocaleString()} and contains ${contributions.length} contribution records.`,
      50,
      doc.page.height - 50,
      { align: 'center', width: pageWidth }
    );

    doc.end();
  } catch (error) {
    console.error('PDF export error:', error);
    res.status(500).json({ error: 'Server error generating PDF export' });
  }
});

// Get export options/info endpoint
router.get('/contributions/info', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { groupId, contributionType, status, startDate, endDate, transactionType } = req.query;

    const contributions = await fetchContributionData(userId, {
      groupId,
      contributionType,
      status,
      startDate,
      endDate,
      transactionType,
    });

    const taxSummary = calculateTaxSummary(contributions);

    res.json({
      totalContributions: contributions.length,
      summary: taxSummary,
      exportFormats: ['csv', 'excel', 'pdf'],
      filters: {
        groupId: groupId || null,
        contributionType: contributionType || null,
        status: status || null,
        startDate: startDate || null,
        endDate: endDate || null,
        transactionType: transactionType || null,
      },
    });
  } catch (error) {
    console.error('Export info error:', error);
    res.status(500).json({ error: 'Server error fetching export info' });
  }
});

module.exports = router;
