const express = require('express');
const router = express.Router();
const { prisma } = require('../db');
const { toDTO, sanitizeUser, isId } = require('../utils/dto');
const jwt = require('jsonwebtoken');

const auth = (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.split(' ')[1];
  if (!token || token === 'null' || token === 'undefined') {
    return res.status(401).json({ error: 'No token provided' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token', code: 'TOKEN_INVALID' });
    }
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Helper: calculate user community stats
async function recalculateUserStats(userId) {
  const given = await prisma.review.findMany({ where: { reviewerId: userId } });
  const received = await prisma.review.findMany({ where: { revieweeId: userId, isVisible: true } });

  const givenAvg = given.length > 0
    ? Math.round((given.reduce((s, r) => s + r.overallRating, 0) / given.length) * 10) / 10
    : 0;

  const receivedAvg = received.length > 0
    ? Math.round((received.reduce((s, r) => s + r.overallRating, 0) / received.length) * 10) / 10
    : 0;

  // Also count job-based reviews for jobsCompleted/jobsRequested stats
  const jobBoardCompleted = await prisma.job.count({
    where: {
      status: 'completed',
      acceptedApplicationId: { not: null },
      applications: { some: { applicantId: userId } }
    }
  });
  const jobBoardPosted = await prisma.job.count({
    where: { posterId: userId, status: 'completed' }
  });

  // Complainer score: how much lower do they rate compared to global average given to same reviewees?
  let complainerScore = 0;
  if (given.length >= 3) {
    let totalDiff = 0;
    let count = 0;
    for (const review of given) {
      const others = await prisma.review.findMany({
        where: {
          revieweeId: review.revieweeId,
          reviewerId: { not: userId },
          isVisible: true
        }
      });
      if (others.length > 0) {
        const othersAvg = others.reduce((s, r) => s + r.overallRating, 0) / others.length;
        totalDiff += (othersAvg - review.overallRating);
        count++;
      }
    }
    if (count > 0) {
      const avgDiff = totalDiff / count;
      // If they rate 1.5+ stars lower than average, max complainer score
      complainerScore = Math.min(100, Math.max(0, (avgDiff / 1.5) * 100));
    }
  }

  // Transaction-based rates
  const allTx = await prisma.transaction.findMany({
    where: { OR: [{ requesterId: userId }, { providerId: userId }] }
  });
  const completed = allTx.filter(t => t.status === 'completed');
  const cancelled = allTx.filter(t => t.status === 'cancelled');
  const disputed = allTx.filter(t => t.status === 'disputed');

  const completionRate = allTx.length > 0 ? Math.round((completed.length / allTx.length) * 100) : 100;
  const cancellationRate = allTx.length > 0 ? Math.round((cancelled.length / allTx.length) * 100) : 0;
  const disputeRate = allTx.length > 0 ? Math.round((disputed.length / allTx.length) * 100) : 0;

  // Reliability score: weighted formula
  // 50% completion rate, 30% received rating (if any), 20% low cancellation/dispute
  const ratingComponent = receivedAvg > 0 ? (receivedAvg / 5) * 100 : 80; // neutral if no ratings
  const behaviorComponent = Math.max(0, 100 - (cancellationRate * 2) - (disputeRate * 5));
  const reliabilityScore = Math.round(
    (completionRate * 0.5) + (ratingComponent * 0.3) + (behaviorComponent * 0.2)
  );

  const txJobsCompleted = await prisma.transaction.count({
    where: { providerId: userId, status: 'completed' }
  });
  const txJobsRequested = await prisma.transaction.count({
    where: { requesterId: userId, status: { in: ['completed', 'accepted', 'in_progress'] } }
  });

  const jobsCompleted = txJobsCompleted + (jobBoardCompleted || 0);
  const jobsRequested = txJobsRequested + (jobBoardPosted || 0);

  // Auto-flag logic
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (user) {
    const flags = Array.isArray(user.flags) ? user.flags : [];
    const newFlags = [];

    if (reliabilityScore < 40 && !flags.some(f => f.type === 'low_reliability' && !f.resolved)) {
      newFlags.push({ type: 'low_reliability', reason: `Reliability score dropped to ${reliabilityScore}%` });
    }
    if (complainerScore > 70 && !flags.some(f => f.type === 'high_complainer' && !f.resolved)) {
      newFlags.push({ type: 'high_complainer', reason: `Rates others significantly lower than community average (${Math.round(complainerScore)}%)` });
    }
    if (disputeRate > 25 && !flags.some(f => f.type === 'multiple_disputes' && !f.resolved)) {
      newFlags.push({ type: 'multiple_disputes', reason: `${disputeRate}% of transactions disputed` });
    }
    if (cancellationRate > 30 && !flags.some(f => f.type === 'suspicious_activity' && !f.resolved)) {
      newFlags.push({ type: 'suspicious_activity', reason: `${cancellationRate}% cancellation rate` });
    }

    const communityStats = {
      reliabilityScore,
      givenRatingsAvg: givenAvg,
      receivedRatingsAvg: receivedAvg,
      totalGivenReviews: given.length,
      totalReceivedReviews: received.length,
      complainerScore,
      completionRate,
      cancellationRate,
      disputeRate,
      jobsCompleted,
      jobsRequested
    };

    await prisma.user.update({
      where: { id: userId },
      data: {
        communityStats,
        ...(newFlags.length > 0 ? { flags: [...flags, ...newFlags] } : {})
      }
    });

    // Completing a first job satisfies the "firstJob" identity item — keep the
    // cached trust stars in sync (score itself always recomputes live too).
    try {
      const { refreshTrust } = require('../utils/trustScore');
      await refreshTrust(prisma, userId);
    } catch (e) { console.error('Trust refresh (job) failed:', e.message); }
  }

  return { givenAvg, receivedAvg, complainerScore, reliabilityScore };
}

// Helper: recalculate service stats
async function recalculateServiceStats(serviceId) {
  if (!serviceId) return;
  const service = await prisma.service.findUnique({ where: { id: serviceId } });
  if (!service) return;

  const reviews = await prisma.review.findMany({ where: { serviceId, isVisible: true } });

  const total = reviews.length;
  if (total === 0) {
    await prisma.service.update({
      where: { id: serviceId },
      data: { averageRating: 0, totalReviews: 0, ratingBreakdown: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } }
    });
    return;
  }

  const avg = Math.round((reviews.reduce((s, r) => s + r.overallRating, 0) / total) * 10) / 10;
  const breakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  reviews.forEach(r => { breakdown[r.overallRating] = (breakdown[r.overallRating] || 0) + 1; });

  await prisma.service.update({
    where: { id: serviceId },
    data: { averageRating: avg, totalReviews: total, ratingBreakdown: breakdown }
  });
}

// POST /api/reviews — create a review after a transaction
router.post('/', auth, async (req, res) => {
  try {
    const { transactionId, categories, overallRating, comment } = req.body;

    if (!transactionId || !overallRating) {
      return res.status(400).json({ error: 'Transaction ID and overall rating are required' });
    }

    if (!isId(transactionId)) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const transaction = await prisma.transaction.findUnique({ where: { id: transactionId } });
    if (!transaction) return res.status(404).json({ error: 'Transaction not found' });
    if (transaction.status !== 'completed') {
      return res.status(400).json({ error: 'Can only review completed transactions' });
    }

    // Determine who is reviewing whom
    const isRequester = transaction.requesterId === req.userId;
    const isProvider = transaction.providerId === req.userId;
    if (!isRequester && !isProvider) {
      return res.status(403).json({ error: 'Not authorized to review this transaction' });
    }

    // Prevent duplicate review from same user on same transaction
    const existing = await prisma.review.findFirst({
      where: { transactionId, reviewerId: req.userId }
    });
    if (existing) {
      return res.status(400).json({ error: 'You have already reviewed this transaction' });
    }

    const reviewerId = req.userId;
    const revieweeId = isRequester ? transaction.providerId : transaction.requesterId;

    // Require constructive comment for low ratings
    let isConstructive = false;
    if (overallRating <= 2) {
      if (!comment || comment.trim().length < 10) {
        return res.status(400).json({ error: 'Please provide constructive feedback (at least 10 characters) for ratings of 2 or below. Help them grow!' });
      }
      isConstructive = true;
    }

    const review = await prisma.review.create({
      data: {
        transactionId,
        reviewerId,
        revieweeId,
        serviceId: transaction.serviceId,
        categories: {
          punctuality: categories?.punctuality || overallRating,
          quality: categories?.quality || overallRating,
          communication: categories?.communication || overallRating,
          respect: categories?.respect || overallRating
        },
        overallRating,
        comment: comment || '',
        isConstructive
      }
    });

    // Update legacy transaction fields for UI visibility
    await prisma.transaction.update({
      where: { id: transactionId },
      data: isRequester
        ? { providerRating: overallRating, providerReview: comment || '' }
        : { requesterRating: overallRating, requesterReview: comment || '' }
    }).catch(() => {});

    // Update stats asynchronously
    await recalculateUserStats(reviewerId);
    await recalculateUserStats(revieweeId);
    await recalculateServiceStats(transaction.serviceId);

    res.json({ message: 'Review submitted. Thank you for building the community!', review: toDTO(review) });
  } catch (err) {
    console.error('Review creation error:', err);
    res.status(500).json({ error: 'Server error', ...(process.env.NODE_ENV !== 'production' ? { details: err.message } : {}) });
  }
});

// GET /api/reviews/user/:userId — public reviews for a user
router.get('/user/:userId', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const where = { revieweeId: req.params.userId, isVisible: true };

    const rows = await prisma.review.findMany({
      where,
      include: {
        reviewer: { select: { id: true, name: true, avatar: true } },
        service: { select: { id: true, title: true, category: true } }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit
    });

    const total = await prisma.review.count({ where });

    // populate() shape: FK fields carry the populated objects
    const reviews = rows.map(({ reviewer, service, ...r }) => ({
      ...r,
      reviewerId: reviewer,
      serviceId: service
    }));

    res.json({ reviews: toDTO(reviews), total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('Fetch reviews error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/reviews/me/mirror — self-reflection stats
router.get('/me/mirror', auth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, communityStats: true, flags: true, name: true }
    });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const recentGivenRows = await prisma.review.findMany({
      where: { reviewerId: req.userId },
      include: { reviewee: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 5
    });

    const recentReceivedRows = await prisma.review.findMany({
      where: { revieweeId: req.userId, isVisible: true },
      include: { reviewer: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 5
    });

    const recentGiven = recentGivenRows.map(({ reviewee, ...r }) => ({ ...r, revieweeId: reviewee }));
    const recentReceived = recentReceivedRows.map(({ reviewer, ...r }) => ({ ...r, reviewerId: reviewer }));

    // Community average for comparison
    const allUsers = await prisma.user.findMany({
      where: { communityStats: { path: ['totalReceivedReviews'], gt: 0 } },
      select: { communityStats: true }
    });
    const communityReceivedAvg = allUsers.length > 0
      ? Math.round((allUsers.reduce((s, u) => s + (u.communityStats?.receivedRatingsAvg || 0), 0) / allUsers.length) * 10) / 10
      : 0;

    const communityGivenAvg = allUsers.length > 0
      ? Math.round((allUsers.reduce((s, u) => s + (u.communityStats?.givenRatingsAvg || 0), 0) / allUsers.length) * 10) / 10
      : 0;

    res.json({
      stats: toDTO(user.communityStats),
      flags: toDTO(user.flags),
      recentGiven: toDTO(recentGiven),
      recentReceived: toDTO(recentReceived),
      communityComparison: {
        receivedAvg: communityReceivedAvg,
        givenAvg: communityGivenAvg
      }
    });
  } catch (err) {
    console.error('Mirror error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/users/community — all users with location for map (community visibility)
router.get('/community/users', async (req, res) => {
  try {
    const rows = await prisma.user.findMany({
      where: { lat: { not: 0 }, lng: { not: 0 } },
      select: {
        id: true,
        name: true,
        avatar: true,
        lat: true,
        lng: true,
        role: true,
        isOnline: true,
        lastActive: true,
        communityStats: true,
        primaryCategory: true,
        skills: true
      }
    });

    const users = rows.map(({ lat, lng, ...u }) => ({ ...u, location: { lat, lng } }));

    res.json(toDTO(users));
  } catch (err) {
    console.error('Community users error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
module.exports.recalculateUserStats = recalculateUserStats;
