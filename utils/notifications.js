const pool = require('../config/database');
const { Expo } = require('expo-server-sdk');

// Create a new Expo SDK client
// If EXPO_ACCESS_TOKEN is provided, use it for better reliability and FCM support
const expo = new Expo({
  accessToken: process.env.EXPO_ACCESS_TOKEN,
});

/**
 * Send push notification to a user
 * @param {string} pushToken - Expo push token
 * @param {string} title - Notification title
 * @param {string} body - Notification body
 * @param {object} data - Optional data payload
 */
async function sendPushNotification(pushToken, title, body, data = {}) {
  try {
    // Check that all push tokens appear to be valid Expo push tokens
    if (!Expo.isExpoPushToken(pushToken)) {
      console.error(`Push token ${pushToken} is not a valid Expo push token`);
      return;
    }

    // Construct the message
    const messages = [
      {
        to: pushToken,
        sound: 'default',
        title: title,
        body: body,
        data: data,
        priority: 'high',
        channelId: 'default',
      },
    ];

    // Send the notification
    const chunks = expo.chunkPushNotifications(messages);
    const tickets = [];

    for (const chunk of chunks) {
      try {
        const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);
      } catch (error) {
        console.error('Error sending push notification chunk:', error);
      }
    }

    // Check for errors in tickets
    for (const ticket of tickets) {
      if (ticket.status === 'error') {
        console.error('Push notification error:', ticket.message);
        if (ticket.details && ticket.details.error) {
          console.error('Error details:', ticket.details.error);
        }
      }
    }

    return tickets;
  } catch (error) {
    console.error('Error sending push notification:', error);
    // Don't throw - push notifications are non-critical
  }
}

/**
 * Create a notification for a user and send push notification if token exists
 * @param {string} userId - The user to notify
 * @param {string} type - Notification type: 'group_invite', 'group_approved', 'group_rejected', 'group_removed', 'contribution_paid', 'contribution_confirmed', 'contribution_not_received', 'contribution_amount_updated', 'birthday_reminder', 'birthday_wish', 'wishlist_claim', 'wishlist_unclaim', 'wishlist_fulfilled'
 * @param {string} title - Notification title
 * @param {string} message - Notification message
 * @param {string} groupId - Optional group ID
 * @param {string} relatedUserId - Optional related user ID (for birthday reminders, contributions)
 */
async function createNotification(userId, type, title, message, groupId = null, relatedUserId = null) {
  try {
    // Create in-app notification
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, message, group_id, related_user_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, type, title, message, groupId, relatedUserId]
    );

    // Get user's push token
    const userResult = await pool.query(
      'SELECT expo_push_token FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length > 0 && userResult.rows[0].expo_push_token) {
      const pushToken = userResult.rows[0].expo_push_token;

      // Determine navigation data based on notification type
      let screen = 'Notifications';
      let params = {};

      if (groupId) {
        if (type === 'group_invite' || type === 'group_approved' || type === 'group_rejected' || type === 'group_removed') {
          screen = 'GroupsList';
        } else {
          screen = 'GroupView';
          params = { groupId };
        }
      }

      if (type === 'contribution_paid' || type === 'contribution_confirmed' || type === 'contribution_not_received') {
        screen = 'ContributionHistory';
        if (groupId) {
          params = { groupId };
        }
      }

      if (type === 'contribution_amount_updated') {
        screen = 'GroupView';
        if (groupId) {
          params = { groupId };
        }
      }

      if (type === 'birthday_reminder' || type === 'birthday_wish' || type === 'monthly_newsletter') {
        screen = 'Home';
        params = {};
      }

      if (type === 'wishlist_claim' || type === 'wishlist_unclaim' || type === 'wishlist_fulfilled') {
        screen = 'Wishlist';
        if (relatedUserId) {
          params = { userId: relatedUserId };
        }
      }

      // Send push notification
      await sendPushNotification(
        pushToken,
        title,
        message,
        {
          screen,
          params,
          notificationType: type,
          groupId: groupId || null,
          relatedUserId: relatedUserId || null,
        }
      );
    }
  } catch (error) {
    console.error('Error creating notification:', error);
    // Don't throw - notifications are non-critical
  }
}

module.exports = {
  createNotification,
  sendPushNotification,
};
