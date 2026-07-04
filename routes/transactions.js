const express = require('express');
const router = express.Router();
const { prisma } = require('../db');
const { toDTO, sanitizeUser, isId } = require('../utils/dto');
const jwt = require('jsonwebtoken');
const upload = require('../middleware/upload');
const { uploadFiles } = require('../middleware/upload');

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

// Mongo-era clients expect transaction.location = { lat, lng }
const withLocation = (t) => {
  if (!t) return t;
  const { lat, lng, ...rest } = t;
  return {
    ...rest,
    lat,
    lng,
    location: (lat != null || lng != null) ? { lat, lng } : undefined
  };
};

// Create transaction request with job description images
router.post('/request', auth, upload.array('jobImages', 10), async (req, res) => {
  try {
    const { serviceId, providerId, randAmount, paymentMethod } = req.body;
    const pmtMethod = paymentMethod === 'cash' ? 'cash' : 'escrow';

    // Validate randAmount
    const amount = parseFloat(randAmount);
    if (isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Invalid Rand amount' });
    }

    const requester = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!requester) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Handle job description images (before photos) — MANDATORY
    const jobImageUrls = req.files && req.files.length > 0 ? await uploadFiles(req.files, 'proof') : [];
    const jobDescriptionImages = jobImageUrls.map(url => ({
      url,
      caption: req.body.caption || '',
      uploadedAt: new Date()
    }));

    if (jobDescriptionImages.length === 0) {
      return res.status(400).json({ error: 'At least 1 before photo is required. Please upload a photo of the job.' });
    }

    // Only check balance for escrow payments
    if (pmtMethod === 'escrow') {
      if (Number(requester.randBalance || 0) < amount) {
        return res.status(400).json({ error: 'Insufficient Rand balance' });
      }
      // Move Rand to escrow
      await prisma.user.update({
        where: { id: req.userId },
        data: {
          randBalance: { decrement: amount },
          escrowRand: { increment: amount }
        }
      });
    }

    // Fetch service location for GPS navigation
    const service = isId(serviceId)
      ? await prisma.service.findUnique({ where: { id: serviceId }, select: { lat: true, lng: true } })
      : null;

    const transaction = await prisma.transaction.create({
      data: {
        requesterId: req.userId,
        providerId,
        serviceId: isId(serviceId) ? serviceId : null,
        randAmount: amount,
        paymentMethod: pmtMethod,
        jobDescriptionImages,
        status: 'pending',
        escrowStatus: pmtMethod === 'cash' ? 'none' : 'held',
        lat: service?.lat ?? null,
        lng: service?.lng ?? null
      }
    });

    res.json({
      message: pmtMethod === 'cash' ? 'Service requested. Pay cash on completion.' : 'Service requested. Rand held in escrow.',
      transactionId: transaction.id,
      jobImages: jobDescriptionImages.length
    });
  } catch (err) {
    console.error('Request error:', err);
    res.status(500).json({ error: 'Server error', ...(process.env.NODE_ENV !== 'production' ? { details: err.message } : {}) });
  }
});

