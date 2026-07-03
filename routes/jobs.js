const express = require('express');
const router = express.Router();
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const mongoose = require('mongoose');
const Job = require('../models/Job');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Review = require('../models/Review');
const Notification = require('../models/Notification');
const upload = require('../middleware/upload');
const { uploadFiles } = require('../middleware/upload');
const jwt = require('jsonwebtoken');
const { sendNotification } = require('../utils/notifications');
const { createEscrowTransaction, releaseEscrow, partialReleaseEscrow, refundEscrow } = require('../utils/escrow');

// ─── Auth middleware ───
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

// ─── Fire-and-forget notification (never blocks the response) ───
function notify(req, userId, payload) {
  const io = req.app.get('io');
  const onlineUsers = req.app.get('onlineUsers');
  return sendNotification(io, onlineUsers, userId, payload)
    .catch(err => console.error('[Notify] failed:', err.message));
}

// ─── Haversine distance (km) ───
function getDistanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Public DTO: strip sensitive fields ───
function toPublicJob(job, requesterId) {
  const j = job.toObject ? job.toObject() : job;
  // Never expose internal IDs or sensitive data to public
  delete j.transactionId;
  delete j.qrHandshakes;
  delete j.handshakeLog;
  // Applications: only show public-safe fields
  if (j.applications) {
    j.applications = j.applications.map(a => ({
      _id: a._id,
      proposedAmount: a.proposedAmount,
      proposedTime: a.proposedTime,
      status: a.status,
      message: a.message,
      createdAt: a.createdAt,
      // Always include applicantId so frontend can identify user's own application
      applicantId: a.applicantId,
      // Only show full applicant details if approved/accepted or if viewer is the applicant
      applicant: (a.status === 'approved' || a.status === 'accepted' || String(a.applicantId) === String(requesterId))
        ? a.applicantId
        : undefined
    }));
  }
  return j;
}

// ─── Resolve the requester's own application on a job ───
// The web client ("I'm Helping" tab, the Confirm/Decline buttons and the job
// detail modal) keys entirely off `job.myApplication`. If the API never sends
// it, the applicant can never see the "Confirm" action after the poster
// approves them — so the poster sits forever on "Waiting for applicant
// confirmation". This returns the requester's own application sub-document as a
// plain object (or null) so it can be attached to the response payload.
function findMyApplication(applications, userId) {
  if (!Array.isArray(applications) || !userId) return null;
  const mine = applications.find(a => {
    const aid = a && a.applicantId && (a.applicantId._id || a.applicantId);
    return aid && String(aid) === String(userId);
  });
  if (!mine) return null;
  return mine.toObject ? mine.toObject() : mine;
}

// ─── Validation helpers ───
const MAX_TITLE = 120;
const MAX_DESC = 5000;
const MAX_CATEGORY = 60;
const MAX_TAG = 30;
const MAX_MESSAGE = 500;
const MAX_NOTE = 280;
const MAX_REVIEW = 2000;
const QR_PROXIMITY_KM = 0.5; // 500m

function sanitizeString(str, maxLen) {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, maxLen);
}

// ─── Rate limit job creation per user (prevents job-spam / DB bloat) ───
// Keyed by the authenticated user, falling back to a normalised client IP.
const createJobLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  keyGenerator: (req, res) => req.userId || ipKeyGenerator(req, res),
  message: { error: 'You are posting jobs too quickly. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

// ─── Resolve whether a user is a party (poster or accepted provider) to a job ───
// Used to authorize job-scoped mutations so a third party can't upload proof
// photos or file issue reports on jobs they aren't part of.
function getJobParties(job, userId) {
  const isPoster = String(job.posterId) === String(userId);
  const acceptedApp = job.applications &&
    job.applications.find(a => String(a._id) === String(job.acceptedApplicationId));
  const isProvider = !!(acceptedApp && String(acceptedApp.applicantId) === String(userId));
  return { isPoster, isProvider, isParty: isPoster || isProvider, acceptedApp };
}

// ─── GET /api/jobs — Browse / Nearby ───
router.get('/', async (req, res) => {
  try {
    const { lat, lng, radius, category, status, search, page = 1, limit = 20 } = req.query;
    const query = {};

    // Only show public-visible jobs
    if (status) {
      // Handle comma-separated status values or array
      let statusValues;
      if (Array.isArray(status)) {
        statusValues = status.map(s => s.trim()).filter(Boolean);
      } else if (typeof status === 'string' && status.includes(',')) {
        statusValues = status.split(',').map(s => s.trim()).filter(Boolean);
      } else {
        statusValues = [status];
      }
      if (statusValues.length > 1) {
        query.status = { $in: statusValues };
      } else {
        query.status = statusValues[0];
      }
    } else {
      query.status = { $in: ['open', 'negotiating', 'approved'] };
    }

    // Always show jobs that are live (no publishAt in future, no expiresAt in past)
    query.$and = query.$and || [];
    query.$and.push({
      $or: [
        { publishAt: { $exists: false } },
        { publishAt: null },
        { publishAt: { $lte: new Date() } }
      ]
    });

    // Also filter out expired jobs at DB level
    query.$and.push({
      $or: [
        { expiresAt: { $exists: false } },
        { expiresAt: null },
        { expiresAt: { $gte: new Date() } }
      ]
    });

    // Ensure jobs have valid location data
    query.$and.push({
      $and: [
        { 'location.lat': { $exists: true, $ne: null } },
        { 'location.lng': { $exists: true, $ne: null } }
      ]
    });

    if (category) query.category = category;

    // Text search on title/description
    if (search) {
      query.$and.push({
        $or: [
          { title: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } }
        ]
      });
    }

    // Geo filter
    let jobs = await Job.find(query)
      .populate('posterId', 'name avatar rating reviewCount')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit) * 2); // fetch extra for geo filtering

    if (lat && lng) {
      const latNum = parseFloat(lat);
      const lngNum = parseFloat(lng);
      const rNum = Math.min(parseFloat(radius) || 50, 50);
      jobs = jobs.filter(j => {
        if (!j.location || !j.location.lat || !j.location.lng) return false;
        return getDistanceKm(latNum, lngNum, j.location.lat, j.location.lng) <= rNum;
      });
    }

    // Pagination
    const start = (parseInt(page) - 1) * parseInt(limit);
    const paginated = jobs.slice(start, start + parseInt(limit));

    // Public DTO
    const token = req.headers.authorization?.split(' ')[1];
    let reqUserId = null;
    if (token) {
      try { reqUserId = jwt.verify(token, process.env.JWT_SECRET).userId; } catch (e) {}
    }

    res.json(paginated.map(j => {
      const pub = toPublicJob(j, reqUserId);
      pub.myApplication = findMyApplication(j.applications, reqUserId);
      return pub;
    }));
  } catch (err) {
    console.error('Browse jobs error:', err);
    res.status(500).json({ error: 'Server error fetching jobs' });
  }
});

