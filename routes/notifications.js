const express = require('express');
const router = express.Router();
const { prisma } = require('../db');
const { toDTO, sanitizeUser, isId } = require('../utils/dto');

const { auth } = require('../middleware/authToken');

// GET /api/notifications - list user's notifications
router.get('/', auth, async (req, res) => {
  try {
    const { page = 1, limit = 50, unreadOnly = 'false' } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const filter = { userId: req.userId };
    if (unreadOnly === 'true') filter.read = false;

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: filter,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum
      }),
      prisma.notification.count({ where: { userId: req.userId } }),
      prisma.notification.count({ where: { userId: req.userId, read: false } })
    ]);

    res.json({ notifications: toDTO(notifications), total, unreadCount, page: pageNum, limit: limitNum });
  } catch (err) {
    console.error('Fetch notifications error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/notifications/:id/read - mark single notification as read
router.patch('/:id/read', auth, async (req, res) => {
  try {
    if (!isId(req.params.id)) {
      return res.status(404).json({ error: 'Notification not found' });
    }
    const result = await prisma.notification.updateMany({
      where: { id: req.params.id, userId: req.userId },
      data: { read: true }
    });
    if (result.count === 0) return res.status(404).json({ error: 'Notification not found' });
    const notif = await prisma.notification.findUnique({ where: { id: req.params.id } });
    res.json({ message: 'Marked as read', notification: toDTO(notif) });
  } catch (err) {
    console.error('Mark read error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/notifications/read-all - mark all as read
router.patch('/read-all', auth, async (req, res) => {
  try {
    const result = await prisma.notification.updateMany({
      where: { userId: req.userId, read: false },
      data: { read: true }
    });
    res.json({ message: 'All notifications marked as read', modified: result.count });
  } catch (err) {
    console.error('Mark all read error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/notifications - clear ALL of the user's notifications.
// (The "Clear all" button called this, but the route was missing, so it
// silently did nothing and the list reappeared on the next poll.)
router.delete('/', auth, async (req, res) => {
  try {
    const result = await prisma.notification.deleteMany({ where: { userId: req.userId } });
    res.json({ message: 'All notifications cleared', deleted: result.count });
  } catch (err) {
    console.error('Clear all notifications error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/notifications/:id - delete a notification
router.delete('/:id', auth, async (req, res) => {
  try {
    if (!isId(req.params.id)) {
      return res.status(404).json({ error: 'Notification not found' });
    }
    const result = await prisma.notification.deleteMany({
      where: { id: req.params.id, userId: req.userId }
    });
    if (result.count === 0) return res.status(404).json({ error: 'Notification not found' });
    res.json({ message: 'Notification deleted' });
  } catch (err) {
    console.error('Delete notification error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