// Accept transaction
router.post('/accept/:id', auth, async (req, res) => {
  try {
    if (!isId(req.params.id)) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    const updated = await prisma.transaction.updateMany({
      where: {
        id: req.params.id,
        providerId: req.userId,
        status: 'pending'
      },
      data: { status: 'accepted' }
    });

    if (updated.count === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

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

    const transaction = isId(req.params.id) ? await prisma.transaction.findFirst({
      where: {
        id: req.params.id,
        providerId: req.userId,
        status: { in: ['pending', 'accepted'] }
      }
    }) : null;

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const negotiationHistory = Array.isArray(transaction.negotiationHistory) ? transaction.negotiationHistory : [];
    negotiationHistory.push({
      proposedBy: req.userId,
      amount: quoted,
      status: 'pending',
      createdAt: new Date()
    });

    await prisma.transaction.update({
      where: { id: transaction.id },
      data: {
        negotiationHistory,
        negotiatedAmount: quoted
      }
    });

    res.json({ message: 'Quote sent', quotedAmount: quoted });
  } catch (err) {
    console.error('Quote error:', err);
    res.status(500).json({ error: 'Server error', ...(process.env.NODE_ENV !== 'production' ? { details: err.message } : {}) });
  }
});

// Requester accepts a quote
router.post('/accept-quote/:id', auth, async (req, res) => {
  try {
    const transaction = isId(req.params.id) ? await prisma.transaction.findFirst({
      where: {
        id: req.params.id,
        requesterId: req.userId,
        status: { in: ['pending', 'accepted'] }
      }
    }) : null;

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const negotiationHistory = Array.isArray(transaction.negotiationHistory) ? transaction.negotiationHistory : [];
    const lastQuote = negotiationHistory.length > 0
      ? negotiationHistory[negotiationHistory.length - 1]
      : null;

    if (!lastQuote || lastQuote.status !== 'pending') {
      return res.status(400).json({ error: 'No pending quote to accept' });
    }

    lastQuote.status = 'accepted';

    const data = {
      negotiationHistory,
      negotiatedAmount: lastQuote.amount,
      status: 'accepted'
    };

    // If escrow, adjust the escrow amount if the quote is different
    if (transaction.paymentMethod === 'escrow' && transaction.escrowStatus === 'held') {
      const original = Number(transaction.randAmount || 0);
      const diff = lastQuote.amount - original;
      const requester = await prisma.user.findUnique({ where: { id: req.userId } });
      if (diff > 0) {
        if (Number(requester.randBalance || 0) < diff) {
          return res.status(400).json({ error: 'Insufficient balance for increased quote' });
        }
        await prisma.user.update({
          where: { id: req.userId },
          data: {
            randBalance: { decrement: diff },
            escrowRand: { increment: diff }
          }
        });
      } else if (diff < 0) {
        await prisma.user.update({
          where: { id: req.userId },
          data: {
            randBalance: { increment: Math.abs(diff) },
            escrowRand: { decrement: Math.abs(diff) }
          }
        });
      }
      data.randAmount = lastQuote.amount;
    }

    await prisma.transaction.update({ where: { id: transaction.id }, data });
    res.json({ message: 'Quote accepted', finalAmount: lastQuote.amount });
  } catch (err) {
    console.error('Accept quote error:', err);
    res.status(500).json({ error: 'Server error', ...(process.env.NODE_ENV !== 'production' ? { details: err.message } : {}) });
  }
});

// Requester declines a quote
router.post('/decline-quote/:id', auth, async (req, res) => {
  try {
    const transaction = isId(req.params.id) ? await prisma.transaction.findFirst({
      where: {
        id: req.params.id,
        requesterId: req.userId,
        status: { in: ['pending', 'accepted'] }
      }
    }) : null;

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const negotiationHistory = Array.isArray(transaction.negotiationHistory) ? transaction.negotiationHistory : [];
    const lastQuote = negotiationHistory.length > 0
      ? negotiationHistory[negotiationHistory.length - 1]
      : null;

    if (lastQuote && lastQuote.status === 'pending') {
      lastQuote.status = 'rejected';
      await prisma.transaction.update({
        where: { id: transaction.id },
        data: { negotiationHistory }
      });
    }

    res.json({ message: 'Quote declined' });
  } catch (err) {
    console.error('Decline quote error:', err);
    res.status(500).json({ error: 'Server error', ...(process.env.NODE_ENV !== 'production' ? { details: err.message } : {}) });
  }
});

// Complete transaction with proof images
// Only the requester (funding buyer) can complete and release escrow.
router.post('/complete/:id', auth, upload.array('proofImages', 10), async (req, res) => {
  try {
    const { rating, review } = req.body;

    const transaction = isId(req.params.id) ? await prisma.transaction.findFirst({
      where: {
        id: req.params.id,
        requesterId: req.userId,
        status: { in: ['accepted', 'in_progress'] }
      }
    }) : null;

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found or not authorized' });
    }

    // Handle uploaded proof images
    const proofImageUrls = req.files && req.files.length > 0 ? await uploadFiles(req.files, 'proof') : [];
    const proofImages = proofImageUrls.map(url => ({
      url,
      uploadedBy: req.userId,
      uploadedAt: new Date(),
      caption: req.body.caption || ''
    }));

    if (proofImages.length === 0) {
      return res.status(400).json({ error: 'At least 1 after photo is required. Please upload proof of completed work.' });
    }

    const allProofImages = [
      ...(Array.isArray(transaction.proofImages) ? transaction.proofImages : []),
      ...proofImages
    ];

    const finalAmount = Number(transaction.negotiatedAmount || 0) || Number(transaction.randAmount || 0);

    let escrowStatus = transaction.escrowStatus;

    // Only handle escrow for escrow payments
    if (transaction.paymentMethod === 'escrow') {
      const requester = await prisma.user.findUnique({ where: { id: transaction.requesterId } });
      const provider = await prisma.user.findUnique({ where: { id: transaction.providerId } });

      if (!requester || !provider) {
        return res.status(400).json({ error: 'Requester or provider not found' });
      }

      // Ensure balances are non-negative and do not exceed escrow held
      const escrowHeld = Number(requester.escrowRand || 0);
      const releaseAmount = Math.min(finalAmount, escrowHeld);
      if (releaseAmount <= 0) {
        return res.status(400).json({ error: 'No escrow funds to release' });
      }

      await prisma.user.update({
        where: { id: requester.id },
        data: { escrowRand: escrowHeld - releaseAmount }
      });
      await prisma.user.update({
        where: { id: provider.id },
        data: {
          randBalance: { increment: releaseAmount },
          totalEarnedRand: { increment: releaseAmount }
        }
      });
      escrowStatus = 'released';
    }

    // Update transaction
    const isRequester = String(transaction.requesterId) === req.userId;
    const ratingData = isRequester
      ? { providerRating: rating ? parseInt(rating) : null, providerReview: review || null }
      : { requesterRating: rating ? parseInt(rating) : null, requesterReview: review || null };

    await prisma.transaction.update({
      where: { id: transaction.id },
      data: {
        proofImages: allProofImages,
        status: 'completed',
        completedAt: new Date(),
        escrowStatus,
        ...ratingData
      }
    });

    // Update provider portfolio
    if (proofImages.length > 0) {
      const provider = await prisma.user.findUnique({ where: { id: transaction.providerId }, select: { portfolioImages: true } });
      if (provider) {
        const portfolioImages = proofImages.map(img => ({
          url: img.url,
          transactionId: transaction.id,
          serviceId: transaction.serviceId,
          uploadedAt: img.uploadedAt,
          caption: img.caption
        }));
        await prisma.user.update({
          where: { id: transaction.providerId },
          data: {
            portfolioImages: [
              ...(Array.isArray(provider.portfolioImages) ? provider.portfolioImages : []),
              ...portfolioImages
            ]
          }
        });
      }
    }

    // Update service completed count
    const service = transaction.serviceId
      ? await prisma.service.findUnique({ where: { id: transaction.serviceId } })
      : null;
    if (service) {
      await prisma.service.update({
        where: { id: service.id },
        data: { completedJobsCount: { increment: 1 } }
      });
    }

    // NEW: If rating provided, create a proper Review document
    if (rating) {
      const reviewerId = req.userId;
      const revieweeId = isRequester ? transaction.providerId : transaction.requesterId;

      // Avoid duplicate
      const existingReview = await prisma.review.findFirst({
        where: { transactionId: transaction.id, reviewerId }
      });
      if (!existingReview) {
        await prisma.review.create({
          data: {
            transactionId: transaction.id,
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
          }
        });

        // Trigger stats recalculation via reviews route helper (imported below)
        // We recalculate here inline to avoid circular deps
        await recalcUserStats(reviewerId);
        await recalcUserStats(revieweeId);
        if (service) await recalcServiceStats(transaction.serviceId);
      }
    }

    res.json({
      message: transaction.paymentMethod === 'cash' ? 'Transaction completed.' : 'Transaction completed. Rand released to provider.',
      proofImages: toDTO(allProofImages)
    });
  } catch (err) {
    console.error('Complete error:', err);
    res.status(500).json({ error: 'Server error', ...(process.env.NODE_ENV !== 'production' ? { details: err.message } : {}) });
  }
});

