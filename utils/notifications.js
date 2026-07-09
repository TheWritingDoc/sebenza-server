const { prisma } = require('../db');

// A single job moves through these steps in order. When a NEW step notification
// arrives for a job, the recipient's earlier UNREAD step notifications for that
// same job are stale (they've already moved on) — we mark them read and tell the
// client to clear them from the screen. This is what stops the pile-up of
// "Confirm now" / "Job started" messages that no longer apply.
const STEP_TYPES = new Set([
  'application_received',
  'application_approved',
  'negotiation_updated',
  'offer_accepted',
  'offer_rejected',
  'schedule_confirmed',
  'schedule_declined',
  'job_started',
  'completion_requested',
  'job_pending_payment',
  'payment_confirmed',
  'job_completed',
]);

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

    // Supersede: mark this user's earlier unread STEP notifications for the same
    // job as read so only the current step shows. The socket payload carries
    // `supersedeJob` so an online client can clear the stale toasts instantly.
    let supersede = false;
    if (payload.jobId && STEP_TYPES.has(payload.type)) {
      try {
        const r = await prisma.notification.updateMany({
          where: {
            userId: String(userId),
            jobId: String(payload.jobId),
            read: false,
            id: { not: notif.id },
            type: { in: Array.from(STEP_TYPES) }
          },
          data: { read: true }
        });
        supersede = r.count > 0;
      } catch (e) {
        console.error('Supersede notifications failed:', e.message);
      }
    }

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
        // Tell the client this notification replaces earlier step-messages for
        // the same job, so it can clear stale toasts and unread markers.
        supersedeJob: supersede ? String(payload.jobId) : null,
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
