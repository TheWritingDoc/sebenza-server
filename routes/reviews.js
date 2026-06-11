const express = require('express');
const router = express.Router();
const Review = require('../models/Review');
const User = require('../models/User');
const Service = require('../models/Service');
const Transaction = require('../models/Transaction');
const jwt = require('jsonwebtoken');

const auth = (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.split(' ')[1];
  if (!token || token === 'null' || token === 'undefined') {
    return res.status(401).json({ error: 'No token provided' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
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
  const given = await Review.find({ reviewerId: userId });
  const received = await Review.find({ revieweeId: userId, isVisible: true });

  const givenAvg = given.length > 0
    ? Math.round((given.reduce((s, r) => s + r.overallRating, 0) / given.length) * 10) / 10
    : 0;

  const receivedAvg = received.length > 0
    ? Math.round((received.reduce((s, r) => s + r.overallRating, 0) / received.length) * 10) / 10
    : 0;

  // Also count job-based reviews for jobsCompleted/jobsRequested stats
  const Job = require('../models/Job');
  const jobBoardCompleted = await Job.countDocuments({
    status: 'completed',
    'applications.applicantId': userId,
    acceptedApplicationId: { $exists: true, $ne: null }
  });
  const jobBoardPosted = await Job.countDocuments({
    posterId: userId,
    status: 'completed'
  });

  // Complainer score: how much lower do they rate compared to global average given to same reviewees?
  let complainerScore = 0;
  if (given.length >= 3) {
    let totalDiff = 0;
    let count = 0;
    for (const review of given) {
      const others = await Review.find({
        revieweeId: review.revieweeId,
        reviewerId: { $ne: userId },
        isVisible: true
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
  const allTx = await Transaction.find({
    $or: [{ requesterId: userId }, { providerId: userId }]
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

  const txJobsCompleted = await Transaction.countDocuments({
    providerId: userId,
    status: 'completed'
  });
  const txJobsRequested = await Transaction.countDocuments({
    requesterId: userId,
    status: { $in: ['completed', 'accepted', 'in_progress'] }
  });

  const jobsCompleted = txJobsCompleted + (jobBoardCompleted || 0);
  const jobsRequested = txJobsRequested + (jobBoardPosted || 0);

  // Auto-flag logic
  const user = await User.findById(userId);
  if (user) {
    const flags = user.flags || [];
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

    if (newFlags.length > 0) {
      user.flags = [...flags, ...newFlags];
    }

    user.communityStats = {
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
    await user.save();
  }

  return { givenAvg, receivedAvg, complainerScore, reliabilityScore };
}

// Helper: recalculate service stats
async function recalculateServiceStats(serviceId) {
  const reviews = await Review.find({ serviceId, isVisible: true });
  const service = await Service.findById(serviceId);
  if (!service) return;

  const total = reviews.length;
  if (total === 0) {
    service.averageRating = 0;
    service.totalReviews = 0;
    service.ratingBreakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    await service.save();
    return;
  }

  const avg = Math.round((reviews.reduce((s, r) => s + r.overallRating, 0) / total) * 10) / 10;
  const breakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  reviews.forEach(r => { breakdown[r.overallRating] = (breakdown[r.overallRating] || 0) + 1; });

  service.averageRating = avg;
  service.totalReviews = total;
  service.ratingBreakdown = breakdown;
  await service.save();
}

// POST /api/reviews — create a review after a transaction
router.post('/', auth, async (req, res) => {
  try {
    const { transactionId, categories, overallRating, comment } = req.body;

    if (!transactionId || !overallRating) {
      return res.status(400).json({ error: 'Transaction ID and overall rating are required' });
    }

    const transaction = await Transaction.findById(transactionId);
    if (!transaction) return res.status(404).json({ error: 'Transaction not found' });
    if (transaction.status !== 'completed') {
      return res.status(400).json({ error: 'Can only review completed transactions' });
    }

    // Determine who is reviewing whom
    const isRequester = transaction.requesterId.toString() === req.userId;
    const isProvider = transaction.providerId.toString() === req.userId;
    if (!isRequester && !isProvider) {
      return res.status(403).json({ error: 'Not authorized to review this transaction' });
    }

    // Prevent duplicate review from same user on same transaction
    const existing = await Review.findOne({ transactionId, reviewerId: req.userId });
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

    const review = new Review({
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
    });

    await review.save();

    // Update legacy transaction fields for UI visibility
    const tx = await Transaction.findById(transactionId);
    if (tx) {
      if (isRequester) {
        tx.providerRating = overallRating;
        tx.providerReview = comment || '';
      } else {
        tx.requesterRating = overallRating;
        tx.requesterReview = comment || '';
      }
      await tx.save();
    }

    // Update stats asynchronously
    await recalculateUserStats(reviewerId);
    await recalculateUserStats(revieweeId);
    await recalculateServiceStats(transaction.serviceId);

    res.json({ message: 'Review submitted. Thank you for building the community!', review });
  } catch (err) {
    console.error('Review creation error:', err);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});

// GET /api/reviews/user/:userId — public reviews for a user
router.get('/user/:userId', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const reviews = await Review.find({ revieweeId: req.params.userId, isVisible: true })
      .populate('reviewerId', 'name avatar')
      .populate('serviceId', 'title category')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Review.countDocuments({ revieweeId: req.params.userId, isVisible: true });

    res.json({ reviews, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('Fetch reviews error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/reviews/me/mirror — self-reflection stats
router.get('/me/mirror', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('communityStats flags name');
    if (!user) return res.status(404).json({ error: 'User not found' });

    const recentGiven = await Review.find({ reviewerId: req.userId })
      .populate('revieweeId', 'name')
      .sort({ createdAt: -1 })
      .limit(5);

    const recentReceived = await Review.find({ revieweeId: req.userId, isVisible: true })
      .populate('reviewerId', 'name')
      .sort({ createdAt: -1 })
      .limit(5);

    // Community average for comparison
    const allUsers = await User.find({ 'communityStats.totalReceivedReviews': { $gt: 0 } });
    const communityReceivedAvg = allUsers.length > 0
      ? Math.round((allUsers.reduce((s, u) => s + (u.communityStats?.receivedRatingsAvg || 0), 0) / allUsers.length) * 10) / 10
      : 0;

    const communityGivenAvg = allUsers.length > 0
      ? Math.round((allUsers.reduce((s, u) => s + (u.communityStats?.givenRatingsAvg || 0), 0) / allUsers.length) * 10) / 10
      : 0;

    res.json({
      stats: user.communityStats,
      flags: user.flags,
      recentGiven,
      recentReceived,
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
    const users = await User.find({
      'location.lat': { $ne: 0 },
      'location.lng': { $ne: 0 }
    })
    .select('name avatar location role isOnline lastActive communityStats primaryCategory skills')
    .lean();

    res.json(users);
  } catch (err) {
    console.error('Community users error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
module.exports.recalculateUserStats = recalculateUserStats;