// Inline stat recalculation helpers (mirrors reviews.js logic)
async function recalcUserStats(userId) {
  const given = await prisma.review.findMany({ where: { reviewerId: userId } });
  const received = await prisma.review.findMany({ where: { revieweeId: userId, isVisible: true } });

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
      const others = await prisma.review.findMany({
        where: { revieweeId: review.revieweeId, reviewerId: { not: userId }, isVisible: true }
      });
      if (others.length > 0) {
        const othersAvg = others.reduce((s, r) => s + r.overallRating, 0) / others.length;
        totalDiff += (othersAvg - review.overallRating);
        count++;
      }
    }
    if (count > 0) complainerScore = Math.min(100, Math.max(0, (totalDiff / count / 1.5) * 100));
  }

  const allTx = await prisma.transaction.findMany({
    where: { OR: [{ requesterId: userId }, { providerId: userId }] },
    select: { status: true }
  });
  const completed = allTx.filter(t => t.status === 'completed');
  const cancelled = allTx.filter(t => t.status === 'cancelled');
  const disputed = allTx.filter(t => t.status === 'disputed');

  const completionRate = allTx.length > 0 ? Math.round((completed.length / allTx.length) * 100) : 100;
  const cancellationRate = allTx.length > 0 ? Math.round((cancelled.length / allTx.length) * 100) : 0;
  const disputeRate = allTx.length > 0 ? Math.round((disputed.length / allTx.length) * 100) : 0;

  const ratingComponent = receivedAvg > 0 ? (receivedAvg / 5) * 100 : 80;
  const behaviorComponent = Math.max(0, 100 - (cancellationRate * 2) - (disputeRate * 5));
  const reliabilityScore = Math.round((completionRate * 0.5) + (ratingComponent * 0.3) + (behaviorComponent * 0.2));

  const jobsCompleted = await prisma.transaction.count({ where: { providerId: userId, status: 'completed' } });
  const jobsRequested = await prisma.transaction.count({
    where: { requesterId: userId, status: { in: ['completed', 'accepted', 'in_progress'] } }
  });

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { flags: true } });
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

    await prisma.user.update({
      where: { id: userId },
      data: {
        ...(newFlags.length > 0 ? { flags: [...flags, ...newFlags] } : {}),
        communityStats: {
          reliabilityScore, givenRatingsAvg: givenAvg, receivedRatingsAvg: receivedAvg,
          totalGivenReviews: given.length, totalReceivedReviews: received.length,
          complainerScore, completionRate, cancellationRate, disputeRate,
          jobsCompleted, jobsRequested
        }
      }
    });
  }
}

