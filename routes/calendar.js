const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');
const {
  generateBirthdayEvent,
  generateSubscriptionEvent,
  generateGeneralGroupEvent,
  generateCalendar
} = require('../utils/ical');

const router = express.Router();

/**
 * Calendar-specific authentication middleware
 * Supports tokens in both Authorization header (Bearer token) and query parameter
 * This is needed because calendar apps may not support custom headers
 */
const authenticateCalendar = async (req, res, next) => {
  try {
    // Try to get token from Authorization header first
    let token = req.headers.authorization?.split(' ')[1]; // Bearer TOKEN
    
    // If not in header, try query parameter (for calendar app compatibility)
    if (!token && req.query.token) {
      token = req.query.token;
    }
    
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Verify user still exists and is active
    const result = await pool.query('SELECT id, email, name, is_admin, is_active FROM users WHERE id = $1', [decoded.userId]);
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    // Check if account is active
    if (result.rows[0].is_active === false) {
      return res.status(403).json({ error: 'Your account has been deactivated. Please contact support.' });
    }

    req.user = result.rows[0];
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    res.status(500).json({ error: 'Authentication error' });
  }
};

// Helper function to get deadline date, handling months with fewer days (same as in groups.js)
function getDeadlineDate(year, month, deadlineDay) {
  const lastDay = new Date(year, month + 1, 0).getDate();
  const actualDay = Math.min(deadlineDay, lastDay);
  return new Date(year, month, actualDay);
}

/**
 * Generate calendar feed content
 * Shared function for all calendar endpoints
 */
async function generateCalendarFeed(req, res, eventType = 'all') {
  try {
    const userId = req.user.id;
    const { groupId } = req.query;
    const domain = process.env.DOMAIN || 'groupfund.app';
    
    const events = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;
    const currentDay = today.getDate();
    
    // Get all active groups the user is a member of
    let groupsQuery = `
      SELECT g.*, gm.role, gm.status as member_status
      FROM groups g
      JOIN group_members gm ON g.id = gm.group_id
      WHERE gm.user_id = $1 AND gm.status = 'active'
    `;
    const groupsParams = [userId];
    
    if (groupId) {
      groupsQuery += ` AND g.id = $2`;
      groupsParams.push(groupId);
    }
    
    const groupsResult = await pool.query(groupsQuery, groupsParams);
    const groups = groupsResult.rows;
    
    // Process birthday events
    if (eventType === 'birthday' || eventType === 'all') {
      for (const group of groups.filter(g => g.group_type === 'birthday')) {
        // Get all active members in this group (excluding current user)
        const membersResult = await pool.query(
          `SELECT u.id, u.name, u.birthday
           FROM users u
           JOIN group_members gm ON u.id = gm.user_id
           WHERE gm.group_id = $1 AND gm.status = 'active' AND u.birthday IS NOT NULL AND u.id != $2`,
          [group.id, userId]
        );
        
        for (const member of membersResult.rows) {
          const birthdayEvent = generateBirthdayEvent({
            userId: member.id,
            userName: member.name,
            birthdayDate: member.birthday,
            groupId: group.id,
            groupName: group.name,
            currency: group.currency,
            contributionAmount: parseFloat(group.contribution_amount || 0),
            reminderDays: [7, 1] // Reminders 7 days and 1 day before
          }, { domain });
          
          events.push(birthdayEvent);
        }
      }
    }
    
    // Process subscription events
    if (eventType === 'subscription' || eventType === 'all') {
      for (const group of groups.filter(g => g.group_type === 'subscription')) {
        if (!group.subscription_deadline_day) continue;
        
        // Calculate next subscription deadline
        let nextDeadline;
        
        if (group.subscription_frequency === 'monthly') {
          if (currentDay <= group.subscription_deadline_day) {
            nextDeadline = getDeadlineDate(currentYear, currentMonth - 1, group.subscription_deadline_day);
          } else {
            nextDeadline = getDeadlineDate(currentYear, currentMonth, group.subscription_deadline_day);
          }
        } else {
          // Annual
          if (currentMonth < group.subscription_deadline_month || 
              (currentMonth === group.subscription_deadline_month && currentDay <= group.subscription_deadline_day)) {
            nextDeadline = getDeadlineDate(currentYear, group.subscription_deadline_month - 1, group.subscription_deadline_day);
          } else {
            nextDeadline = getDeadlineDate(currentYear + 1, group.subscription_deadline_month - 1, group.subscription_deadline_day);
          }
        }
        
        const subscriptionEvent = generateSubscriptionEvent({
          groupId: group.id,
          groupName: group.name,
          subscriptionPlatform: group.subscription_platform,
          subscriptionFrequency: group.subscription_frequency,
          subscriptionDeadlineDay: group.subscription_deadline_day,
          subscriptionDeadlineMonth: group.subscription_deadline_month,
          currency: group.currency,
          contributionAmount: parseFloat(group.contribution_amount || 0),
          reminderDays: [7, 1] // Reminders 7 days and 1 day before
        }, { domain });
        
        events.push(subscriptionEvent);
      }
    }
    
    // Process general group events
    if (eventType === 'general' || eventType === 'all') {
      for (const group of groups.filter(g => g.group_type === 'general' && g.deadline)) {
        const generalEvent = generateGeneralGroupEvent({
          groupId: group.id,
          groupName: group.name,
          deadline: group.deadline,
          currency: group.currency,
          contributionAmount: parseFloat(group.contribution_amount || 0),
          reminderDays: [7, 1] // Reminders 7 days and 1 day before
        }, { domain });
        
        if (generalEvent) { // Only add if deadline hasn't passed
          events.push(generalEvent);
        }
      }
    }
    
    // Generate the calendar file
    const calendarContent = generateCalendar(events, {
      name: `GroupFund Calendar${groupId ? ' - Group' : ''}`,
      description: 'Birthdays and deadlines from GroupFund',
      prodId: '-//GroupFund//Calendar//EN',
      domain
    });
    
    // Set appropriate headers for iCal file
    // Note: Do NOT use Content-Disposition: attachment for calendar subscriptions
    // Google Calendar and other apps expect inline content for subscribed feeds
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600'); // Allow caching but refresh hourly
    res.setHeader('X-Content-Type-Options', 'nosniff');
    
    res.send(calendarContent);
  } catch (error) {
    console.error('Calendar feed error:', error);
    res.status(500).json({ error: 'Server error generating calendar feed' });
  }
}