// ─── GET /api/jobs/my-jobs ───
router.get('/my-jobs', auth, async (req, res) => {
  try {
    const jobs = await Job.find({ posterId: req.userId })
      .populate('applications.applicantId', 'name avatar rating')
      .populate('acceptedApplicationId', 'applicantId')
      .sort({ createdAt: -1 });
    res.json(jobs.map(j => {
      const obj = j.toObject();
      obj.myApplication = findMyApplication(obj.applications, req.userId);
      return obj;
    }));
  } catch (err) {
    console.error('My jobs error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── GET /api/jobs/my-applications ───
router.get('/my-applications', auth, async (req, res) => {
  try {
    const jobs = await Job.find({ 'applications.applicantId': req.userId })
      .populate('posterId', 'name avatar rating')
      .populate('applications.applicantId', 'name avatar rating')
      .sort({ createdAt: -1 });
    res.json(jobs.map(j => {
      const obj = j.toObject();
      obj.myApplication = findMyApplication(obj.applications, req.userId);
      return obj;
    }));
  } catch (err) {
    console.error('My applications error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── GET /api/jobs/portfolio/:providerId — MUST be before /:id ───
router.get('/portfolio/:providerId', async (req, res) => {
  try {
    const { providerId } = req.params;
    const jobs = await Job.find({
      status: 'completed',
      acceptedApplicationId: { $exists: true, $ne: null }
    })
      .populate('posterId', 'name avatar')
      .populate('applications.applicantId', 'name avatar')
      .sort({ completedAt: -1 })
      .limit(50);

    // Filter to only jobs where the provider was the accepted applicant
    const providerJobs = jobs.filter(j => {
      const app = j.applications.find(a => String(a._id) === String(j.acceptedApplicationId));
      return app && String(app.applicantId?._id || app.applicantId) === providerId;
    });

    res.json(providerJobs.map(j => toPublicJob(j, null)));
  } catch (err) {
    console.error('Portfolio error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── GET /api/jobs/:id ───
router.get('/:id', async (req, res) => {
  try {
    const job = await Job.findById(req.params.id)
      .populate('posterId', 'name avatar rating reviewCount')
      .populate('applications.applicantId', 'name avatar rating')
      .populate('workProofPhotos.uploadedBy', 'name avatar');

    if (!job) return res.status(404).json({ error: 'Job not found' });

    const token = req.headers.authorization?.split(' ')[1];
    let reqUserId = null;
    if (token) {
      try { reqUserId = jwt.verify(token, process.env.JWT_SECRET).userId; } catch (e) {}
    }

    // Full detail for poster or accepted applicant
    const isPoster = String(job.posterId?._id || job.posterId) === reqUserId;
    const isAcceptedApplicant = job.applications.some(a =>
      String(a.applicantId?._id || a.applicantId) === reqUserId &&
      (a.status === 'approved' || a.status === 'accepted')
    );

    const myApplication = findMyApplication(job.applications, reqUserId);

    if (isPoster || isAcceptedApplicant) {
      const obj = job.toObject();
      obj.myApplication = myApplication;
      return res.json(obj);
    }

    const pub = toPublicJob(job, reqUserId);
    pub.myApplication = myApplication;
    res.json(pub);
  } catch (err) {
    console.error('Get job error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/jobs — Create job ───
router.post('/', auth, createJobLimiter, upload.array('images', 10), async (req, res) => {
  try {
    const { title, description, category, budget, budgetMin, budgetMax, isUrgent, lat, lng, scheduledDate, proposedTime, timeIsNegotiable, applicationDeadline, estimatedDuration, tags, paymentMethod } = req.body;

    // ── Validation ──
    let latVal = lat !== undefined ? lat : req.body.location?.lat;
    let lngVal = lng !== undefined ? lng : req.body.location?.lng;
    
    // Handle JSON string location (backward compatibility)
    if (latVal === undefined && req.body.location && typeof req.body.location === 'string') {
      try {
        const parsedLoc = JSON.parse(req.body.location);
        latVal = parsedLoc.lat;
        lngVal = parsedLoc.lng;
      } catch (e) {
        // Invalid JSON, will fail validation below
      }
    }
    
    if (!title || !description || !category || !budget || latVal === undefined || lngVal === undefined) {
      return res.status(400).json({ error: 'Missing required fields: title, description, category, budget, lat, lng' });
    }

    const latNum = parseFloat(latVal);
    const lngNum = parseFloat(lngVal);
    if (isNaN(latNum) || isNaN(lngNum) || latNum < -90 || latNum > 90 || lngNum < -180 || lngNum > 180) {
      return res.status(400).json({ error: 'Invalid coordinates' });
    }

    const budgetNum = parseFloat(budget);
    if (isNaN(budgetNum) || budgetNum <= 0) {
      return res.status(400).json({ error: 'Invalid budget' });
    }

    const cleanTitle = sanitizeString(title, MAX_TITLE);
    const cleanDesc = sanitizeString(description, MAX_DESC);
    const cleanCategory = sanitizeString(category, MAX_CATEGORY);
    const cleanTags = tags ? (Array.isArray(tags) ? tags : tags.split(',')).map(t => sanitizeString(t, MAX_TAG)).filter(Boolean) : [];

    const uploadedImageUrls = req.files && req.files.length > 0
      ? await uploadFiles(req.files, 'jobs')
      : [];
    const images = uploadedImageUrls.map(url => ({
      url,
      caption: '',
      uploadedAt: new Date()
    }));

    const job = new Job({
      posterId: req.userId,
      title: cleanTitle,
      description: cleanDesc,
      category: cleanCategory,
      budget: budgetNum,
      budgetMin: budgetMin ? parseFloat(budgetMin) : undefined,
      budgetMax: budgetMax ? parseFloat(budgetMax) : undefined,
      isUrgent: isUrgent === 'true' || isUrgent === true,
      paymentMethod: ['escrow', 'cash'].includes(paymentMethod) ? paymentMethod : 'cash',
      location: { lat: latNum, lng: lngNum },
      images,
      scheduledDate: scheduledDate ? new Date(scheduledDate) : undefined,
      proposedTime: proposedTime ? new Date(proposedTime) : undefined,
      timeIsNegotiable: timeIsNegotiable !== 'false',
      applicationDeadline: applicationDeadline ? new Date(applicationDeadline) : undefined,
      estimatedDuration: estimatedDuration ? sanitizeString(estimatedDuration, 50) : undefined,
      tags: cleanTags
    });

    await job.save();
    res.status(201).json({ message: 'Job posted', job: { _id: job._id } });

    // Notify nearby online users about the new job (after responding)
    try {
      const io = req.app.get('io');
      const onlineUsers = req.app.get('onlineUsers');
      if (io && onlineUsers && onlineUsers.size > 0) {
        const NEARBY_KM = 20;
        const onlineUserIds = Array.from(onlineUsers.keys());
        const nearbyUsers = await User.find({ _id: { $in: onlineUserIds } }).select('location');
        for (const u of nearbyUsers) {
          if (String(u._id) === String(req.userId)) continue;
          const ulat = u.location?.lat;
          const ulng = u.location?.lng;
          if (ulat == null || ulng == null) continue;
          const dist = getDistanceKm(latNum, lngNum, ulat, ulng);
          if (dist <= NEARBY_KM) {
            notify(req, u._id, {
              type: 'job_nearby',
              title: job.isUrgent ? '🚨 Urgent Job Nearby!' : 'New Job Nearby!',
              message: `"${job.title}" — R${job.budgetMin || job.budget}${job.budgetMax ? `–R${job.budgetMax}` : ''}, ${dist < 1 ? '<1' : Math.round(dist)}km away`,
              jobId: job._id
            });
          }
        }
      }
    } catch (notifyErr) {
      console.error('Nearby job notify error:', notifyErr.message);
    }
  } catch (err) {
    console.error('Create job error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/jobs/:id/apply ───
router.post('/:id/apply', auth, async (req, res) => {
  try {
    const { proposedAmount, proposedTime, message } = req.body;
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.status !== 'open') return res.status(400).json({ error: 'Job is no longer open for applications' });
    if (String(job.posterId) === req.userId) return res.status(403).json({ error: 'Cannot apply to your own job' });

    const amount = parseFloat(proposedAmount);
    if (isNaN(amount) || amount <= 0) return res.status(400).json({ error: 'Invalid proposed amount' });

    // ── Duplicate application guard (atomic) ──
    const updated = await Job.findOneAndUpdate(
      { _id: req.params.id, 'applications.applicantId': { $ne: req.userId } },
      {
        $push: {
          applications: {
            applicantId: req.userId,
            proposedAmount: amount,
            proposedTime: proposedTime ? new Date(proposedTime) : undefined,
            message: message ? sanitizeString(message, MAX_MESSAGE) : '',
            status: 'pending',
            createdAt: new Date()
          }
        }
      },
      { new: true }
    );

    if (!updated) {
      // Check if already applied
      const existing = await Job.findById(req.params.id);
      const already = existing.applications.find(a => String(a.applicantId) === req.userId);
      if (already) return res.status(409).json({ error: 'You have already applied to this job' });
      return res.status(500).json({ error: 'Application failed' });
    }

    res.json({ message: 'Application submitted' });

    // Notify the job poster about the new application (after responding)
    try {
      const applicant = await User.findById(req.userId).select('name');
      notify(req, updated.posterId, {
        type: 'application_received',
        title: 'New Offer to Help!',
        message: `${applicant?.name || 'Someone'} offered R${amount} for "${updated.title}"`,
        jobId: updated._id
      });
    } catch (notifyErr) {
      console.error('Apply notify error:', notifyErr.message);
    }
  } catch (err) {
    console.error('Apply error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/jobs/:id/applications/:appId/approve ───
router.post('/:id/applications/:appId/approve', auth, async (req, res) => {
  try {
    const { approvedAmount, approvedTime } = req.body;

    // ── Atomic conditional update: only approve if status is open ──
    const job = await Job.findOneAndUpdate(
      {
        _id: req.params.id,
        posterId: req.userId,
        status: 'open',
        'applications._id': req.params.appId
      },
      {
        $set: {
          status: 'approved',
          acceptedApplicationId: req.params.appId,
          'applications.$.status': 'approved',
          'applications.$.approvedAmount': approvedAmount ? parseFloat(approvedAmount) : undefined,
          'applications.$.approvedTime': approvedTime ? new Date(approvedTime) : undefined
        }
      },
      { new: true }
    );

    if (!job) {
      const check = await Job.findById(req.params.id);
      if (!check) return res.status(404).json({ error: 'Job not found' });
      if (String(check.posterId) !== req.userId) return res.status(403).json({ error: 'Not authorized' });
      if (check.status !== 'open') return res.status(400).json({ error: `Cannot approve: job is ${check.status}` });
      return res.status(404).json({ error: 'Application not found' });
    }

    res.json({ message: 'Application approved' });

    try {
      const approvedApp = job.applications.id(req.params.appId);
      if (approvedApp) {
        notify(req, approvedApp.applicantId, {
          type: 'application_approved',
          title: 'Your Offer Was Approved! 🎉',
          message: `You got "${job.title}" — confirm now to lock it in`,
          jobId: job._id
        });
      }
    } catch (notifyErr) {
      console.error('Approve notify error:', notifyErr.message);
    }
  } catch (err) {
    console.error('Approve error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/jobs/:id/applications/:appId/reject ───
router.post('/:id/applications/:appId/reject', auth, async (req, res) => {
  try {
    const { motivation } = req.body;
    const job = await Job.findOneAndUpdate(
      { _id: req.params.id, posterId: req.userId, 'applications._id': req.params.appId },
      {
        $set: {
          'applications.$.status': 'rejected',
          'applications.$.rejectionMotivation': motivation ? sanitizeString(motivation, MAX_MESSAGE) : ''
        }
      },
      { new: true }
    );
    if (!job) return res.status(404).json({ error: 'Job or application not found' });
    res.json({ message: 'Application rejected' });

    try {
      const rejectedApp = job.applications.id(req.params.appId);
      if (rejectedApp) {
        notify(req, rejectedApp.applicantId, {
          type: 'application_rejected',
          title: 'Application Update',
          message: `Your offer for "${job.title}" wasn't selected this time — keep going!`,
          jobId: job._id
        });
      }
    } catch (notifyErr) {
      console.error('Reject notify error:', notifyErr.message);
    }
  } catch (err) {
    console.error('Reject error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/jobs/:id/applications/:appId/negotiate ───
router.post('/:id/applications/:appId/negotiate', auth, async (req, res) => {
  try {
    const { amount, proposedTime, message } = req.body;
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const app = job.applications.id(req.params.appId);
    if (!app) return res.status(404).json({ error: 'Application not found' });

    const isPoster = String(job.posterId) === req.userId;
    const isApplicant = String(app.applicantId) === req.userId;
    if (!isPoster && !isApplicant) return res.status(403).json({ error: 'Not authorized' });

    app.negotiationHistory = app.negotiationHistory || [];
    app.negotiationHistory.push({
      proposedBy: req.userId,
      amount: parseFloat(amount) || app.proposedAmount,
      proposedTime: proposedTime ? new Date(proposedTime) : undefined,
      message: message ? sanitizeString(message, MAX_MESSAGE) : '',
      status: 'pending',
      createdAt: new Date()
    });
    app.status = 'negotiating';
    await job.save();

    res.json({ message: 'Negotiation sent' });

    try {
      const counterparty = isPoster ? app.applicantId : job.posterId;
      notify(req, counterparty, {
        type: 'negotiation_updated',
        title: 'New Counter Offer 🤝',
        message: `R${parseFloat(amount) || app.proposedAmount} proposed for "${job.title}"`,
        jobId: job._id
      });
    } catch (notifyErr) {
      console.error('Negotiate notify error:', notifyErr.message);
    }
  } catch (err) {
    console.error('Negotiate error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/jobs/:id/applications/:appId/accept-offer ───
router.post('/:id/applications/:appId/accept-offer', auth, async (req, res) => {
  try {
    const job = await Job.findOneAndUpdate(
      {
        _id: req.params.id,
        'applications._id': req.params.appId,
        'applications.applicantId': new mongoose.Types.ObjectId(req.userId),
        status: 'approved'
      },
      { $set: { status: 'accepted', 'applications.$.status': 'accepted' } },
      { new: true }
    );
    if (!job) return res.status(400).json({ error: 'Cannot accept offer' });
    res.json({ message: 'Offer accepted' });

    notify(req, job.posterId, {
      type: 'offer_accepted',
      title: 'Offer Accepted ✅',
      message: `Your helper accepted the offer for "${job.title}"`,
      jobId: job._id
    });
  } catch (err) {
    console.error('Accept offer error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/jobs/:id/applications/:appId/reject-offer ───
router.post('/:id/applications/:appId/reject-offer', auth, async (req, res) => {
  try {
    const job = await Job.findOneAndUpdate(
      { _id: req.params.id, 'applications._id': req.params.appId, 'applications.applicantId': new mongoose.Types.ObjectId(req.userId) },
      { $set: { 'applications.$.status': 'rejected' } },
      { new: true }
    );
    if (!job) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Offer rejected' });

    notify(req, job.posterId, {
      type: 'offer_rejected',
      title: 'Offer Declined',
      message: `Your offer for "${job.title}" was declined — you can send a new one`,
      jobId: job._id
    });
  } catch (err) {
    console.error('Reject offer error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/jobs/:id/applications/:appId/confirm — Helper confirms approved offer ───
// Mutual acceptance point: this is where the escrow is funded. For escrow jobs
// the poster's balance moves into escrowRand and a Transaction is created; for
// cash jobs a Transaction record is still created (escrowStatus 'none') so the
// job has a payment record either way.
router.post('/:id/applications/:appId/confirm', auth, async (req, res) => {
  try {
    // Pre-check: for escrow jobs the poster must be able to fund the agreed
    // amount. Checked before the status flip so a failed confirm leaves the
    // job in 'approved' and the parties can top up / renegotiate.
    const preJob = await Job.findOne({
      _id: req.params.id,
      'applications._id': req.params.appId,
      'applications.applicantId': new mongoose.Types.ObjectId(req.userId),
      status: 'approved'
    });
    if (!preJob) return res.status(400).json({ error: 'Cannot confirm: offer not approved or already handled' });

    const preApp = preJob.applications.id(req.params.appId);
    const finalAmount = preApp?.approvedAmount ?? preApp?.proposedAmount ?? preJob.budget;

    if (preJob.paymentMethod === 'escrow') {
      const poster = await User.findById(preJob.posterId).select('randBalance');
      if (!poster || (poster.randBalance || 0) < finalAmount) {
        notify(req, preJob.posterId, {
          type: 'escrow_funding_failed',
          title: 'Escrow Funding Needed ⚠️',
          message: `Your balance is too low to fund R${finalAmount} escrow for "${preJob.title}". Top up so your helper can confirm.`,
          jobId: preJob._id
        });
        return res.status(400).json({
          error: `The poster's balance can't cover the R${finalAmount} escrow yet. They've been notified to top up.`
        });
      }
    }

    const job = await Job.findOneAndUpdate(
      {
        _id: req.params.id,
        'applications._id': req.params.appId,
        'applications.applicantId': new mongoose.Types.ObjectId(req.userId),
        status: 'approved',
        'applications.status': 'approved'
      },
      { $set: { status: 'accepted', 'applications.$.status': 'accepted' } },
      { new: true }
    );
    if (!job) return res.status(400).json({ error: 'Cannot confirm: offer not approved or already handled' });

    // Fund escrow / create the payment record. createEscrowTransaction is
    // idempotent per job, so a concurrent double-confirm can't double-fund.
    try {
      const acceptedApp = job.applications.id(req.params.appId);
      const transaction = await createEscrowTransaction(job, acceptedApp, finalAmount);
      job.transactionId = transaction._id;
      await job.save();
    } catch (escrowErr) {
      // Rare race: balance dropped between pre-check and funding. Roll the job
      // back to 'approved' so the flow can be retried, and tell both sides.
      await Job.updateOne(
        { _id: job._id, status: 'accepted' },
        { $set: { status: 'approved', 'applications.$[app].status': 'approved' } },
        { arrayFilters: [{ 'app._id': job.acceptedApplicationId }] }
      );
      if (escrowErr.code === 'INSUFFICIENT_BALANCE') {
        return res.status(400).json({ error: 'The poster\'s balance can\'t cover the escrow. They\'ve been notified.' });
      }
      throw escrowErr;
    }

    res.json({ message: 'Offer confirmed', escrowFunded: job.paymentMethod === 'escrow', amount: finalAmount });

    notify(req, job.posterId, {
      type: 'schedule_confirmed',
      title: 'Job Confirmed 📅',
      message: job.paymentMethod === 'escrow'
        ? `Your helper confirmed "${job.title}" — R${finalAmount} is now held in escrow.`
        : `Your helper confirmed "${job.title}" — it's locked in! (Cash: R${finalAmount})`,
      jobId: job._id
    });
  } catch (err) {
    console.error('Confirm error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/jobs/:id/start — Poster starts job after helper confirms ───
router.post('/:id/start', auth, async (req, res) => {
  try {
    const job = await Job.findOneAndUpdate(
      {
        _id: req.params.id,
        posterId: req.userId,
        status: 'accepted'
      },
      { $set: { status: 'in_progress', startedAt: new Date() } },
      { new: true }
    );
    if (!job) return res.status(400).json({ error: 'Cannot start job' });
    res.json({ message: 'Job started' });

    try {
      const acceptedApp = job.applications.id(job.acceptedApplicationId);
      if (acceptedApp) {
        notify(req, acceptedApp.applicantId, {
          type: 'job_started',
          title: 'Job Started 🚀',
          message: `"${job.title}" is now in progress`,
          jobId: job._id
        });
      }
    } catch (notifyErr) {
      console.error('Start notify error:', notifyErr.message);
    }
  } catch (err) {
    console.error('Start job error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/jobs/:id/applications/:appId/decline ───
router.post('/:id/applications/:appId/decline', auth, async (req, res) => {
  try {
    const job = await Job.findOneAndUpdate(
      { _id: req.params.id, posterId: req.userId, 'applications._id': req.params.appId },
      { $set: { 'applications.$.status': 'rejected' } },
      { new: true }
    );
    if (!job) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Declined' });
  } catch (err) {
    console.error('Decline error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/jobs/:id/applications/:appId/withdraw ───
router.post('/:id/applications/:appId/withdraw', auth, async (req, res) => {
  try {
    const job = await Job.findOneAndUpdate(
      { _id: req.params.id, 'applications._id': req.params.appId, 'applications.applicantId': req.userId },
      { $set: { 'applications.$.status': 'withdrawn' } },
      { new: true }
    );
    if (!job) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Application withdrawn' });

    notify(req, job.posterId, {
      type: 'application_withdrawn',
      title: 'Application Withdrawn',
      message: `A helper withdrew their offer for "${job.title}"`,
      jobId: job._id
    });
  } catch (err) {
    console.error('Withdraw error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/jobs/:id/cancel ───
router.post('/:id/cancel', auth, async (req, res) => {
  try {
    const job = await Job.findOne({ _id: req.params.id, posterId: req.userId });
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!['open', 'negotiating', 'approved'].includes(job.status)) {
      return res.status(400).json({ error: `Cannot cancel job in ${job.status} status` });
    }
    job.status = 'cancelled';
    await job.save();
    res.json({ message: 'Job cancelled' });

    try {
      // Notify everyone who applied and wasn't already rejected/withdrawn
      const toNotify = (job.applications || [])
        .filter(a => !['rejected', 'withdrawn'].includes(a.status))
        .map(a => String(a.applicantId));
      for (const uid of [...new Set(toNotify)]) {
        notify(req, uid, {
          type: 'job_cancelled',
          title: 'Job Cancelled',
          message: `"${job.title}" was cancelled by the poster`,
          jobId: job._id
        });
      }
    } catch (notifyErr) {
      console.error('Cancel notify error:', notifyErr.message);
    }
  } catch (err) {
    console.error('Cancel error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/jobs/:id/ping ───
router.post('/:id/ping', auth, async (req, res) => {
  try {
    const { type = 'manual' } = req.body;
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const app = job.applications.find(a => String(a.applicantId) === req.userId);
    if (!app) return res.status(403).json({ error: 'Not an applicant' });

    app.pingCount = (app.pingCount || 0) + 1;
    app.lastPingAt = new Date();
    if (!app.firstPingAt) app.firstPingAt = new Date();
    app.pingLog = app.pingLog || [];
    app.pingLog.push({ type, sentAt: new Date() });
    await job.save();

    res.json({ message: 'Ping sent', pingCount: app.pingCount });

    notify(req, job.posterId, {
      type: 'doorbell_rung',
      title: 'Ding dong! 🔔',
      message: `Your helper for "${job.title}" is trying to reach you`,
      jobId: job._id
    });
  } catch (err) {
    console.error('Ping error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/jobs/:id/flag-late-provider ───
router.post('/:id/flag-late-provider', auth, async (req, res) => {
  try {
    const job = await Job.findOne({ _id: req.params.id, posterId: req.userId });
    if (!job) return res.status(404).json({ error: 'Job not found' });
    // Just log it; actual logic handled by frontend or cron
    res.json({ message: 'Flag recorded' });
  } catch (err) {
    console.error('Flag error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/jobs/:id/report-issue ───
router.post('/:id/report-issue', auth, upload.array('photos', 10), async (req, res) => {
  try {
    const { note } = req.body;
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    // Only the poster or the accepted provider may report an issue on this job.
    if (!getJobParties(job, req.userId).isParty) {
      return res.status(403).json({ error: 'Not authorized for this job' });
    }

    const lat = req.body.lat != null ? parseFloat(req.body.lat) : undefined;
    const lng = req.body.lng != null ? parseFloat(req.body.lng) : undefined;
    const geo = (Number.isFinite(lat) && Number.isFinite(lng)) ? { lat, lng } : undefined;
    const photoUrls = req.files && req.files.length > 0 ? await uploadFiles(req.files, 'proof') : [];
    const photos = photoUrls.map(url => ({
      url,
      location: geo,
      uploadedAt: new Date()
    }));

    job.issueReports.push({
      reporterId: req.userId,
      kind: 'issue',
      note: note ? sanitizeString(note, 1200) : '',
      photos,
      createdAt: new Date()
    });
    await job.save();

    res.json({ message: 'Issue reported' });
  } catch (err) {
    console.error('Report issue error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/jobs/:id/upload-proof ───
router.post('/:id/upload-proof', auth, upload.array('photos', 10), async (req, res) => {
  try {
    const { stage, note } = req.body;
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    // Only the poster or the accepted provider may attach proof photos.
    if (!getJobParties(job, req.userId).isParty) {
      return res.status(403).json({ error: 'Not authorized for this job' });
    }

    // Validate stage whitelist
    const validStages = ['before', 'during', 'after'];
    const cleanStage = validStages.includes(stage) ? stage : 'during';

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'At least one photo required' });
    }

    // Validate max 10 files
    if (req.files.length > 10) {
      return res.status(413).json({ error: 'Maximum 10 photos allowed per upload' });
    }

    // Geo-tag proof photos (sent by the in-app camera). One lat/lng applies to
    // this capture batch; stored per-photo so completion evidence is verifiable.
    const lat = req.body.lat != null ? parseFloat(req.body.lat) : undefined;
    const lng = req.body.lng != null ? parseFloat(req.body.lng) : undefined;
    const geo = (Number.isFinite(lat) && Number.isFinite(lng)) ? { lat, lng } : undefined;
    const photoUrls = req.files && req.files.length > 0 ? await uploadFiles(req.files, 'proof') : [];
    const photos = photoUrls.map(url => ({
      url,
      uploadedBy: req.userId,
      stage: cleanStage,
      location: geo,
      note: note ? sanitizeString(note, MAX_NOTE) : '',
      uploadedAt: new Date()
    }));

    job.workProofPhotos.push(...photos);
    await job.save();

    res.json({ message: `${cleanStage.charAt(0).toUpperCase() + cleanStage.slice(1)} photos uploaded`, count: photos.length });
  } catch (err) {
    console.error('Upload proof error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/jobs/:id/stop-job ───
router.post('/:id/stop-job', auth, upload.array('stopPhotos', 10), async (req, res) => {
  try {
    const { reason } = req.body;
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (String(job.posterId) !== req.userId) return res.status(403).json({ error: 'Only poster can stop job' });

    // ── Block stop after payment pending ──
    if (['pending_payment', 'completed'].includes(job.status)) {
      return res.status(400).json({ error: `Cannot stop job in ${job.status} status` });
    }

    if (!['in_progress', 'pending_review', 'approved', 'accepted'].includes(job.status)) {
      return res.status(400).json({ error: `Cannot stop job in ${job.status} status` });
    }

    // Validate max 10 stop photos
    if (req.files && req.files.length > 10) {
      return res.status(413).json({ error: 'Maximum 10 stop photos allowed' });
    }

    const stopPhotoUrls = req.files && req.files.length > 0 ? await uploadFiles(req.files, 'proof') : [];
    const stopPhotos = stopPhotoUrls.map(url => ({
      url,
      uploadedAt: new Date()
    }));

    job.issueReports.push({
      reporterId: req.userId,
      kind: 'stop_request',
      note: reason ? sanitizeString(reason, 1200) : 'Job stopped by poster',
      photos: stopPhotos,
      createdAt: new Date()
    });
    job.status = 'cancelled';
    job.stoppedAt = new Date();
    job.stoppedBy = req.userId;
    await job.save();

    // Return any held escrow to the poster. refundEscrow is idempotent and
    // leaves any already-partially-released amount with the provider.
    let refunded = 0;
    try {
      const transaction = job.transactionId
        ? await Transaction.findById(job.transactionId)
        : await Transaction.findOne({ jobId: job._id, escrowStatus: 'held' });
      if (transaction && transaction.escrowStatus === 'held') {
        const alreadyReleased = transaction.partialReleaseAmount || 0;
        refunded = Math.max(0, (transaction.randAmount || 0) - alreadyReleased);
        await refundEscrow(transaction);
      }
    } catch (refundErr) {
      console.error('Stop-job escrow refund error:', refundErr);
    }

    res.json({ message: refunded > 0 ? `Job stopped. R${refunded} escrow refunded to your balance.` : 'Job stopped', refundedAmount: refunded });
  } catch (err) {
    console.error('Stop job error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/jobs/:id/complete ───
router.post('/:id/complete', auth, upload.array('photos', 10), async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const app = job.applications.find(a => String(a._id) === String(job.acceptedApplicationId));
    const isProvider = app && String(app.applicantId) === req.userId;
    if (!isProvider) return res.status(403).json({ error: 'Only accepted provider can complete' });

    if (job.status !== 'in_progress') return res.status(400).json({ error: `Cannot complete: job is ${job.status}` });

    const completionPhotoUrls = req.files && req.files.length > 0 ? await uploadFiles(req.files, 'proof') : [];
    const photos = completionPhotoUrls.map(url => ({
      url,
      lat: req.body.lat ? parseFloat(req.body.lat) : undefined,
      lng: req.body.lng ? parseFloat(req.body.lng) : undefined,
      uploadedAt: new Date()
    }));

    job.status = 'pending_review';
    job.helperCompletedAt = new Date();
    job.completionRequest = {
      initiatedBy: req.userId,
      initiatorPhotos: photos,
      status: 'pending',
      createdAt: new Date()
    };
    await job.save();

    res.json({ message: 'Completion submitted, awaiting poster confirmation' });

    notify(req, job.posterId, {
      type: 'completion_requested',
      title: 'Work Done — Please Confirm 🔔',
      message: `Your helper marked "${job.title}" as complete. Check & confirm to release payment.`,
      jobId: job._id
    });
  } catch (err) {
    console.error('Complete error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/jobs/:id/confirm-completion ───
router.post('/:id/confirm-completion', auth, upload.array('photos', 10), async (req, res) => {
  try {
    const { rating, comment } = req.body;
    const job = await Job.findOne({ _id: req.params.id, posterId: req.userId });
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.status !== 'pending_review') return res.status(400).json({ error: `Cannot confirm: job is ${job.status}` });

    // ── Rating validation ──
    const ratingNum = parseInt(rating);
    if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ error: 'Rating must be an integer between 1 and 5' });
    }

    const confirmPhotoUrls = req.files && req.files.length > 0 ? await uploadFiles(req.files, 'proof') : [];
    const photos = confirmPhotoUrls.map(url => ({
      url,
      uploadedAt: new Date()
    }));

    job.status = 'pending_payment';
    job.posterConfirmedAt = new Date();
    job.posterReviewed = true;
    job.posterReview = {
      overallRating: ratingNum,
      comment: comment ? sanitizeString(comment, MAX_REVIEW) : '',
      createdAt: new Date()
    };
    await job.save();

    res.json({ message: 'Completion confirmed, awaiting payment' });

    try {
      const acceptedApp = job.applications.find(a => String(a._id) === String(job.acceptedApplicationId));
      if (acceptedApp) {
        notify(req, acceptedApp.applicantId, {
          type: 'job_pending_payment',
          title: 'Completion Confirmed 💳',
          message: `"${job.title}" confirmed — payment handshake is next`,
          jobId: job._id
        });
      }
    } catch (notifyErr) {
      console.error('Confirm completion notify error:', notifyErr.message);
    }
  } catch (err) {
    console.error('Confirm completion error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/jobs/:id/review ───
router.post('/:id/review', auth, async (req, res) => {
  try {
    const { rating, overallRating, comment, target } = req.body;
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.status !== 'completed' && job.status !== 'pending_payment' && job.status !== 'in_progress' && job.status !== 'pending_review') {
      return res.status(400).json({ error: 'Job not ready for review' });
    }

    const ratingNum = parseInt(rating !== undefined ? rating : overallRating);
    if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ error: 'Rating must be an integer between 1 and 5' });
    }

    const isPoster = String(job.posterId) === req.userId;
    const app = job.applications.find(a => String(a._id) === String(job.acceptedApplicationId));
    const isProvider = app && String(app.applicantId) === req.userId;

    // Auto-detect target if not provided
    let reviewTarget = target;
    if (!reviewTarget) {
      if (isPoster) reviewTarget = 'provider';
      else if (isProvider) reviewTarget = 'poster';
    }

    if (isPoster && reviewTarget === 'provider') {
      job.posterReviewed = true;
      job.posterReview = {
        overallRating: ratingNum,
        comment: comment ? sanitizeString(comment, MAX_REVIEW) : '',
        createdAt: new Date()
      };
    } else if (isProvider && reviewTarget === 'poster') {
      job.providerReviewed = true;
      job.providerReview = {
        overallRating: ratingNum,
        comment: comment ? sanitizeString(comment, MAX_REVIEW) : '',
        createdAt: new Date()
      };
    } else {
      return res.status(403).json({ error: 'Not authorized for this review' });
    }

    await job.save();
    res.json({ message: 'Review submitted' });
  } catch (err) {
    console.error('Review error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/jobs/:id/payment-handshake ───
router.post('/:id/payment-handshake', auth, async (req, res) => {
  try {
    const { lat, lng } = req.body;
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.status !== 'pending_payment') return res.status(400).json({ error: `Cannot handshake: job is ${job.status}` });

    const app = job.applications.find(a => String(a._id) === String(job.acceptedApplicationId));
    const isPoster = String(job.posterId) === req.userId;
    const isProvider = app && String(app.applicantId) === req.userId;
    if (!isPoster && !isProvider) return res.status(403).json({ error: 'Not authorized' });

    // ── QR Proximity check ──
    if (lat !== undefined && lng !== undefined) {
      const latNum = parseFloat(lat);
      const lngNum = parseFloat(lng);
      if (!isNaN(latNum) && !isNaN(lngNum) && job.location && job.location.lat && job.location.lng) {
        const dist = getDistanceKm(latNum, lngNum, job.location.lat, job.location.lng);
        if (dist > QR_PROXIMITY_KM) {
          return res.status(400).json({ error: `Too far from job location (${dist.toFixed(2)}km). Must be within ${QR_PROXIMITY_KM * 1000}m.` });
        }
      }
    }

    // ── Idempotency: both parties must confirm ──
    const alreadyConfirmed = (job.paymentConfirmedBy || []).map(String);
    if (alreadyConfirmed.includes(String(req.userId))) {
      return res.json({ message: 'Payment already confirmed by you', awaitingOther: alreadyConfirmed.length < 2 });
    }

    // Atomic $addToSet so two concurrent confirmations can't both think they
    // were first (each request records its own confirmation exactly once).
    const latNum = lat !== undefined ? parseFloat(lat) : undefined;
    const lngNum = lng !== undefined ? parseFloat(lng) : undefined;
    const updated = await Job.findOneAndUpdate(
      { _id: job._id, status: 'pending_payment' },
      {
        $addToSet: { paymentConfirmedBy: req.userId },
        $push: {
          handshakeLog: {
            event: 'payment_confirmed',
            posterLocation: isPoster ? { lat: latNum, lng: lngNum } : undefined,
            providerLocation: isProvider ? { lat: latNum, lng: lngNum } : undefined,
            triggeredAt: new Date()
          }
        }
      },
      { new: true }
    );
    if (!updated) return res.status(400).json({ error: 'Job is no longer awaiting payment' });

    let bothConfirmed = false;
    if ((updated.paymentConfirmedBy || []).length >= 2) {
      // Guarded finalize: exactly one request wins this update and performs
      // the money movement, even if both parties confirm simultaneously.
      const finalized = await Job.findOneAndUpdate(
        { _id: job._id, status: 'pending_payment' },
        {
          $set: {
            paymentConfirmed: true,
            paymentConfirmedAt: new Date(),
            status: 'completed',
            completedAt: new Date()
          }
        },
        { new: true }
      );
      bothConfirmed = true;

      if (finalized) {
        // Move the money. releaseEscrow is idempotent (no-op if already
        // released) and only acts on escrow transactions.
        try {
          const transaction = finalized.transactionId
            ? await Transaction.findById(finalized.transactionId)
            : await Transaction.findOne({ jobId: finalized._id, status: { $in: ['in_progress', 'accepted', 'pending'] } });
          if (transaction) {
            if (transaction.paymentMethod === 'escrow') {
              await releaseEscrow(transaction);
            } else {
              // Cash: money changed hands in person — just close the record.
              transaction.status = 'completed';
              await transaction.save();
            }
          } else {
            console.error(`Payment handshake: no transaction found for job ${finalized._id} — funds not moved`);
          }
        } catch (payErr) {
          console.error('Escrow release error:', payErr);
        }

        const providerId = app?.applicantId?.toString?.() || String(app?.applicantId);
        notify(req, finalized.posterId, {
          type: 'job_completed',
          title: 'Job Completed ✅',
          message: `"${finalized.title}" is done — payment confirmed by both parties.`,
          jobId: finalized._id
        });
        if (providerId) {
          notify(req, providerId, {
            type: 'job_completed',
            title: finalized.paymentMethod === 'escrow' ? 'Payment Released 💰' : 'Job Completed ✅',
            message: finalized.paymentMethod === 'escrow'
              ? `Escrow for "${finalized.title}" has been released to your balance.`
              : `"${finalized.title}" is complete. Don't forget to leave a review!`,
            jobId: finalized._id
          });
        }
      }
    }

    res.json({
      message: bothConfirmed ? 'Payment confirmed by both parties. Job completed.' : 'Payment confirmation recorded. Awaiting other party.',
      paymentConfirmed: bothConfirmed
    });
  } catch (err) {
    console.error('Payment handshake error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/jobs/:id/partial-release ───
// Poster releases up to 50% of held escrow to the provider mid-job (e.g. for
// materials). Actually moves funds via partialReleaseEscrow — once only.
router.post('/:id/partial-release', auth, async (req, res) => {
  try {
    const { amount } = req.body;
    const job = await Job.findOne({ _id: req.params.id, posterId: req.userId });
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.partialEscrowReleased) return res.status(400).json({ error: 'Partial release already done' });
    if (job.paymentMethod !== 'escrow') return res.status(400).json({ error: 'Partial release only applies to escrow jobs' });
    if (!['in_progress', 'pending_review', 'pending_payment'].includes(job.status)) {
      return res.status(400).json({ error: `Cannot release funds while job is ${job.status}` });
    }

    const releaseAmount = parseFloat(amount);
    if (isNaN(releaseAmount) || releaseAmount <= 0) return res.status(400).json({ error: 'Invalid amount' });

    const transaction = job.transactionId
      ? await Transaction.findById(job.transactionId)
      : await Transaction.findOne({ jobId: job._id, escrowStatus: 'held' });
    if (!transaction) return res.status(400).json({ error: 'No escrow transaction found for this job' });

    // partialReleaseEscrow enforces the 50% cap and once-only rule and moves
    // the funds from the poster's escrow to the provider's balance.
    const percentage = (releaseAmount / transaction.randAmount) * 100;
    try {
      await partialReleaseEscrow(transaction, percentage, req.userId);
    } catch (escrowErr) {
      return res.status(400).json({ error: escrowErr.message });
    }

    job.partialEscrowReleased = true;
    job.partialEscrowAmount = transaction.partialReleaseAmount;
    job.partialEscrowReleasedAt = new Date();
    await job.save();

    res.json({ message: `R${transaction.partialReleaseAmount} released to your helper`, releasedAmount: transaction.partialReleaseAmount });

    try {
      const acceptedApp = job.applications.id(job.acceptedApplicationId);
      if (acceptedApp) {
        notify(req, acceptedApp.applicantId, {
          type: 'partial_release',
          title: 'Advance Payment 💰',
          message: `R${transaction.partialReleaseAmount} was released to your balance for "${job.title}".`,
          jobId: job._id
        });
      }
    } catch (notifyErr) {
      console.error('Partial release notify error:', notifyErr.message);
    }
  } catch (err) {
    console.error('Partial release error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/jobs/:id/qr-handshake ───
router.post('/:id/qr-handshake', auth, async (req, res) => {
  try {
    const { scannedUserId, lat, lng, manual } = req.body;
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const app = job.applications.find(a => String(a._id) === String(job.acceptedApplicationId));
    const isPoster = String(job.posterId) === req.userId;
    const isProvider = app && String(app.applicantId) === req.userId;
    if (!isPoster && !isProvider) return res.status(403).json({ error: 'Not authorized' });

    // Only allow QR handshake when job is in 'accepted' status (ready to start)
    if (job.status !== 'accepted') {
      return res.status(400).json({ error: `Cannot start: job is ${job.status}` });
    }

    // Proximity check (skip for manual completion)
    if (!manual && lat !== undefined && lng !== undefined && job.location && job.location.lat) {
      const dist = getDistanceKm(parseFloat(lat), parseFloat(lng), job.location.lat, job.location.lng);
      if (dist > QR_PROXIMITY_KM) {
        return res.status(400).json({ error: `Too far from job location (${dist.toFixed(2)}km). Must be within ${QR_PROXIMITY_KM * 1000}m.` });
      }
    }

    // Idempotency: track who has confirmed via QR (normalized to strings)
    job.qrConfirmedBy = job.qrConfirmedBy || [];
    const qrConfirmedBy = job.qrConfirmedBy.map(String);
    if (qrConfirmedBy.includes(String(req.userId))) {
      return res.json({ message: 'QR handshake already recorded by you', awaitingOther: qrConfirmedBy.length < 2 });
    }

    job.qrConfirmedBy.push(String(req.userId));

    // Log the handshake
    job.qrHandshakes = job.qrHandshakes || [];
    job.qrHandshakes.push({
      scannerId: req.userId,
      scannedId: scannedUserId || (isPoster ? (app?.applicantId?.toString?.() || app?.applicantId) : job.posterId.toString()),
      method: manual ? 'manual' : 'qr_scan',
      scannedAt: new Date()
    });

    const io = req.app.get('io');
    const room = `job_${job._id}`;
    const otherUserId = isPoster ? (app?.applicantId?.toString?.() || app?.applicantId) : job.posterId.toString();

    // Emit to room that a handshake was recorded
    io.to(room).emit('device_handshake_complete', {
      jobId: String(job._id),
      confirmedBy: req.userId,
      awaitingOther: job.qrConfirmedBy.length < 2
    });

    let jobStarted = false;

    if (job.qrConfirmedBy.length >= 2) {
      // Both parties have scanned — start the job!
      job.status = 'in_progress';
      job.startedAt = new Date();
      jobStarted = true;

      // Emit job_started to room
      io.to(room).emit('job_started', {
        jobId: String(job._id),
        title: job.title,
        startedAt: job.startedAt
      });

      // Notify both parties
      notify(req, job.posterId, {
        type: 'job_started',
        title: 'Job Started 🚀',
        message: `"${job.title}" has started! Track it in your Active jobs.`,
        jobId: job._id
      });

      notify(req, otherUserId, {
        type: 'job_started',
        title: 'Job Started 🚀',
        message: `"${job.title}" has started! Track it in your Active jobs.`,
        jobId: job._id
      });
    } else {
      // Only one party has scanned — notify the other to scan back
      notify(req, otherUserId, {
        type: 'qr_handshake_ready',
        title: 'QR Handshake Waiting 📱',
        message: `The other party scanned your QR for "${job.title}". Please scan theirs to start the job.`,
        jobId: job._id
      });
    }

    await job.save();

    res.json({
      message: jobStarted
        ? 'Job started! Both parties confirmed.'
        : 'QR handshake recorded. Awaiting other party.',
      status: job.status,
      jobStarted,
      awaitingOther: !jobStarted
    });
  } catch (err) {
    console.error('QR handshake error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/jobs/:id/manual-start-permission ───
router.post('/:id/manual-start-permission', auth, async (req, res) => {
  try {
    const job = await Job.findOne({ _id: req.params.id, posterId: req.userId });
    if (!job) return res.status(404).json({ error: 'Job not found' });
    job.manualStartAllowedByPoster = true;
    job.manualStartPermissionAt = new Date();
    job.manualStartPermissionBy = req.userId;
    await job.save();
    res.json({ message: 'Manual start permission granted' });
  } catch (err) {
    console.error('Manual start permission error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Alias for client code that calls /manual-start-nearby
router.post('/:id/manual-start-nearby', auth, async (req, res) => {
  req.url = `/${req.params.id}/manual-start-permission`;
  req.method = 'POST';
  router.handle(req, res, () => {});
});

module.exports = router;