async function recalcServiceStats(serviceId) {
  const reviews = await prisma.review.findMany({ where: { serviceId, isVisible: true } });
  const service = await prisma.service.findUnique({ where: { id: serviceId } });
  if (!service) return;
  let data;
  if (reviews.length === 0) {
    data = {
      averageRating: 0,
      totalReviews: 0,
      ratingBreakdown: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    };
  } else {
    const avg = Math.round((reviews.reduce((s, r) => s + r.overallRating, 0) / reviews.length) * 10) / 10;
    const breakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    reviews.forEach(r => { breakdown[r.overallRating] = (breakdown[r.overallRating] || 0) + 1; });
    data = {
      averageRating: avg,
      totalReviews: reviews.length,
      ratingBreakdown: breakdown
    };
  }
  await prisma.service.update({ where: { id: serviceId }, data });
}

// Cancel transaction and refund escrow
router.post('/cancel/:id', auth, async (req, res) => {
  try {
    const transaction = isId(req.params.id) ? await prisma.transaction.findFirst({
      where: {
        id: req.params.id,
        OR: [{ requesterId: req.userId }, { providerId: req.userId }],
        status: { in: ['pending', 'accepted'] }
      }
    }) : null;

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found or cannot be cancelled' });
    }

    let escrowStatus = transaction.escrowStatus;

    // Only refund for escrow payments
    if (transaction.paymentMethod === 'escrow') {
      const amount = Number(transaction.randAmount || 0);
      await prisma.user.update({
        where: { id: transaction.requesterId },
        data: {
          escrowRand: { decrement: amount },
          randBalance: { increment: amount }
        }
      });
      escrowStatus = 'refunded';
    }

    await prisma.transaction.update({
      where: { id: transaction.id },
      data: { status: 'cancelled', escrowStatus }
    });

    res.json({ message: transaction.paymentMethod === 'cash' ? 'Transaction cancelled.' : 'Transaction cancelled. Rand refunded.' });
  } catch (err) {
    console.error('Cancel error:', err);
    res.status(500).json({ error: 'Server error', ...(process.env.NODE_ENV !== 'production' ? { details: err.message } : {}) });
  }
});

// Get user's transactions
router.get('/my-transactions', auth, async (req, res) => {
  try {
    const rows = await prisma.transaction.findMany({
      where: {
        OR: [{ requesterId: req.userId }, { providerId: req.userId }]
      },
      include: {
        service: { select: { id: true, title: true, category: true, lat: true, lng: true } },
        requester: { select: { id: true, name: true } },
        provider: { select: { id: true, name: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Match Mongo populate shape: FK fields hold the populated objects
    const transactions = rows.map(({ service, requester, provider, ...t }) => withLocation({
      ...t,
      serviceId: service
        ? { id: service.id, title: service.title, category: service.category, location: { lat: service.lat, lng: service.lng } }
        : t.serviceId,
      requesterId: requester || t.requesterId,
      providerId: provider || t.providerId
    }));

    res.json(toDTO(transactions));
  } catch (err) {
    console.error('My transactions error:', err);
    res.status(500).json({ error: 'Server error', ...(process.env.NODE_ENV !== 'production' ? { details: err.message } : {}) });
  }
});

// Get provider's completed jobs (for portfolio)
router.get('/provider/:providerId/completed', async (req, res) => {
  try {
    if (!isId(req.params.providerId)) {
      return res.json([]);
    }
    const rows = await prisma.transaction.findMany({
      where: {
        providerId: req.params.providerId,
        status: 'completed'
      },
      include: {
        service: { select: { id: true, title: true, category: true } },
        requester: { select: { id: true, name: true } }
      },
      orderBy: { completedAt: 'desc' }
    });

    const transactions = rows.map(({ service, requester, ...t }) => withLocation({
      ...t,
      serviceId: service || t.serviceId,
      requesterId: requester || t.requesterId
    }));

    res.json(toDTO(transactions));
  } catch (err) {
    console.error('Provider completed error:', err);
    res.status(500).json({ error: 'Server error', ...(process.env.NODE_ENV !== 'production' ? { details: err.message } : {}) });
  }
});

module.exports = router;
