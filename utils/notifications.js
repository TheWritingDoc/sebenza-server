const { prisma } = require('../db');

/**
 * Send a notification to a user (persist + emit if online).
 * @param {Object} io - Socket.IO server instance
 * @param {Map} onlineUsers - Map<userId, socketId>
 * @param {string} userId - Target user ID
 * @param {Object} payload - { type, title, message, jobId?, data? }
 */
async function sendNotification(io, onlineUsers, userId, payload) {
  try {
    const notif = await prisma.notification.create({
      data: {
        userId: String(userId),
        type: payload.type,
        title: payload.title,
        message: payload.message,
        jobId: payload.jobId ? String(payload.jobId) : null,
        data: payload.data || undefined
      }
    });

    const sid = onlineUsers?.get(String(userId));
    if (io && sid) {
      io.to(sid).emit('notification', {
        _id: notif.id,
        type: notif.type,
        title: notif.title,
        message: notif.message,
        jobId: notif.jobId || null,
        data: notif.data,
        createdAt: notif.createdAt,
        read: false,
        priority: payload.priority || 'normal',
        vibrate: payload.vibrate !== false,
        sound: payload.sound !== false,
        requireInteraction: payload.requireInteraction || false
      });
    } else if (!sid) {
      console.log(`[Notify] User ${userId} offline — persisted only`);
    }
    return notif;
  } catch (err) {
    console.error(`[Notify] Failed to send notification to ${userId}:`, err.message);
    throw err;
  }
}

/**
 * Send same notification to multiple users.
 */
async function sendNotificationBulk(io, onlineUsers, userIds, payload) {
  const results = [];
  for (const uid of userIds) {
    results.push(await sendNotification(io, onlineUsers, uid, payload));
  }
  return results;
}

module.exports = { sendNotification, sendNotificationBulk };
