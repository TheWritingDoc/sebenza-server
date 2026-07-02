const express = require('express');
const router = express.Router();
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const Service = require('../models/Service');
const Review = require('../models/Review');
const jwt = require('jsonwebtoken');
const upload = require('../middleware/upload');

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

// Create transaction request with job description images
router.post('/request', auth, upload.array('jobImages', 10), async (req, res) => {
  try {
    const { serviceId, providerId, randAmount, description, paymentMethod } = req.body;
    const pmtMethod = paymentMethod === 'cash' ? 'cash' : 'escrow';
    
    // Validate randAmount
    const amount = parseFloat(randAmount);
    if (isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Invalid Rand amount' });
    }
    
    const requester = await User.findById(req.userId);
    if (!requester) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Only check balance for escrow payments
    if (pmtMethod === 'escrow') {
      if ((requester.randBalance || 0) < amount) {
        return res.status(400).json({ error: 'Insufficient Rand balance' });
      }
      // Move Rand to escrow
      requester.randBalance = (requester.randBalance || 0) - amount;
      requester.escrowRand = (requester.escrowRand || 0) + amount;
      await requester.save();
    }

    // Handle job description images (before photos) — MANDATORY
    const jobDescriptionImages = req.files ? req.files.map(file => ({
      url: `/uploads/proof/${file.filename}`,
      caption: req.body.caption || '',
      uploadedAt: new Date()
    })) : [];
    
    if (jobDescriptionImages.length === 0) {
      return res.status(400).json({ error: 'At least 1 before photo is required. Please upload a photo of the job.' });
    }

    // Fetch service location for GPS navigation
    const service = await Service.findById(serviceId).select('location');

    const transaction = new Transaction({
      requesterId: req.userId,
      providerId,
      serviceId,
      randAmount: amount,
      paymentMethod: pmtMethod,
      jobDescriptionImages,
      status: 'pending',
      escrowStatus: pmtMethod === 'cash' ? 'none' : 'held',
      location: service?.location ? { lat: service.location.lat, lng: service.location.lng } : undefined
    });

    await transaction.save();

    res.json({
      message: pmtMethod === 'cash' ? 'Service requested. Pay cash on completion.' : 'Service requested. Rand held in escrow.',
      transactionId: transaction._id,
      jobImages: jobDescriptionImages.length
    });
  } catch (err) {
    console.error('Request error:', err);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});

// Accept transaction
router.post('/accept/:id', auth, async (req, res) => {
  try {
    const transaction = await Transaction.findOne({
      _id: req.params.id,
      providerId: req.userId,
      status: 'pending'
    });

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    transaction.status = 'accepted';
    await transaction.save();

    res.json({ message: 'Transaction accepted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Provider sends a quote (negotiation)
router.post('/quote/:id', auth, async (req, res) => {
  try {
    const { amount } = req.body;
    const quoted = parseFloat(amount);
    if (isNaN(quoted) || quoted <= 0) {
      return res.status(400).json({ error: 'Invalid quote amount' });
    }

    const transaction = await Transaction.findOne({
      _id: req.params.id,
      providerId: req.userId,
      status: { $in: ['pending', 'accepted'] }
    });

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    transaction.negotiationHistory = transaction.negotiationHistory || [];
    transaction.negotiationHistory.push({
      proposedBy: req.userId,
      amount: quoted,
      status: 'pending'
    });
    transaction.negotiatedAmount = quoted;
    await transaction.save();

    res.json({ message: 'Quote sent', quotedAmount: quoted });
  } catch (err) {
    console.error('Quote error:', err);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});

// Requester accepts a quote
router.post('/accept-quote/:id', auth, async (req, res) => {
  try {
    const transaction = await Transaction.findOne({
      _id: req.params.id,
      requesterId: req.userId,
      status: { $in: ['pending', 'accepted'] }
    });

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const lastQuote = transaction.negotiationHistory?.length > 0
      ? transaction.negotiationHistory[transaction.negotiationHistory.length - 1]
      : null;

    if (!lastQuote || lastQuote.status !== 'pending') {
      return res.status(400).json({ error: 'No pending quote to accept' });
    }

    lastQuote.status = 'accepted';
    transaction.negotiatedAmount = lastQuote.amount;
    transaction.status = 'accepted';

    // If escrow, adjust the escrow amount if the quote is different
    if (transaction.paymentMethod === 'escrow' && transaction.escrowStatus === 'held') {
      const original = transaction.randAmount;
      const diff = lastQuote.amount - original;
      const requester = await User.findById(req.userId);
      if (diff > 0) {
        if ((requester.randBalance || 0) < diff) {
          return res.status(400).json({ error: 'Insufficient balance for increased quote' });
        }
        requester.randBalance -= diff;
        requester.escrowRand += diff;
        await requester.save();
      } else if (diff < 0) {
        requester.randBalance += Math.abs(diff);
        requester.escrowRand -= Math.abs(diff);
        await requester.save();
      }
      transaction.randAmount = lastQuote.amount;
    }

    await transaction.save();
    res.json({ message: 'Quote accepted', finalAmount: lastQuote.amount });
  } catch (err) {
    console.error('Accept quote error:', err);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});

// Requester declines a quote
router.post('/decline-quote/:id', auth, async (req, res) => {
  try {
    const transaction = await Transaction.findOne({
      _id: req.params.id,
      requesterId: req.userId,
      status: { $in: ['pending', 'accepted'] }
    });

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const lastQuote = transaction.negotiationHistory?.length > 0
      ? transaction.negotiationHistory[transaction.negotiationHistory.length - 1]
      : null;

    if (lastQuote && lastQuote.status === 'pending') {
      lastQuote.status = 'rejected';
      await transaction.save();
    }

    res.json({ message: 'Quote declined' });
  } catch (err) {
    console.error('Decline quote error:', err);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});

// Complete transaction with proof images
// Only the requester (funding buyer) can complete and release escrow.
router.post('/complete/:id', auth, upload.array('proofImages', 10), async (req, res) => {
  try {
    const { rating, review } = req.body;

    const transaction = await Transaction.findOne({
      _id: req.params.id,
      requesterId: req.userId,
      status: { $in: ['accepted', 'in_progress'] }
    });

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found or not authorized' });
    }

    // Handle uploaded proof images
    const proofImages = req.files ? req.files.map(file => ({
      url: `/uploads/proof/${file.filename}`,
      uploadedBy: req.userId,
      uploadedAt: new Date(),
      caption: req.body.caption || ''
    })) : [];

    if (proofImages.length === 0) {
      return res.status(400).json({ error: 'At least 1 after photo is required. Please upload proof of completed work.' });
    }

    transaction.proofImages = [...(transaction.proofImages || []), ...proofImages];

    const finalAmount = transaction.negotiatedAmount || transaction.randAmount || 0;

    // Only handle escrow for escrow payments
    if (transaction.paymentMethod === 'escrow') {
      const requester = await User.findById(transaction.requesterId);
      const provider = await User.findById(transaction.providerId);

      if (!requester || !provider) {
        return res.status(400).json({ error: 'Requester or provider not found' });
      }

      // Ensure balances are non-negative and do not exceed escrow held
      const escrowHeld = requester.escrowRand || 0;
      const releaseAmount = Math.min(finalAmount, escrowHeld);
      if (releaseAmount <= 0) {
        return res.status(400).json({ error: 'No escrow funds to release' });
      }

      requester.escrowRand = escrowHeld - releaseAmount;
      provider.randBalance = (provider.randBalance || 0) + releaseAmount;
      provider.totalEarnedRand = (provider.totalEarnedRand || 0) + releaseAmount;

      await requester.save();
      await provider.save();
      transaction.escrowStatus = 'released';
    }

    // Update transaction
    transaction.status = 'completed';
    transaction.completedAt = new Date();

    // Legacy: still store on transaction for backward compat
    const isRequester = transaction.requesterId.toString() === req.userId;
    if (isRequester) {
      transaction.providerRating = rating;
      transaction.providerReview = review;
    } else {
      transaction.requesterRating = rating;
      transaction.requesterReview = review;
    }

    await transaction.save();

    // Update provider portfolio
    if (proofImages.length > 0) {
      const provider = await User.findById(transaction.providerId);
      const portfolioImages = proofImages.map(img => ({ url: img.url, transactionId: transaction._id, serviceId: transaction.serviceId, uploadedAt: img.uploadedAt, caption: img.caption }));
      provider.portfolioImages = [...(provider.portfolioImages || []), ...portfolioImages];
      await provider.save();
    }

    // Update service completed count
    const service = await Service.findById(transaction.serviceId);
    if (service) {
      service.completedJobsCount += 1;
      await service.save();
    }

    // NEW: If rating provided, create a proper Review document
    if (rating) {
      const reviewerId = req.userId;
      const revieweeId = isRequester ? transaction.providerId : transaction.requesterId;
      
      // Avoid duplicate
      const existingReview = await Review.findOne({ transactionId: transaction._id, reviewerId });
      if (!existingReview) {
        const reviewDoc = new Review({
          transactionId: transaction._id,
          reviewerId,
          revieweeId,
          serviceId: transaction.serviceId,
          categories: {
            punctuality: parseInt(rating) || 3,
            quality: parseInt(rating) || 3,
            communication: parseInt(rating) || 3,
            respect: parseInt(rating) || 3
          },
          overallRating: parseInt(rating) || 3,
          comment: review || '',
          isConstructive: parseInt(rating) <= 2
        });
        await reviewDoc.save();

        // Trigger stats recalculation via reviews route helper (imported below)
        // We recalculate here inline to avoid circular deps
        await recalcUserStats(reviewerId);
        await recalcUserStats(revieweeId);
        if (service) await recalcServiceStats(transaction.serviceId);
      }
    }

    res.json({
      message: transaction.paymentMethod === 'cash' ? 'Transaction completed.' : 'Transaction completed. Rand released to provider.',
      proofImages: transaction.proofImages
    });
  } catch (err) {
    console.error('Complete error:', err);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});

// Inline stat recalculation helpers (mirrors reviews.js logic)
async function recalcUserStats(userId) {
  const given = await Review.find({ reviewerId: userId });
  const received = await Review.find({ revieweeId: userId, isVisible: true });

  const givenAvg = given.length > 0
    ? Math.round((given.reduce((s, r) => s + r.overallRating, 0) / given.length) * 10) / 10
    : 0;
  const receivedAvg = received.length > 0
    ? Math.round((received.reduce((s, r) => s + r.overallRating, 0) / received.length) * 10) / 10
    : 0;

  let complainerScore = 0;
  if (given.length >= 3) {
    let totalDiff = 0, count = 0;
    for (const review of given) {
      const others = await Review.find({ revieweeId: review.revieweeId, reviewerId: { $ne: userId }, isVisible: true });
      if (others.length > 0) {
        const othersAvg = others.reduce((s, r) => s + r.overallRating, 0) / others.length;
        totalDiff += (othersAvg - review.overallRating);
        count++;
      }
    }
    if (count > 0) complainerScore = Math.min(100, Math.max(0, (totalDiff / count / 1.5) * 100));
  }

  const allTx = await Transaction.find({ $or: [{ requesterId: userId }, { providerId: userId }] });
  const completed = allTx.filter(t => t.status === 'completed');
  const cancelled = allTx.filter(t => t.status === 'cancelled');
  const disputed = allTx.filter(t => t.status === 'disputed');

  const completionRate = allTx.length > 0 ? Math.round((completed.length / allTx.length) * 100) : 100;
  const cancellationRate = allTx.length > 0 ? Math.round((cancelled.length / allTx.length) * 100) : 0;
  const disputeRate = allTx.length > 0 ? Math.round((disputed.length / allTx.length) * 100) : 0;

  const ratingComponent = receivedAvg > 0 ? (receivedAvg / 5) * 100 : 80;
  const behaviorComponent = Math.max(0, 100 - (cancellationRate * 2) - (disputeRate * 5));
  const reliabilityScore = Math.round((completionRate * 0.5) + (ratingComponent * 0.3) + (behaviorComponent * 0.2));

  const jobsCompleted = await Transaction.countDocuments({ providerId: userId, status: 'completed' });
  const jobsRequested = await Transaction.countDocuments({ requesterId: userId, status: { $in: ['completed', 'accepted', 'in_progress'] } });

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
    if (newFlags.length > 0) user.flags = [...flags, ...newFlags];

    user.communityStats = {
      reliabilityScore, givenRatingsAvg: givenAvg, receivedRatingsAvg: receivedAvg,
      totalGivenReviews: given.length, totalReceivedReviews: received.length,
      complainerScore, completionRate, cancellationRate, disputeRate,
      jobsCompleted, jobsRequested
    };
    await user.save();
  }
}

async function recalcServiceStats(serviceId) {
  const reviews = await Review.find({ serviceId, isVisible: true });
  const service = await Service.findById(serviceId);
  if (!service) return;
  if (reviews.length === 0) {
    service.averageRating = 0;
    service.totalReviews = 0;
    service.ratingBreakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  } else {
    const avg = Math.round((reviews.reduce((s, r) => s + r.overallRating, 0) / reviews.length) * 10) / 10;
    const breakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    reviews.forEach(r => { breakdown[r.overallRating] = (breakdown[r.overallRating] || 0) + 1; });
    service.averageRating = avg;
    service.totalReviews = reviews.length;
    service.ratingBreakdown = breakdown;
  }
  await service.save();
}

// Cancel transaction and refund escrow
router.post('/cancel/:id', auth, async (req, res) => {
  try {
    const transaction = await Transaction.findOne({
      _id: req.params.id,
      $or: [{ requesterId: req.userId }, { providerId: req.userId }],
      status: { $in: ['pending', 'accepted'] }
    });

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found or cannot be cancelled' });
    }

    // Only refund for escrow payments
    if (transaction.paymentMethod === 'escrow') {
      const requester = await User.findById(transaction.requesterId);
      const amount = transaction.randAmount || 0;
      
      requester.escrowRand = (requester.escrowRand || 0) - amount;
      requester.randBalance = (requester.randBalance || 0) + amount;
      await requester.save();
      transaction.escrowStatus = 'refunded';
    }

    transaction.status = 'cancelled';
    await transaction.save();

    res.json({ message: transaction.paymentMethod === 'cash' ? 'Transaction cancelled.' : 'Transaction cancelled. Rand refunded.' });
  } catch (err) {
    console.error('Cancel error:', err);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});

// Get user's transactions
router.get('/my-transactions', auth, async (req, res) => {
  try {
    const transactions = await Transaction.find({
      $or: [{ requesterId: req.userId }, { providerId: req.userId }]
    })
    .populate('serviceId', 'title category location')
    .populate('requesterId', 'name')
    .populate('providerId', 'name')
    .sort({ createdAt: -1 });

    res.json(transactions);
  } catch (err) {
    console.error('My transactions error:', err);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});

// Get provider's completed jobs (for portfolio)
router.get('/provider/:providerId/completed', async (req, res) => {
  try {
    const transactions = await Transaction.find({
      providerId: req.params.providerId,
      status: 'completed'
    })
    .populate('serviceId', 'title category')
    .populate('requesterId', 'name')
    .sort({ completedAt: -1 });

    res.json(transactions);
  } catch (err) {
    console.error('Provider completed error:', err);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});

module.exports = router;
