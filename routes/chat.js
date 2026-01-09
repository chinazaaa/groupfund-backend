const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { createNotification } = require('../utils/notifications');

const router = express.Router();

// Send a message to a group
router.post('/:groupId/messages', authenticate, [
  body('message').trim().notEmpty().withMessage('Message is required'),
  body('message').isLength({ min: 1, max: 2000 }).withMessage('Message must be between 1 and 2000 characters'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { groupId } = req.params;
    const userId = req.user.id;
    const { message } = req.body;

    // Check if group exists and chat is enabled
    const groupCheck = await pool.query(
      'SELECT id, name, chat_enabled, status FROM groups WHERE id = $1',
      [groupId]
    );

    if (groupCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const group = groupCheck.rows[0];

    // Check if group is closed
    if (group.status === 'closed') {
      return res.status(403).json({ error: 'Cannot send messages to a closed group' });
    }

    // Check if chat is enabled for this group
    if (!group.chat_enabled) {
      return res.status(403).json({ error: 'Chat is not enabled for this group' });
    }

    // Check if user is an active member of the group
    const memberCheck = await pool.query(
      'SELECT id, role, status FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, userId]
    );

    if (memberCheck.rows.length === 0 || memberCheck.rows[0].status !== 'active') {
      return res.status(403).json({ error: 'You must be an active member of this group to send messages' });
    }

    // Create message
    const messageResult = await pool.query(
      `INSERT INTO group_messages (group_id, user_id, message)
       VALUES ($1, $2, $3)
       RETURNING id, group_id, user_id, message, created_at, updated_at`,
      [groupId, userId, message.trim()]
    );

    const newMessage = messageResult.rows[0];

    // Get user details for response
    const userResult = await pool.query(
      'SELECT id, name, email FROM users WHERE id = $1',
      [userId]
    );

    const user = userResult.rows[0];

    // Send notifications to other group members (optional - can be disabled if too noisy)
    // Only notify if message is not from admin (to avoid spam)
    // You can customize this logic based on your needs
    try {
      const membersResult = await pool.query(
        `SELECT DISTINCT gm.user_id, u.expo_push_token
         FROM group_members gm
         JOIN users u ON gm.user_id = u.id
         WHERE gm.group_id = $1 
           AND gm.user_id != $2 
           AND gm.status = 'active'
           AND u.is_active = true`,
        [groupId, userId]
      );

      // Send push notifications to other members (optional)
      // Uncomment if you want to notify members about new messages
      // for (const member of membersResult.rows) {
      //   if (member.expo_push_token) {
      //     await createNotification(
      //       member.user_id,
      //       'group_message',
      //       `New message in ${group.name}`,
      //       `${user.name}: ${message.substring(0, 50)}${message.length > 50 ? '...' : ''}`,
      //       groupId,
      //       userId
      //     );
      //   }
      // }
    } catch (notifError) {
      // Don't fail message creation if notification fails
      console.error('Error sending message notifications:', notifError);
    }

    res.status(201).json({
      message: 'Message sent successfully',
      data: {
        id: newMessage.id,
        group_id: newMessage.group_id,
        user: {
          id: user.id,
          name: user.name,
        },
        message: newMessage.message,
        created_at: newMessage.created_at,
        updated_at: newMessage.updated_at,
      },
    });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Server error sending message' });
  }
});

// Get messages for a group
router.get('/:groupId/messages', authenticate, async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.user.id;
    const { limit = 50, offset = 0, before } = req.query; // before is optional timestamp for pagination

    // Check if group exists and chat is enabled
    const groupCheck = await pool.query(
      'SELECT id, name, chat_enabled FROM groups WHERE id = $1',
      [groupId]
    );

    if (groupCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const group = groupCheck.rows[0];

    // Check if chat is enabled for this group
    if (!group.chat_enabled) {
      return res.status(403).json({ error: 'Chat is not enabled for this group' });
    }

    // Check if user is an active member of the group
    const memberCheck = await pool.query(
      'SELECT id, status FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, userId]
    );

    if (memberCheck.rows.length === 0 || memberCheck.rows[0].status !== 'active') {
      return res.status(403).json({ error: 'You must be an active member of this group to view messages' });
    }

    // Build query with optional before timestamp for pagination
    let query = `
      SELECT 
        gm.id,
        gm.group_id,
        gm.user_id,
        gm.message,
        gm.created_at,
        gm.updated_at,
        u.name as user_name,
        u.email as user_email
      FROM group_messages gm
      JOIN users u ON gm.user_id = u.id
      WHERE gm.group_id = $1
        AND gm.deleted_at IS NULL
    `;
    const params = [groupId];
    let paramCount = 2;

    // Add before timestamp filter if provided (for pagination)
    if (before) {
      query += ` AND gm.created_at < $${paramCount++}`;
      params.push(before);
    }

    query += ` ORDER BY gm.created_at DESC LIMIT $${paramCount++} OFFSET $${paramCount++}`;
    params.push(parseInt(limit), parseInt(offset));

    const messagesResult = await pool.query(query, params);

    // Get total count for pagination
    const countResult = await pool.query(
      'SELECT COUNT(*) as count FROM group_messages WHERE group_id = $1 AND deleted_at IS NULL',
      [groupId]
    );

    const total = parseInt(countResult.rows[0].count);

    // Format response
    const messages = messagesResult.rows.map(msg => ({
      id: msg.id,
      group_id: msg.group_id,
      user: {
        id: msg.user_id,
        name: msg.user_name,
        email: msg.user_email,
      },
      message: msg.message,
      created_at: msg.created_at,
      updated_at: msg.updated_at,
    }));

    res.json({
      messages: messages.reverse(), // Reverse to show oldest first (chronological order)
      total,
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Server error fetching messages' });
  }
});

// Delete a message (soft delete - only by message sender or group admin)
router.delete('/:groupId/messages/:messageId', authenticate, async (req, res) => {
  try {
    const { groupId, messageId } = req.params;
    const userId = req.user.id;

    // Check if group exists
    const groupCheck = await pool.query(
      'SELECT id, admin_id FROM groups WHERE id = $1',
      [groupId]
    );

    if (groupCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const group = groupCheck.rows[0];
    const isGroupAdmin = group.admin_id === userId;

    // Get message details
    const messageCheck = await pool.query(
      'SELECT id, user_id, deleted_at FROM group_messages WHERE id = $1 AND group_id = $2',
      [messageId, groupId]
    );

    if (messageCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const message = messageCheck.rows[0];

    // Check if message is already deleted
    if (message.deleted_at) {
      return res.status(400).json({ error: 'Message is already deleted' });
    }

    // Check if user is the message sender or group admin
    if (message.user_id !== userId && !isGroupAdmin) {
      return res.status(403).json({ error: 'You can only delete your own messages or be a group admin' });
    }

    // Soft delete the message
    await pool.query(
      'UPDATE group_messages SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1',
      [messageId]
    );

    res.json({ message: 'Message deleted successfully' });
  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({ error: 'Server error deleting message' });
  }
});

// Get chat status for a group (check if chat is enabled)
router.get('/:groupId/status', authenticate, async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.user.id;

    // Check if group exists
    const groupCheck = await pool.query(
      'SELECT id, name, chat_enabled, status FROM groups WHERE id = $1',
      [groupId]
    );

    if (groupCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const group = groupCheck.rows[0];

    // Check if user is a member of the group
    const memberCheck = await pool.query(
      'SELECT id, status FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, userId]
    );

    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'You must be a member of this group to view chat status' });
    }

    res.json({
      group_id: group.id,
      group_name: group.name,
      chat_enabled: group.chat_enabled === true,
      group_status: group.status,
    });
  } catch (error) {
    console.error('Get chat status error:', error);
    res.status(500).json({ error: 'Server error fetching chat status' });
  }
});

module.exports = router;