/**
 * Get calendar feed for all events (birthdays, subscription deadlines, general group deadlines)
 * Returns an iCal file that can be subscribed to in calendar apps
 * Supports authentication via Bearer token in header or token in query parameter
 */
router.get('/feed', authenticateCalendar, async (req, res) => {
  const eventType = req.query.eventType || 'all';
  return generateCalendarFeed(req, res, eventType);
});

/**
 * Get calendar feed URL for a user
 * This returns a URL that can be subscribed to in calendar apps
 */
router.get('/url', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const baseUrl = process.env.BASE_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(400).json({ error: 'Authentication token required' });
    }
    
    // Construct the calendar feed URL
    const calendarUrl = `${baseUrl}/api/calendar/feed?token=${encodeURIComponent(token)}`;
    
    res.json({
      calendarUrl,
      instructions: {
        google: 'Copy the calendar URL and go to Google Calendar > Settings > Add calendar > From URL, then paste the URL',
        apple: 'Copy the calendar URL and open it in Safari, then follow the prompts to subscribe',
        outlook: 'Copy the calendar URL and go to Outlook Calendar > Add calendar > Subscribe from web, then paste the URL'
      }
    });
  } catch (error) {
    console.error('Calendar URL error:', error);
    res.status(500).json({ error: 'Server error generating calendar URL' });
  }
});

/**
 * Get calendar feed for birthdays only
 */
router.get('/birthdays', authenticate, async (req, res) => {
  return generateCalendarFeed(req, res, 'birthday');
});

/**
 * Get calendar feed for subscription deadlines only
 */
router.get('/subscriptions', authenticate, async (req, res) => {
  return generateCalendarFeed(req, res, 'subscription');
});

/**
 * Get calendar feed for general group deadlines only
 */
router.get('/general', authenticate, async (req, res) => {
  return generateCalendarFeed(req, res, 'general');
});

/**
 * Alternative endpoint: Subscribe with token in query parameter (for calendar app compatibility)
 * This allows calendar apps to subscribe without Bearer token in header
 * Alias for /feed with explicit token support in query parameter
 */
router.get('/subscribe', authenticateCalendar, async (req, res) => {
  const eventType = req.query.eventType || 'all';
  return generateCalendarFeed(req, res, eventType);
});

module.exports = router;
