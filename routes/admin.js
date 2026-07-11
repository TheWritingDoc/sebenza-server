const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { prisma } = require('../db');
const { toDTO, sanitizeUser, isId } = require('../utils/dto');

// Reusable JWT auth middleware
const { auth, revokeUserSessions } = require('../middleware/authToken');

const requireAdmin = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, role: true }
    });
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

// Simple admin health probe (the old Atlas whitelist route is gone — the
// database is Supabase Postgres now and has no IP allow-list to manage).
router.get('/status', auth, requireAdmin, async (req, res) => {
  try {
    const users = await prisma.user.count();
    res.json({ status: 'ok', users });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Revoke every outstanding JWT for a user (lockout/offboarding). Their 30-day
// tokens die within 60s (version-cache TTL) on all devices.
router.post('/users/:id/revoke-sessions', auth, requireAdmin, async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ error: 'Invalid user id' });
    await revokeUserSessions(req.params.id);
    res.json({ message: 'All sessions revoked' });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'User not found' });
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
