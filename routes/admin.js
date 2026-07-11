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

// ── Report review queue ──

// List reports (default: pending, newest first) with context on both parties.
router.get('/reports', auth, requireAdmin, async (req, res) => {
  try {
    const status = ['pending', 'dismissed', 'actioned', 'all'].includes(req.query.status)
      ? req.query.status : 'pending';
    const where = status === 'all' ? {} : { status };
    const reports = await prisma.report.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        reporter: { select: { id: true, name: true, profileImage: true, trustStars: true, communityStats: true, flags: true, createdAt: true } },
        reported: { select: { id: true, name: true, profileImage: true, trustStars: true, communityStats: true, flags: true, createdAt: true } },
      }
    });
    // How many total reports each reported user has (pattern detection)
    const reportedIds = [...new Set(reports.map(r => r.reportedId))];
    const counts = reportedIds.length ? await prisma.report.groupBy({
      by: ['reportedId'], where: { reportedId: { in: reportedIds } }, _count: { id: true }
    }) : [];
    const countMap = Object.fromEntries(counts.map(c => [c.reportedId, c._count.id]));
    res.json(reports.map(r => toDTO({ ...r, reportedTotalReports: countMap[r.reportedId] || 1 })));
  } catch (err) {
    console.error('Admin reports list error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Resolve a report.
// action: dismiss | dismiss_frivolous | warn | flag_suspicious | flag_scammer
//  - dismiss_frivolous also bumps the REPORTER's complainerScore (serial
//    complainers lose community stars — the anti-report-bombing lever).
//  - flag_suspicious/flag_scammer push an unresolved flag onto the reported
//    user (computeCommunityStars: −1★ + FLAGGED badge); scammer also revokes
//    all their sessions.
router.post('/reports/:id/resolve', auth, requireAdmin, async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(404).json({ error: 'Report not found' });
    const { action } = req.body;
    const note = String(req.body.note || '').slice(0, 500);
    const ACTIONS = ['dismiss', 'dismiss_frivolous', 'warn', 'flag_suspicious', 'flag_scammer'];
    if (!ACTIONS.includes(action)) return res.status(400).json({ error: 'Invalid action' });

    const report = await prisma.report.findUnique({ where: { id: req.params.id } });
    if (!report) return res.status(404).json({ error: 'Report not found' });
    if (report.status !== 'pending') return res.status(409).json({ error: 'Report already resolved' });

    const io = req.app.get('io');
    const onlineUsers = req.app.get('onlineUsers');
    const { sendNotification } = require('../utils/notifications');

    if (action === 'dismiss_frivolous') {
      const reporter = await prisma.user.findUnique({ where: { id: report.reporterId }, select: { communityStats: true } });
      const stats = reporter?.communityStats || {};
      stats.complainerScore = Math.min(100, (Number(stats.complainerScore) || 0) + 15);
      await prisma.user.update({ where: { id: report.reporterId }, data: { communityStats: stats } });
    }

    if (action === 'warn') {
      sendNotification(io, onlineUsers, report.reportedId, {
        type: 'account_warning',
        title: 'Community Guidelines Warning',
        message: 'A report about your conduct was reviewed. Please treat other members with respect — further reports can limit your account.',
      }).catch(() => {});
    }

    if (action === 'flag_suspicious' || action === 'flag_scammer') {
      const reported = await prisma.user.findUnique({ where: { id: report.reportedId }, select: { flags: true } });
      const flags = Array.isArray(reported?.flags) ? reported.flags : [];
      flags.push({
        type: 'suspicious_activity',
        reason: `${report.reason}${note ? ': ' + note : ''}`,
        reportId: report.id,
        severity: action === 'flag_scammer' ? 'scam' : 'suspicious',
        addedBy: req.userId,
        addedAt: new Date().toISOString(),
        resolved: false,
      });
      await prisma.user.update({ where: { id: report.reportedId }, data: { flags } });
      if (action === 'flag_scammer') {
        await revokeUserSessions(report.reportedId); // kick them off all devices
      }
    }

    const updated = await prisma.report.update({
      where: { id: report.id },
      data: {
        status: action.startsWith('dismiss') ? 'dismissed' : 'actioned',
        actionTaken: action,
        resolutionNote: note,
        reviewedBy: req.userId,
        reviewedAt: new Date(),
      }
    });
    res.json(toDTO(updated));
  } catch (err) {
    console.error('Admin report resolve error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Mark a user's unresolved flags as resolved (redemption path — the
// community-star engine shows a "redeemed" badge instead of the −1★).
router.post('/users/:id/clear-flags', auth, requireAdmin, async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(404).json({ error: 'User not found' });
    const note = String(req.body.note || 'Cleared after review').slice(0, 500);
    const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: { flags: true } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const flags = (Array.isArray(user.flags) ? user.flags : []).map(f =>
      f && !f.resolved ? { ...f, resolved: true, resolution: note, resolvedBy: req.userId, resolvedAt: new Date().toISOString() } : f
    );
    await prisma.user.update({ where: { id: req.params.id }, data: { flags } });
    res.json({ message: 'Flags cleared', flags });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
