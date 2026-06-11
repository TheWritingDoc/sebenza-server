const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Job = require('../models/Job');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Review = require('../models/Review');
const upload = require('../middleware/upload');
const jwt = require('jsonwebtoken');
const { sendNotification } = require('../utils/notifications');

// ─── Helper: get io and onlineUsers from app ───
function getNotifier(req) {
  const io = req.app.get('io');
  const onlineUsers = req.app.get('onlineUsers');
  return { io, onlineUsers };
}

// ─── Auth middleware ───
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
      try { reqUserId = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key').userId; } catch (e) {}
    }

    res.json(paginated.map(j => toPublicJob(j, reqUserId)));
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
    res.json(jobs);
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
    res.json(jobs);
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
      try { reqUserId = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key').userId; } catch (e) {}
    }

    // Full detail for poster or accepted applicant
    const isPoster = String(job.posterId?._id || job.posterId) === reqUserId;
    const isAcceptedApplicant = job.applications.some(a =>
      String(a.applicantId?._id || a.applicantId) === reqUserId &&
      (a.status === 'approved' || a.status === 'accepted')
    );

    if (isPoster || isAcceptedApplicant) {
      return res.json(job);
    }

    res.json(toPublicJob(job, reqUserId));
  } catch (err) {
    console.error('Get job error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/jobs — Create job ───
router.post('/', auth, upload.array('jobPostImages', 10), async (req, res) => {
  try {
    const { title, description, category, budget, budgetMin, budgetMax, isUrgent, lat, lng, scheduledDate, proposedTime, timeIsNegotiable, applicationDeadline, estimatedDuration, tags } = req.body;

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
        // Invalid JSON, will use default below
      }
    }
    
    // Default to Port Elizabeth if location not provided
    if (latVal === undefined || lngVal === undefined) {
      latVal = -33.9249;
      lngVal = 25.5700;
    }
    
    if (!title || !description || !category || !budget) {
      return res.status(400).json({ error: 'Missing required fields: title, description, category, budget' });
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

    const images = req.files ? req.files.map(f => ({
      url: `/uploads/jobs/${f.filename}`,
      caption: '',
      uploadedAt: new Date()
    })) : [];

    const job = new Job({
      posterId: req.userId,
      title: cleanTitle,
      description: cleanDesc,
      category: cleanCategory,
      budget: budgetNum,
      budgetMin: budgetMin ? parseFloat(budgetMin) : undefined,
      budgetMax: budgetMax ? parseFloat(budgetMax) : undefined,
      isUrgent: isUrgent === 'true' || isUrgent === true,
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

    // ── Notify job poster ──
    try {
      const { io, onlineUsers } = getNotifier(req);
      const applicant = await User.findById(req.userId).select('name').lean();
      await sendNotification(io, onlineUsers, String(job.posterId), {
        type: 'application_received',
        title: 'New Application',
        message: `${applicant?.name || 'Someone'} applied to your job "${job.title}" for R${amount}`,
        jobId: job._id,
        priority: 'high',
        vibrate: true,
        sound: true,
        data: { 
          applicantId: req.userId, 
          proposedAmount: amount,
          screen: 'JobBoard',
          route: `/jobs?view=${job._id}`,
          tab: 'applicants',
          action: 'show_applicants',
          autoRoute: true
        }
      });
    } catch (notifyErr) {
      console.error('Apply notification error:', notifyErr.message);
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

    // ── Notify applicant ──
    try {
      const { io, onlineUsers } = getNotifier(req);
      const app = job.applications.find(a => String(a._id) === req.params.appId);
      if (app) {
        await sendNotification(io, onlineUsers, String(app.applicantId), {
          type: 'application_approved',
          title: 'Application Approved',
          message: `Your application for "${job.title}" was approved! Confirm to proceed.`,
          jobId: job._id,
          priority: 'high',
          vibrate: true,
          sound: true,
          requireInteraction: true,
          data: { 
            approvedAmount: approvedAmount ? parseFloat(approvedAmount) : undefined,
            screen: 'JobBoard',
            route: `/jobs?view=${job._id}`,
            tab: 'confirm',
            action: 'show_confirm_button',
            autoRoute: true
          }
        });
      }
    } catch (notifyErr) {
      console.error('Approve notification error:', notifyErr.message);
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
        'applications.applicantId': req.userId,
        status: 'approved'
      },
      { $set: { status: 'accepted', 'applications.$.status': 'accepted' } },
      { new: true }
    );
    if (!job) return res.status(400).json({ error: 'Cannot accept offer' });
    res.json({ message: 'Offer accepted' });

    // ── Notify job poster ──
    try {
      const { io, onlineUsers } = getNotifier(req);
      const applicant = await User.findById(req.userId).select('name').lean();
      await sendNotification(io, onlineUsers, String(job.posterId), {
        type: 'offer_accepted',
        title: 'Offer Accepted',
        message: `${applicant?.name || 'Your helper'} accepted the offer for "${job.title}". You can now start the job.`,
        jobId: job._id,
        priority: 'high',
        vibrate: true,
        sound: true,
        requireInteraction: true,
        data: { 
          status: 'accepted',
          screen: 'JobBoard',
          route: `/jobs/workhub/${job._id}`,
          tab: 'qr_scanner',
          action: 'show_qr_scanner',
          autoRoute: true
        }
      });
    } catch (notifyErr) {
      console.error('Accept offer notification error:', notifyErr.message);
    }
  } catch (err) {
    console.error('Accept offer error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/jobs/:id/applications/:appId/reject-offer ───
router.post('/:id/applications/:appId/reject-offer', auth, async (req, res) => {
  try {
    const job = await Job.findOneAndUpdate(
      { _id: req.params.id, 'applications._id': req.params.appId, 'applications.applicantId': req.userId },
      { $set: { 'applications.$.status': 'rejected' } },
      { new: true }
    );
    if (!job) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Offer rejected' });
  } catch (err) {
    console.error('Reject offer error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/jobs/:id/applications/:appId/confirm — Helper confirms approved offer ───
router.post('/:id/applications/:appId/confirm', auth, async (req, res) => {
  try {
    const job = await Job.findOneAndUpdate(
      {
        _id: req.params.id,
        'applications._id': req.params.appId,
        'applications.applicantId': req.userId,
        status: 'approved',
        'applications.status': 'approved'
      },
      { $set: { status: 'accepted', 'applications.$.status': 'accepted', acceptedApplicationId: req.params.appId } },
      { new: true }
    );
    if (!job) return res.status(400).json({ error: 'Cannot confirm: offer not approved or already handled' });
    res.json({ message: 'Offer confirmed', job });

    // ── Notify job poster ──
    try {
      const { io, onlineUsers } = getNotifier(req);
      const applicant = await User.findById(req.userId).select('name').lean();
      await sendNotification(io, onlineUsers, String(job.posterId), {
        type: 'offer_accepted',
        title: 'Offer Accepted',
        message: `${applicant?.name || 'Your helper'} accepted the offer for "${job.title}". You can now start the job.`,
        jobId: job._id,
        priority: 'high',
        vibrate: true,
        sound: true,
        requireInteraction: true,
        data: { 
          status: 'accepted',
          screen: 'JobBoard',
          route: `/jobs/workhub/${job._id}`,
          tab: 'qr_scanner',
          action: 'show_qr_scanner',
          autoRoute: true
        }
      });
    } catch (notifyErr) {
      console.error('Confirm notification error:', notifyErr.message);
    }

    // ── Create transaction record ──
    try {
      const Transaction = require('../models/Transaction');
      const existingTx = await Transaction.findOne({ jobId: job._id });
      if (!existingTx) {
        const acceptedApp = job.applications.find(a => String(a._id) === String(req.params.appId));
        await Transaction.create({
          jobId: job._id,
          requesterId: job.posterId,
          providerId: req.userId,
          randAmount: acceptedApp?.approvedAmount || acceptedApp?.proposedAmount || job.budget || 0,
          status: 'pending',
          paymentMethod: job.paymentMethod === 'escrow' ? 'escrow' : 'cash'
        });
        console.log(`[Confirm] Transaction created for job ${job._id}`);
      }
    } catch (txErr) {
      console.error('Confirm transaction error:', txErr.message);
    }
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

    // ── Notify provider ──
    try {
      const { io, onlineUsers } = getNotifier(req);
      const app = job.applications.find(a => String(a._id) === String(job.acceptedApplicationId));
      if (app) {
        await sendNotification(io, onlineUsers, String(app.applicantId), {
          type: 'job_started',
          title: 'Job Started',
          message: `"${job.title}" has started! Head to the location and begin work.`,
          jobId: job._id,
          priority: 'high',
          vibrate: true,
          sound: true,
          requireInteraction: true,
          data: { 
            status: 'in_progress',
            screen: 'JobBoard',
            route: `/jobs/workhub/${job._id}`,
            tab: 'work',
            action: 'show_work_tab',
            autoRoute: true
          }
        });
      }
    } catch (notifyErr) {
      console.error('Start job notification error:', notifyErr.message);
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

    const photos = req.files ? req.files.map(f => ({
      url: `/uploads/proof/${f.filename}`,
      uploadedAt: new Date()
    })) : [];

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

    const photos = req.files.map(f => ({
      url: `/uploads/proof/${f.filename}`,
      uploadedBy: req.userId,
      stage: cleanStage,
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

    const stopPhotos = req.files ? req.files.map(f => ({
      url: `/uploads/proof/${f.filename}`,
      uploadedAt: new Date()
    })) : [];

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

    res.json({ message: 'Job stopped' });
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

    const photos = req.files ? req.files.map(f => ({
      url: `/uploads/proof/${f.filename}`,
      lat: req.body.lat ? parseFloat(req.body.lat) : undefined,
      lng: req.body.lng ? parseFloat(req.body.lng) : undefined,
      uploadedAt: new Date()
    })) : [];

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

    // ── Notify job poster ──
    try {
      const { io, onlineUsers } = getNotifier(req);
      await sendNotification(io, onlineUsers, String(job.posterId), {
        type: 'completion_requested',
        title: 'Work Completed',
        message: `Your job "${job.title}" has been marked as complete. Please review and confirm.`,
        jobId: job._id,
        priority: 'high',
        vibrate: true,
        sound: true,
        requireInteraction: true,
        data: { 
          status: 'pending_review',
          screen: 'JobBoard',
          route: `/jobs/workhub/${job._id}`,
          tab: 'complete',
          action: 'show_confirm_completion',
          autoRoute: true
        }
      });
    } catch (notifyErr) {
      console.error('Complete notification error:', notifyErr.message);
    }
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

    const photos = req.files ? req.files.map(f => ({
      url: `/uploads/proof/${f.filename}`,
      uploadedAt: new Date()
    })) : [];

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

    // ── Notify provider ──
    try {
      const { io, onlineUsers } = getNotifier(req);
      const app = job.applications.find(a => String(a._id) === String(job.acceptedApplicationId));
      if (app) {
        await sendNotification(io, onlineUsers, String(app.applicantId), {
          type: 'job_pending_payment',
          title: 'Work Approved',
          message: `Great news! The poster confirmed your work on "${job.title}". Payment is now pending.`,
          jobId: job._id,
          priority: 'high',
          vibrate: true,
          sound: true,
          requireInteraction: true,
          data: { 
            status: 'pending_payment',
            screen: 'JobBoard',
            route: `/jobs/workhub/${job._id}`,
            tab: 'payment',
            action: 'show_payment_tab',
            autoRoute: true
          }
        });
      }
    } catch (notifyErr) {
      console.error('Confirm completion notification error:', notifyErr.message);
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
    const alreadyConfirmed = job.paymentConfirmedBy || [];
    if (alreadyConfirmed.includes(req.userId)) {
      return res.json({ message: 'Payment already confirmed by you', awaitingOther: alreadyConfirmed.length < 2 });
    }

    alreadyConfirmed.push(req.userId);
    job.paymentConfirmedBy = alreadyConfirmed;

    // Log handshake
    job.handshakeLog = job.handshakeLog || [];
    const latNum = lat !== undefined ? parseFloat(lat) : undefined;
    const lngNum = lng !== undefined ? parseFloat(lng) : undefined;
    job.handshakeLog.push({
      event: 'payment_confirmed',
      posterLocation: isPoster ? { lat: latNum, lng: lngNum } : undefined,
      providerLocation: isProvider ? { lat: latNum, lng: lngNum } : undefined,
      triggeredAt: new Date()
    });

    if (alreadyConfirmed.length >= 2) {
      job.paymentConfirmed = true;
      job.paymentConfirmedAt = new Date();
      job.status = 'completed';
      job.completedAt = new Date();
    }

    await job.save();

    res.json({
      message: alreadyConfirmed.length >= 2 ? 'Payment confirmed by both parties. Job completed.' : 'Payment confirmation recorded. Awaiting other party.',
      paymentConfirmed: job.paymentConfirmed
    });

    // ── Notify other party ──
    if (alreadyConfirmed.length >= 2) {
      try {
        const { io, onlineUsers } = getNotifier(req);
        const app = job.applications.find(a => String(a._id) === String(job.acceptedApplicationId));
        const otherPartyId = isPoster ? String(app.applicantId) : String(job.posterId);
        await sendNotification(io, onlineUsers, otherPartyId, {
          type: 'job_completed',
          title: 'Job Completed',
          message: `Payment confirmed! "${job.title}" is now complete.`,
          jobId: job._id,
          priority: 'high',
          vibrate: true,
          sound: true,
          requireInteraction: true,
          data: { 
            status: 'completed',
            screen: 'JobBoard',
            route: `/jobs/workhub/${job._id}`,
            tab: 'review',
            action: 'show_review_tab',
            autoRoute: true
          }
        });
      } catch (notifyErr) {
        console.error('Payment completion notification error:', notifyErr.message);
      }
    } else {
      // Notify the other party that confirmation is awaiting them
      try {
        const { io, onlineUsers } = getNotifier(req);
        const app = job.applications.find(a => String(a._id) === String(job.acceptedApplicationId));
        const otherPartyId = isPoster ? String(app.applicantId) : String(job.posterId);
        await sendNotification(io, onlineUsers, otherPartyId, {
          type: 'payment_pending',
          title: 'Payment Confirmation Needed',
          message: `The other party confirmed payment for "${job.title}". Please confirm to complete the job.`,
          jobId: job._id,
          priority: 'high',
          vibrate: true,
          sound: true,
          requireInteraction: true,
          data: { 
            status: 'pending_payment',
            screen: 'JobBoard',
            route: `/jobs/workhub/${job._id}`,
            tab: 'payment',
            action: 'show_payment_tab',
            autoRoute: true
          }
        });
      } catch (notifyErr) {
        console.error('Payment pending notification error:', notifyErr.message);
      }
    }
  } catch (err) {
    console.error('Payment handshake error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/jobs/:id/partial-release ───
router.post('/:id/partial-release', auth, async (req, res) => {
  try {
    const { amount } = req.body;
    const job = await Job.findOne({ _id: req.params.id, posterId: req.userId });
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.partialEscrowReleased) return res.status(400).json({ error: 'Partial release already done' });

    const releaseAmount = parseFloat(amount);
    if (isNaN(releaseAmount) || releaseAmount <= 0) return res.status(400).json({ error: 'Invalid amount' });

    job.partialEscrowReleased = true;
    job.partialEscrowAmount = releaseAmount;
    job.partialEscrowReleasedAt = new Date();
    await job.save();

    res.json({ message: 'Partial release recorded' });
  } catch (err) {
    console.error('Partial release error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/jobs/:id/qr-handshake ───
router.post('/:id/qr-handshake', auth, async (req, res) => {
  try {
    const { scannedUserId, lat, lng } = req.body;
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const app = job.applications.find(a => String(a._id) === String(job.acceptedApplicationId));
    const isPoster = String(job.posterId) === req.userId;
    const isProvider = app && String(app.applicantId) === req.userId;
    if (!isPoster && !isProvider) return res.status(403).json({ error: 'Not authorized' });

    // Proximity check
    if (lat !== undefined && lng !== undefined && job.location && job.location.lat) {
      const dist = getDistanceKm(parseFloat(lat), parseFloat(lng), job.location.lat, job.location.lng);
      if (dist > QR_PROXIMITY_KM) {
        return res.status(400).json({ error: `Too far from job location (${dist.toFixed(2)}km)` });
      }
    }

    job.qrHandshakes = job.qrHandshakes || [];
    job.qrHandshakes.push({
      scannerId: req.userId,
      scannedId: scannedUserId,
      method: 'qr_scan',
      scannedAt: new Date()
    });
    await job.save();

    res.json({ message: 'QR handshake recorded' });
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

module.exports = router;
