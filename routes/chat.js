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

    // Detect mentions in the message (@username format)
    // Extract all @mentions from the message - supports @FirstName, @FirstName LastName, @FullName
    // Matches @ followed by word characters and spaces (until next space or end)
    const mentionRegex = /@([\w\s]+?)(?=\s|$|@)/g;
    const mentions = [];
    let match;
    while ((match = mentionRegex.exec(message)) !== null) {
      const mentionText = match[1].trim().toLowerCase();
      if (mentionText.length > 0) {
        mentions.push(mentionText);
      }
    }

    // Send notifications to mentioned users
    if (mentions.length > 0) {
      try {
        // Get all active group members with their names
        const membersResult = await pool.query(
          `SELECT DISTINCT gm.user_id, u.name, u.expo_push_token, u.id
           FROM group_members gm
           JOIN users u ON gm.user_id = u.id
           WHERE gm.group_id = $1 
             AND gm.status = 'active'
             AND u.is_active = true`,
          [groupId]
        );

        // Find mentioned users by matching names (case-insensitive, supports partial matches)
        const mentionedUserIds = new Set();
        for (const member of membersResult.rows) {
          const memberNameLower = member.name.toLowerCase();
          // Check if any mention matches this member's name
          for (const mention of mentions) {
            // Match if:
            // 1. Mention exactly matches the full name
            // 2. Mention matches the first word(s) of the name (e.g., @John matches "John Doe")
            // 3. Mention is contained in the name (for partial matches)
            const nameWords = memberNameLower.split(/\s+/);
            const mentionWords = mention.split(/\s+/);
            
            // Exact match
            if (memberNameLower === mention) {
              if (member.id !== userId) {
                mentionedUserIds.add(member.id);
              }
              break;
            }
            
            // Check if mention matches the beginning of the name
            // e.g., "@John" matches "John Doe", "@John Doe" matches "John Doe Smith"
            if (nameWords.length >= mentionWords.length) {
              const nameStart = nameWords.slice(0, mentionWords.length).join(' ');
              if (nameStart === mention) {
                if (member.id !== userId) {
                  mentionedUserIds.add(member.id);
                }
                break;
              }
            }
          }
        }

        // Send notifications to mentioned users
        for (const mentionedUserId of mentionedUserIds) {
          const mentionedMember = membersResult.rows.find(m => m.id === mentionedUserId);
          if (mentionedMember) {
            await createNotification(
              mentionedUserId,
              'chat_mention',
              `You were mentioned in ${group.name}`,
              `${user.name} mentioned you: ${message.substring(0, 100)}${message.length > 100 ? '...' : ''}`,
              groupId,
              userId
            );
          }
        }
      } catch (notifError) {
        // Don't fail message creation if notification fails
        console.error('Error sending mention notifications:', notifError);
      }
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

