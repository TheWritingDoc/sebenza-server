const express = require('express');
const router = express.Router();
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { prisma, Prisma } = require('../db');
const { toDTO, isId } = require('../utils/dto');
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

// ─── Includes / selects ───
const APPLICANT_SELECT = {
  id: true, name: true, avatar: true, rating: true, trustStars: true,
  trustLevel: true, verified: true, emailVerified: true, phoneVerified: true,
  communityStats: true, primaryCategory: true, portfolioImages: true
};
const POSTER_SELECT = { id: true, name: true, avatar: true, rating: true };

// ─── Row → client shape ───
// The frozen client reads Mongo-era shapes: job.location.{lat,lng}, _id
// everywhere, populated fields living under their FK names
// (application.applicantId = user object when populated). These mappers
// rebuild that contract from Prisma rows.
function appOut(a) {
  if (!a) return a;
  const { applicant, jobId, ...rest } = a;
  if (applicant) rest.applicantId = applicant; // populate() shape
  return rest;
}

function jobOut(job) {
  if (!job) return job;
  const { poster, applications, transactions, lat, lng, ...rest } = job;
  const j = { ...rest, lat, lng, location: { lat, lng } };
  if (poster) j.posterId = poster; // populate() shape
  if (applications) j.applications = applications.map(appOut);
  return j;
}

// ─── Public DTO: strip sensitive fields ───
function toPublicJob(job, requesterId) {
  const j = jobOut(job);
  delete j.transactionId;
  delete j.qrHandshakes;
  delete j.handshakeLog;
  if (j.applications) {
    j.applications = j.applications.map(a => ({
      _id: a.id,
      id: a.id,
      proposedAmount: a.proposedAmount,
      proposedTime: a.proposedTime,
      status: a.status,
      message: a.message,
      createdAt: a.createdAt,
      applicantId: a.applicantId,
      applicant: (a.status === 'approved' || a.status === 'accepted' || String(a.applicantId?.id || a.applicantId) === String(requesterId))
        ? a.applicantId
        : undefined
    }));
  }
  return j;
}

// ─── Resolve the requester's own application on a job ───
function findMyApplication(applications, userId) {
  if (!Array.isArray(applications) || !userId) return null;
  const mine = applications.find(a => {
    const aid = a && a.applicantId && (a.applicantId.id || a.applicantId._id || a.applicantId);
    return aid && String(aid) === String(userId);
  });
  return mine || null;
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

// ─── Rate limit job creation per user ───
const createJobLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  keyGenerator: (req, res) => req.userId || ipKeyGenerator(req, res),
  message: { error: 'You are posting jobs too quickly. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

// ─── Resolve whether a user is a party (poster or accepted provider) ───
function getJobParties(job, userId) {
  const isPoster = String(job.posterId) === String(userId);
  const acceptedApp = job.applications &&
    job.applications.find(a => String(a.id) === String(job.acceptedApplicationId));
  const acceptedApplicantId = acceptedApp && String(acceptedApp.applicantId?.id || acceptedApp.applicantId);
  const isProvider = !!(acceptedApp && acceptedApplicantId === String(userId));
  return { isPoster, isProvider, isParty: isPoster || isProvider, acceptedApp, acceptedApplicantId };
}

function requesterFromToken(req) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return null;
  try { return jwt.verify(token, process.env.JWT_SECRET).userId; } catch (e) { return null; }
}

// ─── GET /api/jobs — Browse / Nearby ───
router.get('/', async (req, res) => {
  try {
    const { lat, lng, radius, category, status, search, page = 1, limit = 20 } = req.query;
    const where = {};

    if (status) {
      let statusValues;
      if (Array.isArray(status)) {
        statusValues = status.map(s => s.trim()).filter(Boolean);
      } else if (typeof status === 'string' && status.includes(',')) {
        statusValues = status.split(',').map(s => s.trim()).filter(Boolean);
      } else {
        statusValues = [status];
      }
      where.status = statusValues.length > 1 ? { in: statusValues } : statusValues[0];
    } else {
      where.status = { in: ['open', 'negotiating', 'approved'] };
    }

    // Live window: publishAt reached (or unset), expiresAt not passed (or unset)
    const now = new Date();
    where.AND = [
      { OR: [{ publishAt: null }, { publishAt: { lte: now } }] },
      { OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] }
    ];

    if (category) where.category = category;
    if (search) {
      where.AND.push({
        OR: [
          { title: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } }
        ]
      });
    }

    let jobs = await prisma.job.findMany({
      where,
      include: {
        poster: { select: POSTER_SELECT },
        applications: { include: { applicant: { select: APPLICANT_SELECT } } }
      },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit) * 2 // fetch extra for geo filtering
    });

    if (lat && lng) {
      const latNum = parseFloat(lat);
      const lngNum = parseFloat(lng);
      const rNum = Math.min(parseFloat(radius) || 50, 50);
      jobs = jobs.filter(j => {
        if (j.lat == null || j.lng == null) return false;
        return getDistanceKm(latNum, lngNum, j.lat, j.lng) <= rNum;
      });
    }

    const start = (parseInt(page) - 1) * parseInt(limit);
    const paginated = jobs.slice(start, start + parseInt(limit));

    const reqUserId = requesterFromToken(req);
    res.json(toDTO(paginated.map(j => {
      const full = jobOut(j);
      const pub = toPublicJob(j, reqUserId);
      pub.myApplication = findMyApplication(full.applications, reqUserId);
      return pub;
    })));
  } catch (err) {
    console.error('Browse jobs error:', err);
    res.status(500).json({ error: 'Server error fetching jobs' });
  }
});

// ─── GET /api/jobs/my-jobs ───
router.get('/my-jobs', auth, async (req, res) => {
  try {
    const jobs = await prisma.job.findMany({
      where: { posterId: req.userId },
      include: { applications: { include: { applicant: { select: APPLICANT_SELECT } } } },
      orderBy: { createdAt: 'desc' }
    });
    res.json(toDTO(jobs.map(j => {
      const obj = jobOut(j);
      obj.myApplication = findMyApplication(obj.applications, req.userId);
      return obj;
    })));
  } catch (err) {
    console.error('My jobs error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── GET /api/jobs/my-applications ───
router.get('/my-applications', auth, async (req, res) => {
  try {
    const jobs = await prisma.job.findMany({
      where: { applications: { some: { applicantId: req.userId } } },
      include: {
        poster: { select: POSTER_SELECT },
        applications: { include: { applicant: { select: APPLICANT_SELECT } } }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(toDTO(jobs.map(j => {
      const obj = jobOut(j);
      obj.myApplication = findMyApplication(obj.applications, req.userId);
      return obj;
    })));
  } catch (err) {
    console.error('My applications error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── GET /api/jobs/portfolio/:providerId — MUST be before /:id ───
router.get('/portfolio/:providerId', async (req, res) => {
  try {
    const { providerId } = req.params;
    const jobs = await prisma.job.findMany({
      where: { status: 'completed', acceptedApplicationId: { not: null } },
      include: {
        poster: { select: { id: true, name: true, avatar: true } },
        applications: { include: { applicant: { select: APPLICANT_SELECT } } }
      },
      orderBy: { completedAt: 'desc' },
      take: 50
    });

    const providerJobs = jobs.filter(j => {
      const app = j.applications.find(a => String(a.id) === String(j.acceptedApplicationId));
      return app && String(app.applicantId) === providerId;
    });

    res.json(toDTO(providerJobs.map(j => toPublicJob(j, null))));
  } catch (err) {
    console.error('Portfolio error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── GET /api/jobs/:id ───
router.get('/:id', async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(404).json({ error: 'Job not found' });
    const job = await prisma.job.findUnique({
      where: { id: req.params.id },
      include: {
        poster: { select: POSTER_SELECT },
        applications: { include: { applicant: { select: APPLICANT_SELECT } } }
      }
    });
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const reqUserId = requesterFromToken(req);
    const obj = jobOut(job);

    // Rebuild the workProofPhotos.uploadedBy populate (name/avatar) — it's
    // JSONB now, so resolve the uploader profiles explicitly.
    if (Array.isArray(obj.workProofPhotos) && obj.workProofPhotos.length > 0) {
      const uploaderIds = [...new Set(obj.workProofPhotos.map(p => p.uploadedBy).filter(u => isId(String(u || ''))))];
      if (uploaderIds.length > 0) {
        const uploaders = await prisma.user.findMany({
          where: { id: { in: uploaderIds } },
          select: { id: true, name: true, avatar: true }
        });
        const byId = Object.fromEntries(uploaders.map(u => [u.id, u]));
        obj.workProofPhotos = obj.workProofPhotos.map(p => ({
          ...p,
          uploadedBy: byId[p.uploadedBy] || p.uploadedBy
        }));
      }
    }

    const isPoster = String(job.posterId) === reqUserId;
    const isAcceptedApplicant = job.applications.some(a =>
      String(a.applicantId) === reqUserId &&
      (a.status === 'approved' || a.status === 'accepted')
    );

    const myApplication = findMyApplication(obj.applications, reqUserId);

    if (isPoster || isAcceptedApplicant) {
      obj.myApplication = myApplication;
      return res.json(toDTO(obj));
    }

    const pub = toPublicJob(job, reqUserId);
    pub.workProofPhotos = obj.workProofPhotos;
    pub.myApplication = myApplication;
    res.json(toDTO(pub));
  } catch (err) {
    console.error('Get job error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/jobs — Create job ───
router.post('/', auth, createJobLimiter, upload.array('images', 10), async (req, res) => {
  try {
    const { title, description, category, budget, budgetMin, budgetMax, isUrgent, lat, lng, scheduledDate, proposedTime, timeIsNegotiable, applicationDeadline, estimatedDuration, tags, paymentMethod, publishAt } = req.body;

    let latVal = lat !== undefined ? lat : req.body.location?.lat;
    let lngVal = lng !== undefined ? lng : req.body.location?.lng;

    if (latVal === undefined && req.body.location && typeof req.body.location === 'string') {
      try {
        const parsedLoc = JSON.parse(req.body.location);
        latVal = parsedLoc.lat;
        lngVal = parsedLoc.lng;
      } catch (e) { /* fails validation below */ }
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

    // Job lifetime: 24h from publish. Scheduled jobs stay hidden until
    // publishAt and their 24h window starts THEN.
    const now = new Date();
    const publishAtDate = publishAt ? new Date(publishAt) : now;
    const validPublish = !isNaN(publishAtDate.getTime()) ? publishAtDate : now;
    const expiresAtDate = new Date(validPublish.getTime() + 24 * 60 * 60 * 1000);
    const deadlineDate = applicationDeadline ? new Date(applicationDeadline) : expiresAtDate;

    const job = await prisma.job.create({
      data: {
        posterId: req.userId,
        title: cleanTitle,
        description: cleanDesc,
        category: cleanCategory,
        budget: budgetNum,
        budgetMin: budgetMin ? parseFloat(budgetMin) : null,
        budgetMax: budgetMax ? parseFloat(budgetMax) : null,
        isUrgent: isUrgent === 'true' || isUrgent === true,
        paymentMethod: ['escrow', 'cash'].includes(paymentMethod) ? paymentMethod : 'cash',
        lat: latNum,
        lng: lngNum,
        images,
        scheduledDate: scheduledDate ? new Date(scheduledDate) : null,
        proposedTime: proposedTime ? new Date(proposedTime) : null,
        timeIsNegotiable: timeIsNegotiable !== 'false',
        publishAt: validPublish,
        expiresAt: expiresAtDate,
        applicationDeadline: deadlineDate,
        estimatedDuration: estimatedDuration ? sanitizeString(estimatedDuration, 50) : null,
        tags: cleanTags
      }
    });

    res.status(201).json({ message: 'Job posted', job: { _id: job.id, id: job.id } });

    // Notify nearby online users (after responding)
    try {
      const io = req.app.get('io');
      const onlineUsers = req.app.get('onlineUsers');
      if (io && onlineUsers && onlineUsers.size > 0) {
        const NEARBY_KM = 20;
        const onlineUserIds = Array.from(onlineUsers.keys()).filter(id => isId(String(id)));
        const nearbyUsers = await prisma.user.findMany({
          where: { id: { in: onlineUserIds } },
          select: { id: true, lat: true, lng: true }
        });
        for (const u of nearbyUsers) {
          if (String(u.id) === String(req.userId)) continue;
          if (u.lat == null || u.lng == null) continue;
          const dist = getDistanceKm(latNum, lngNum, u.lat, u.lng);
          if (dist <= NEARBY_KM) {
            notify(req, u.id, {
              type: 'job_nearby',
              title: job.isUrgent ? '🚨 Urgent Job Nearby!' : 'New Job Nearby!',
              message: `"${job.title}" — R${Number(job.budgetMin || job.budget)}${job.budgetMax ? `–R${Number(job.budgetMax)}` : ''}, ${dist < 1 ? '<1' : Math.round(dist)}km away`,
              jobId: job.id
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
    if (!isId(req.params.id)) return res.status(404).json({ error: 'Job not found' });
    const { proposedAmount, proposedTime, message } = req.body;
    const job = await prisma.job.findUnique({ where: { id: req.params.id } });
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.status !== 'open') return res.status(400).json({ error: 'Job is no longer open for applications' });
    if (String(job.posterId) === req.userId) return res.status(403).json({ error: 'Cannot apply to your own job' });

    const nowTs = Date.now();
    if (job.expiresAt && new Date(job.expiresAt).getTime() < nowTs) {
      return res.status(400).json({ error: 'This job has expired' });
    }
    if (job.applicationDeadline && new Date(job.applicationDeadline).getTime() < nowTs) {
      return res.status(400).json({ error: 'Applications for this job have closed' });
    }

    const amount = parseFloat(proposedAmount);
    if (isNaN(amount) || amount <= 0) return res.status(400).json({ error: 'Invalid proposed amount' });

    // Duplicate guard: unique (jobId, applicantId) constraint does it atomically.
    try {
      await prisma.application.create({
        data: {
          jobId: job.id,
          applicantId: req.userId,
          proposedAmount: amount,
          proposedTime: proposedTime ? new Date(proposedTime) : null,
          message: message ? sanitizeString(message, MAX_MESSAGE) : '',
          status: 'pending'
        }
      });
    } catch (e) {
      if (e.code === 'P2002') return res.status(409).json({ error: 'You have already applied to this job' });
      throw e;
    }

    res.json({ message: 'Application submitted' });

    try {
      const applicant = await prisma.user.findUnique({ where: { id: req.userId }, select: { name: true } });
      notify(req, job.posterId, {
        type: 'application_received',
        title: 'New Offer to Help!',
        message: `${applicant?.name || 'Someone'} offered R${amount} for "${job.title}"`,
        jobId: job.id
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
    if (!isId(req.params.id) || !isId(req.params.appId)) return res.status(404).json({ error: 'Job not found' });
    const { approvedAmount, approvedTime } = req.body;

    // Atomic conditional approve: only one application can win while 'open'.
    const approved = await prisma.$transaction(async (tx) => {
      const guard = await tx.job.updateMany({
        where: {
          id: req.params.id,
          posterId: req.userId,
          status: 'open',
          applications: { some: { id: req.params.appId } }
        },
        data: { status: 'approved', acceptedApplicationId: req.params.appId }
      });
      if (guard.count === 0) return null;
      await tx.application.update({
        where: { id: req.params.appId },
        data: {
          status: 'approved',
          approvedAmount: approvedAmount ? parseFloat(approvedAmount) : null,
          approvedTime: approvedTime ? new Date(approvedTime) : null
        }
      });
      return tx.job.findUnique({ where: { id: req.params.id }, select: { id: true, title: true } });
    });

    if (!approved) {
      const check = await prisma.job.findUnique({ where: { id: req.params.id } });
      if (!check) return res.status(404).json({ error: 'Job not found' });
      if (String(check.posterId) !== req.userId) return res.status(403).json({ error: 'Not authorized' });
      if (check.status !== 'open') return res.status(400).json({ error: `Cannot approve: job is ${check.status}` });
      return res.status(404).json({ error: 'Application not found' });
    }

    res.json({ message: 'Application approved' });

    try {
      const approvedApp = await prisma.application.findUnique({ where: { id: req.params.appId }, select: { applicantId: true } });
      if (approvedApp) {
        notify(req, approvedApp.applicantId, {
          type: 'application_approved',
          title: 'Your Offer Was Approved! 🎉',
          message: `You got "${approved.title}" — confirm now to lock it in`,
          jobId: approved.id
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
    if (!isId(req.params.id) || !isId(req.params.appId)) return res.status(404).json({ error: 'Job or application not found' });
    const updated = await prisma.application.updateMany({
      where: { id: req.params.appId, jobId: req.params.id, job: { posterId: req.userId } },
      data: { status: 'rejected' }
    });
    if (updated.count === 0) return res.status(404).json({ error: 'Job or application not found' });
    res.json({ message: 'Application rejected' });

    try {
      const [job, rejectedApp] = await Promise.all([
        prisma.job.findUnique({ where: { id: req.params.id }, select: { id: true, title: true } }),
        prisma.application.findUnique({ where: { id: req.params.appId }, select: { applicantId: true } })
      ]);
      if (rejectedApp && job) {
        notify(req, rejectedApp.applicantId, {
          type: 'application_rejected',
          title: 'Application Update',
          message: `Your offer for "${job.title}" wasn't selected this time — keep going!`,
          jobId: job.id
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
    if (!isId(req.params.id) || !isId(req.params.appId)) return res.status(404).json({ error: 'Job not found' });
    const { amount, proposedTime, message } = req.body;
    const job = await prisma.job.findUnique({ where: { id: req.params.id } });
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const app = await prisma.application.findFirst({ where: { id: req.params.appId, jobId: job.id } });
    if (!app) return res.status(404).json({ error: 'Application not found' });

    const isPoster = String(job.posterId) === req.userId;
    const isApplicant = String(app.applicantId) === req.userId;
    if (!isPoster && !isApplicant) return res.status(403).json({ error: 'Not authorized' });

    const history = Array.isArray(app.negotiationHistory) ? app.negotiationHistory : [];
    history.push({
      proposedBy: req.userId,
      amount: parseFloat(amount) || Number(app.proposedAmount),
      proposedTime: proposedTime ? new Date(proposedTime) : undefined,
      message: message ? sanitizeString(message, MAX_MESSAGE) : '',
      status: 'pending',
      createdAt: new Date()
    });
    await prisma.application.update({
      where: { id: app.id },
      data: { negotiationHistory: history, status: 'negotiating' }
    });

    res.json({ message: 'Negotiation sent' });

    try {
      const counterparty = isPoster ? app.applicantId : job.posterId;
      notify(req, counterparty, {
        type: 'negotiation_updated',
        title: 'New Counter Offer 🤝',
        message: `R${parseFloat(amount) || Number(app.proposedAmount)} proposed for "${job.title}"`,
        jobId: job.id
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
    if (!isId(req.params.id) || !isId(req.params.appId)) return res.status(400).json({ error: 'Cannot accept offer' });
    const accepted = await prisma.$transaction(async (tx) => {
      const guard = await tx.job.updateMany({
        where: {
          id: req.params.id,
          status: 'approved',
          applications: { some: { id: req.params.appId, applicantId: req.userId } }
        },
        data: { status: 'accepted' }
      });
      if (guard.count === 0) return null;
      await tx.application.update({ where: { id: req.params.appId }, data: { status: 'accepted' } });
      return tx.job.findUnique({ where: { id: req.params.id }, select: { id: true, title: true, posterId: true } });
    });
    if (!accepted) return res.status(400).json({ error: 'Cannot accept offer' });
    res.json({ message: 'Offer accepted' });

    notify(req, accepted.posterId, {
      type: 'offer_accepted',
      title: 'Offer Accepted ✅',
      message: `Your helper accepted the offer for "${accepted.title}"`,
      jobId: accepted.id
    });
  } catch (err) {
    console.error('Accept offer error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/jobs/:id/applications/:appId/reject-offer ───
router.post('/:id/applications/:appId/reject-offer', auth, async (req, res) => {
  try {
    if (!isId(req.params.id) || !isId(req.params.appId)) return res.status(404).json({ error: 'Not found' });
    const updated = await prisma.application.updateMany({
      where: { id: req.params.appId, jobId: req.params.id, applicantId: req.userId },
      data: { status: 'rejected' }
    });
    if (updated.count === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Offer rejected' });

    const job = await prisma.job.findUnique({ where: { id: req.params.id }, select: { id: true, title: true, posterId: true } });
    if (job) {
      notify(req, job.posterId, {
        type: 'offer_rejected',
        title: 'Offer Declined',
        message: `Your offer for "${job.title}" was declined — you can send a new one`,
        jobId: job.id
      });
    }
  } catch (err) {
    console.error('Reject offer error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/jobs/:id/applications/:appId/confirm — Helper confirms approved offer ───
// Mutual acceptance point: this is where the escrow is funded.
router.post('/:id/applications/:appId/confirm', auth, async (req, res) => {
  try {
    if (!isId(req.params.id) || !isId(req.params.appId)) {
      return res.status(400).json({ error: 'Cannot confirm: offer not approved or already handled' });
    }

    // Pre-check: for escrow jobs the poster must be able to fund the agreed
    // amount, checked before the status flip so a failed confirm leaves the
    // job in 'approved'.
    const preJob = await prisma.job.findFirst({
      where: {
        id: req.params.id,
        status: 'approved',
        applications: { some: { id: req.params.appId, applicantId: req.userId } }
      },
      include: { applications: { where: { id: req.params.appId } } }
    });
    if (!preJob) return res.status(400).json({ error: 'Cannot confirm: offer not approved or already handled' });

    const preApp = preJob.applications[0];
    const finalAmount = Number(preApp?.approvedAmount ?? preApp?.proposedAmount ?? preJob.budget);

    if (preJob.paymentMethod === 'escrow') {
      const poster = await prisma.user.findUnique({ where: { id: preJob.posterId }, select: { randBalance: true } });
      if (!poster || Number(poster.randBalance) < finalAmount) {
        notify(req, preJob.posterId, {
          type: 'escrow_funding_failed',
          title: 'Escrow Funding Needed ⚠️',
          message: `Your balance is too low to fund R${finalAmount} escrow for "${preJob.title}". Top up so your helper can confirm.`,
          jobId: preJob.id
        });
        return res.status(400).json({
          error: `The poster's balance can't cover the R${finalAmount} escrow yet. They've been notified to top up.`
        });
      }
    }

    // Guarded transition approved → accepted (one winner).
    const flipped = await prisma.$transaction(async (tx) => {
      const guard = await tx.job.updateMany({
        where: {
          id: req.params.id,
          status: 'approved',
          applications: { some: { id: req.params.appId, applicantId: req.userId, status: 'approved' } }
        },
        data: { status: 'accepted' }
      });
      if (guard.count === 0) return null;
      await tx.application.update({ where: { id: req.params.appId }, data: { status: 'accepted' } });
      return tx.job.findUnique({ where: { id: req.params.id } });
    });
    if (!flipped) return res.status(400).json({ error: 'Cannot confirm: offer not approved or already handled' });

    // Fund escrow / create the payment record (idempotent per job).
    try {
      const transaction = await createEscrowTransaction(flipped, preApp, finalAmount);
      await prisma.job.update({ where: { id: flipped.id }, data: { transactionId: transaction.id } });
    } catch (escrowErr) {
      // Rare race: balance dropped between pre-check and funding. Roll back.
      await prisma.$transaction([
        prisma.job.updateMany({ where: { id: flipped.id, status: 'accepted' }, data: { status: 'approved' } }),
        prisma.application.updateMany({ where: { id: req.params.appId }, data: { status: 'approved' } })
      ]);
      if (escrowErr.code === 'INSUFFICIENT_BALANCE') {
        return res.status(400).json({ error: 'The poster\'s balance can\'t cover the escrow. They\'ve been notified.' });
      }
      throw escrowErr;
    }

    res.json({ message: 'Offer confirmed', escrowFunded: flipped.paymentMethod === 'escrow', amount: finalAmount });

    notify(req, flipped.posterId, {
      type: 'schedule_confirmed',
      title: 'Job Confirmed 📅',
      message: flipped.paymentMethod === 'escrow'
        ? `Your helper confirmed "${flipped.title}" — R${finalAmount} is now held in escrow.`
        : `Your helper confirmed "${flipped.title}" — it's locked in! (Cash: R${finalAmount})`,
      jobId: flipped.id
    });
  } catch (err) {
    console.error('Confirm error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/jobs/:id/start — Poster starts job after helper confirms ───
router.post('/:id/start', auth, async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ error: 'Cannot start job' });
    const guard = await prisma.job.updateMany({
      where: { id: req.params.id, posterId: req.userId, status: 'accepted' },
      data: { status: 'in_progress', startedAt: new Date() }
    });
    if (guard.count === 0) return res.status(400).json({ error: 'Cannot start job' });
    res.json({ message: 'Job started' });

    try {
      const job = await prisma.job.findUnique({ where: { id: req.params.id }, select: { id: true, title: true, acceptedApplicationId: true } });
      const acceptedApp = job?.acceptedApplicationId
        ? await prisma.application.findUnique({ where: { id: job.acceptedApplicationId }, select: { applicantId: true } })
        : null;
      if (acceptedApp) {
        notify(req, acceptedApp.applicantId, {
          type: 'job_started',
          title: 'Job Started 🚀',
          message: `"${job.title}" is now in progress`,
          jobId: job.id
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
    if (!isId(req.params.id) || !isId(req.params.appId)) return res.status(404).json({ error: 'Not found' });
    const updated = await prisma.application.updateMany({
      where: { id: req.params.appId, jobId: req.params.id, job: { posterId: req.userId } },
      data: { status: 'rejected' }
    });
    if (updated.count === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Declined' });
  } catch (err) {
    console.error('Decline error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/jobs/:id/applications/:appId/withdraw ───
router.post('/:id/applications/:appId/withdraw', auth, async (req, res) => {
  try {
    if (!isId(req.params.id) || !isId(req.params.appId)) return res.status(404).json({ error: 'Not found' });
    const updated = await prisma.application.updateMany({
      where: { id: req.params.appId, jobId: req.params.id, applicantId: req.userId },
      data: { status: 'withdrawn' }
    });
    if (updated.count === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Application withdrawn' });

    const job = await prisma.job.findUnique({ where: { id: req.params.id }, select: { id: true, title: true, posterId: true } });
    if (job) {
      notify(req, job.posterId, {
        type: 'application_withdrawn',
        title: 'Application Withdrawn',
        message: `A helper withdrew their offer for "${job.title}"`,
        jobId: job.id
      });
    }
  } catch (err) {
    console.error('Withdraw error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/jobs/:id/cancel ───
router.post('/:id/cancel', auth, async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(404).json({ error: 'Job not found' });
    const job = await prisma.job.findFirst({
      where: { id: req.params.id, posterId: req.userId },
      include: { applications: { select: { applicantId: true, status: true } } }
    });
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!['open', 'negotiating', 'approved'].includes(job.status)) {
      return res.status(400).json({ error: `Cannot cancel job in ${job.status} status` });
    }
    await prisma.job.update({ where: { id: job.id }, data: { status: 'cancelled' } });
    res.json({ message: 'Job cancelled' });

    try {
      const toNotify = (job.applications || [])
        .filter(a => !['rejected', 'withdrawn'].includes(a.status))
        .map(a => String(a.applicantId));
      for (const uid of [...new Set(toNotify)]) {
        notify(req, uid, {
          type: 'job_cancelled',
          title: 'Job Cancelled',
          message: `"${job.title}" was cancelled by the poster`,
          jobId: job.id
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
    if (!isId(req.params.id)) return res.status(404).json({ error: 'Job not found' });
    const { type = 'manual' } = req.body;
    const job = await prisma.job.findUnique({ where: { id: req.params.id }, select: { id: true, title: true, posterId: true } });
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const app = await prisma.application.findFirst({ where: { jobId: job.id, applicantId: req.userId } });
    if (!app) return res.status(403).json({ error: 'Not an applicant' });

    const pingLog = Array.isArray(app.pingLog) ? app.pingLog : [];
    pingLog.push({ type, sentAt: new Date() });
    const updated = await prisma.application.update({
      where: { id: app.id },
      data: {
        pingCount: { increment: 1 },
        lastPingAt: new Date(),
        firstPingAt: app.firstPingAt || new Date(),
        pingLog
      }
    });

    res.json({ message: 'Ping sent', pingCount: updated.pingCount });

    notify(req, job.posterId, {
      type: 'doorbell_rung',
      title: 'Ding dong! 🔔',
      message: `Your helper for "${job.title}" is trying to reach you`,
      jobId: job.id
    });
  } catch (err) {
    console.error('Ping error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/jobs/:id/flag-late-provider ───
router.post('/:id/flag-late-provider', auth, async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(404).json({ error: 'Job not found' });
    const job = await prisma.job.findFirst({ where: { id: req.params.id, posterId: req.userId }, select: { id: true } });
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json({ message: 'Flag recorded' });
  } catch (err) {
    console.error('Flag error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/jobs/:id/report-issue ───
router.post('/:id/report-issue', auth, upload.array('photos', 10), async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(404).json({ error: 'Job not found' });
    const { note } = req.body;
    const job = await prisma.job.findUnique({
      where: { id: req.params.id },
      include: { applications: { select: { id: true, applicantId: true } } }
    });
    if (!job) return res.status(404).json({ error: 'Job not found' });

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

    const issueReports = Array.isArray(job.issueReports) ? job.issueReports : [];
    issueReports.push({
      reporterId: req.userId,
      kind: 'issue',
      note: note ? sanitizeString(note, 1200) : '',
      photos,
      createdAt: new Date()
    });
    await prisma.job.update({ where: { id: job.id }, data: { issueReports } });

    res.json({ message: 'Issue reported' });
  } catch (err) {
    console.error('Report issue error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/jobs/:id/upload-proof ───
router.post('/:id/upload-proof', auth, upload.array('photos', 10), async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(404).json({ error: 'Job not found' });
    const { stage, note } = req.body;
    const job = await prisma.job.findUnique({
      where: { id: req.params.id },
      include: { applications: { select: { id: true, applicantId: true } } }
    });
    if (!job) return res.status(404).json({ error: 'Job not found' });

    if (!getJobParties(job, req.userId).isParty) {
      return res.status(403).json({ error: 'Not authorized for this job' });
    }

    const validStages = ['before', 'during', 'after'];
    const cleanStage = validStages.includes(stage) ? stage : 'during';

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'At least one photo required' });
    }
    if (req.files.length > 10) {
      return res.status(413).json({ error: 'Maximum 10 photos allowed per upload' });
    }

    const lat = req.body.lat != null ? parseFloat(req.body.lat) : undefined;
    const lng = req.body.lng != null ? parseFloat(req.body.lng) : undefined;
    const geo = (Number.isFinite(lat) && Number.isFinite(lng)) ? { lat, lng } : undefined;
    const photoUrls = await uploadFiles(req.files, 'proof');
    const photos = photoUrls.map(url => ({
      url,
      uploadedBy: req.userId,
      stage: cleanStage,
      location: geo,
      note: note ? sanitizeString(note, MAX_NOTE) : '',
      uploadedAt: new Date()
    }));

    const workProofPhotos = Array.isArray(job.workProofPhotos) ? job.workProofPhotos : [];
    workProofPhotos.push(...photos);
    await prisma.job.update({ where: { id: job.id }, data: { workProofPhotos } });

    res.json({ message: `${cleanStage.charAt(0).toUpperCase() + cleanStage.slice(1)} photos uploaded`, count: photos.length });
  } catch (err) {
    console.error('Upload proof error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/jobs/:id/stop-job ───
router.post('/:id/stop-job', auth, upload.array('stopPhotos', 10), async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(404).json({ error: 'Job not found' });
    const { reason } = req.body;
    const job = await prisma.job.findUnique({ where: { id: req.params.id } });
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (String(job.posterId) !== req.userId) return res.status(403).json({ error: 'Only poster can stop job' });

    if (['pending_payment', 'completed'].includes(job.status)) {
      return res.status(400).json({ error: `Cannot stop job in ${job.status} status` });
    }
    if (!['in_progress', 'pending_review', 'approved', 'accepted'].includes(job.status)) {
      return res.status(400).json({ error: `Cannot stop job in ${job.status} status` });
    }
    if (req.files && req.files.length > 10) {
      return res.status(413).json({ error: 'Maximum 10 stop photos allowed' });
    }

    const stopPhotoUrls = req.files && req.files.length > 0 ? await uploadFiles(req.files, 'proof') : [];
    const stopPhotos = stopPhotoUrls.map(url => ({ url, uploadedAt: new Date() }));

    const issueReports = Array.isArray(job.issueReports) ? job.issueReports : [];
    issueReports.push({
      reporterId: req.userId,
      kind: 'stop_request',
      note: reason ? sanitizeString(reason, 1200) : 'Job stopped by poster',
      photos: stopPhotos,
      createdAt: new Date()
    });
    await prisma.job.update({
      where: { id: job.id },
      data: { issueReports, status: 'cancelled', stoppedAt: new Date(), stoppedBy: req.userId }
    });

    // Return any held escrow to the poster (idempotent; partial stays with provider).
    let refunded = 0;
    try {
      const transaction = job.transactionId
        ? await prisma.transaction.findUnique({ where: { id: job.transactionId } })
        : await prisma.transaction.findFirst({ where: { jobId: job.id, escrowStatus: 'held' } });
      if (transaction && transaction.escrowStatus === 'held') {
        const alreadyReleased = Number(transaction.partialReleaseAmount) || 0;
        refunded = Math.max(0, Number(transaction.randAmount) - alreadyReleased);
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
    if (!isId(req.params.id)) return res.status(404).json({ error: 'Job not found' });
    const job = await prisma.job.findUnique({
      where: { id: req.params.id },
      include: { applications: { select: { id: true, applicantId: true } } }
    });
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const { isProvider } = getJobParties(job, req.userId);
    if (!isProvider) return res.status(403).json({ error: 'Only accepted provider can complete' });
    if (job.status !== 'in_progress') return res.status(400).json({ error: `Cannot complete: job is ${job.status}` });

    const completionPhotoUrls = req.files && req.files.length > 0 ? await uploadFiles(req.files, 'proof') : [];
    const photos = completionPhotoUrls.map(url => ({
      url,
      lat: req.body.lat ? parseFloat(req.body.lat) : undefined,
      lng: req.body.lng ? parseFloat(req.body.lng) : undefined,
      uploadedAt: new Date()
    }));

    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: 'pending_review',
        helperCompletedAt: new Date(),
        completionRequest: {
          initiatedBy: req.userId,
          initiatorPhotos: photos,
          status: 'pending',
          createdAt: new Date()
        }
      }
    });

    res.json({ message: 'Completion submitted, awaiting poster confirmation' });

    notify(req, job.posterId, {
      type: 'completion_requested',
      title: 'Work Done — Please Confirm 🔔',
      message: `Your helper marked "${job.title}" as complete. Check & confirm to release payment.`,
      jobId: job.id
    });
  } catch (err) {
    console.error('Complete error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/jobs/:id/confirm-completion ───
router.post('/:id/confirm-completion', auth, upload.array('photos', 10), async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(404).json({ error: 'Job not found' });
    const { rating, comment } = req.body;
    const job = await prisma.job.findFirst({
      where: { id: req.params.id, posterId: req.userId },
      include: { applications: { select: { id: true, applicantId: true } } }
    });
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.status !== 'pending_review') return res.status(400).json({ error: `Cannot confirm: job is ${job.status}` });

    const ratingNum = parseInt(rating);
    if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ error: 'Rating must be an integer between 1 and 5' });
    }

    // Confirmation photos accepted for parity but not persisted separately
    if (req.files && req.files.length > 0) await uploadFiles(req.files, 'proof');

    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: 'pending_payment',
        posterConfirmedAt: new Date(),
        posterReviewed: true,
        posterReview: {
          overallRating: ratingNum,
          comment: comment ? sanitizeString(comment, MAX_REVIEW) : '',
          createdAt: new Date()
        }
      }
    });

    res.json({ message: 'Completion confirmed, awaiting payment' });

    try {
      const { acceptedApp } = getJobParties(job, req.userId);
      if (acceptedApp) {
        notify(req, acceptedApp.applicantId, {
          type: 'job_pending_payment',
          title: 'Completion Confirmed 💳',
          message: `"${job.title}" confirmed — payment handshake is next`,
          jobId: job.id
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
    if (!isId(req.params.id)) return res.status(404).json({ error: 'Job not found' });
    const { rating, overallRating, comment, target } = req.body;
    const job = await prisma.job.findUnique({
      where: { id: req.params.id },
      include: { applications: { select: { id: true, applicantId: true } } }
    });
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.status !== 'completed' && job.status !== 'pending_payment' && job.status !== 'in_progress' && job.status !== 'pending_review') {
      return res.status(400).json({ error: 'Job not ready for review' });
    }

    const ratingNum = parseInt(rating !== undefined ? rating : overallRating);
    if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ error: 'Rating must be an integer between 1 and 5' });
    }

    const { isPoster, isProvider } = getJobParties(job, req.userId);

    let reviewTarget = target;
    if (!reviewTarget) {
      if (isPoster) reviewTarget = 'provider';
      else if (isProvider) reviewTarget = 'poster';
    }

    const review = {
      overallRating: ratingNum,
      comment: comment ? sanitizeString(comment, MAX_REVIEW) : '',
      createdAt: new Date()
    };

    if (isPoster && reviewTarget === 'provider') {
      await prisma.job.update({ where: { id: job.id }, data: { posterReviewed: true, posterReview: review } });
    } else if (isProvider && reviewTarget === 'poster') {
      await prisma.job.update({ where: { id: job.id }, data: { providerReviewed: true, providerReview: review } });
    } else {
      return res.status(403).json({ error: 'Not authorized for this review' });
    }

    res.json({ message: 'Review submitted' });
  } catch (err) {
    console.error('Review error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/jobs/:id/payment-handshake ───
router.post('/:id/payment-handshake', auth, async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(404).json({ error: 'Job not found' });
    const { lat, lng } = req.body;
    const job = await prisma.job.findUnique({
      where: { id: req.params.id },
      include: { applications: { select: { id: true, applicantId: true } } }
    });
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.status !== 'pending_payment') return res.status(400).json({ error: `Cannot handshake: job is ${job.status}` });

    const { isPoster, isProvider, acceptedApplicantId } = getJobParties(job, req.userId);
    if (!isPoster && !isProvider) return res.status(403).json({ error: 'Not authorized' });

    // ── QR Proximity check ──
    if (lat !== undefined && lng !== undefined) {
      const latNum = parseFloat(lat);
      const lngNum = parseFloat(lng);
      if (!isNaN(latNum) && !isNaN(lngNum) && job.lat != null && job.lng != null) {
        const dist = getDistanceKm(latNum, lngNum, job.lat, job.lng);
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

    // Atomic array append guarded against duplicates (Mongo $addToSet
    // equivalent): only appends while pending_payment and not yet present.
    const latNum = lat !== undefined ? parseFloat(lat) : null;
    const lngNum = lng !== undefined ? parseFloat(lng) : null;
    const logEntry = JSON.stringify([{
      event: 'payment_confirmed',
      posterLocation: isPoster ? { lat: latNum, lng: lngNum } : undefined,
      providerLocation: isProvider ? { lat: latNum, lng: lngNum } : undefined,
      triggeredAt: new Date()
    }]);
    const appended = await prisma.$executeRaw`
      UPDATE jobs
      SET payment_confirmed_by = array_append(payment_confirmed_by, ${req.userId}::uuid),
          handshake_log = handshake_log || ${logEntry}::jsonb
      WHERE id = ${req.params.id}::uuid
        AND status = 'pending_payment'
        AND NOT (payment_confirmed_by @> ARRAY[${req.userId}::uuid])`;
    if (appended === 0) {
      // Either no longer pending_payment, or a concurrent duplicate.
      const fresh = await prisma.job.findUnique({ where: { id: job.id }, select: { status: true, paymentConfirmedBy: true } });
      if (fresh && fresh.status === 'pending_payment' && (fresh.paymentConfirmedBy || []).map(String).includes(String(req.userId))) {
        return res.json({ message: 'Payment already confirmed by you', awaitingOther: fresh.paymentConfirmedBy.length < 2 });
      }
      return res.status(400).json({ error: 'Job is no longer awaiting payment' });
    }

    const updated = await prisma.job.findUnique({ where: { id: job.id }, select: { paymentConfirmedBy: true } });

    let bothConfirmed = false;
    if ((updated?.paymentConfirmedBy || []).length >= 2) {
      // Guarded finalize: exactly one request wins and moves the money.
      const finalizedGuard = await prisma.job.updateMany({
        where: { id: job.id, status: 'pending_payment' },
        data: {
          paymentConfirmed: true,
          paymentConfirmedAt: new Date(),
          status: 'completed',
          completedAt: new Date()
        }
      });
      bothConfirmed = true;

      if (finalizedGuard.count > 0) {
        const finalized = await prisma.job.findUnique({ where: { id: job.id } });
        try {
          const transaction = finalized.transactionId
            ? await prisma.transaction.findUnique({ where: { id: finalized.transactionId } })
            : await prisma.transaction.findFirst({ where: { jobId: finalized.id, status: { in: ['in_progress', 'accepted', 'pending'] } } });
          if (transaction) {
            if (transaction.paymentMethod === 'escrow') {
              await releaseEscrow(transaction);
            } else {
              // Cash: money changed hands in person — just close the record.
              await prisma.transaction.update({ where: { id: transaction.id }, data: { status: 'completed', completedAt: new Date() } });
            }
          } else {
            console.error(`Payment handshake: no transaction found for job ${finalized.id} — funds not moved`);
          }
        } catch (payErr) {
          console.error('Escrow release error:', payErr);
        }

        notify(req, finalized.posterId, {
          type: 'job_completed',
          title: 'Job Completed ✅',
          message: `"${finalized.title}" is done — payment confirmed by both parties.`,
          jobId: finalized.id
        });
        if (acceptedApplicantId) {
          notify(req, acceptedApplicantId, {
            type: 'job_completed',
            title: finalized.paymentMethod === 'escrow' ? 'Payment Released 💰' : 'Job Completed ✅',
            message: finalized.paymentMethod === 'escrow'
              ? `Escrow for "${finalized.title}" has been released to your balance.`
              : `"${finalized.title}" is complete. Don't forget to leave a review!`,
            jobId: finalized.id
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
router.post('/:id/partial-release', auth, async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(404).json({ error: 'Job not found' });
    const { amount } = req.body;
    const job = await prisma.job.findFirst({ where: { id: req.params.id, posterId: req.userId } });
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.partialEscrowReleased) return res.status(400).json({ error: 'Partial release already done' });
    if (job.paymentMethod !== 'escrow') return res.status(400).json({ error: 'Partial release only applies to escrow jobs' });
    if (!['in_progress', 'pending_review', 'pending_payment'].includes(job.status)) {
      return res.status(400).json({ error: `Cannot release funds while job is ${job.status}` });
    }

    const releaseAmount = parseFloat(amount);
    if (isNaN(releaseAmount) || releaseAmount <= 0) return res.status(400).json({ error: 'Invalid amount' });

    const transaction = job.transactionId
      ? await prisma.transaction.findUnique({ where: { id: job.transactionId } })
      : await prisma.transaction.findFirst({ where: { jobId: job.id, escrowStatus: 'held' } });
    if (!transaction) return res.status(400).json({ error: 'No escrow transaction found for this job' });

    const percentage = (releaseAmount / Number(transaction.randAmount)) * 100;
    let releasedTx;
    try {
      releasedTx = await partialReleaseEscrow(transaction, percentage, req.userId);
    } catch (escrowErr) {
      return res.status(400).json({ error: escrowErr.message });
    }

    const releasedAmount = Number(releasedTx.partialReleaseAmount);
    await prisma.job.update({
      where: { id: job.id },
      data: {
        partialEscrowReleased: true,
        partialEscrowAmount: releasedAmount,
        partialEscrowReleasedAt: new Date()
      }
    });

    res.json({ message: `R${releasedAmount} released to your helper`, releasedAmount });

    try {
      const acceptedApp = job.acceptedApplicationId
        ? await prisma.application.findUnique({ where: { id: job.acceptedApplicationId }, select: { applicantId: true } })
        : null;
      if (acceptedApp) {
        notify(req, acceptedApp.applicantId, {
          type: 'partial_release',
          title: 'Advance Payment 💰',
          message: `R${releasedAmount} was released to your balance for "${job.title}".`,
          jobId: job.id
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
    if (!isId(req.params.id)) return res.status(404).json({ error: 'Job not found' });
    const { scannedUserId, lat, lng, manual } = req.body;
    const job = await prisma.job.findUnique({
      where: { id: req.params.id },
      include: { applications: { select: { id: true, applicantId: true } } }
    });
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const { isPoster, isProvider, acceptedApplicantId } = getJobParties(job, req.userId);
    if (!isPoster && !isProvider) return res.status(403).json({ error: 'Not authorized' });

    if (job.status !== 'accepted') {
      return res.status(400).json({ error: `Cannot start: job is ${job.status}` });
    }

    // Proximity check (skip for manual completion)
    if (!manual && lat !== undefined && lng !== undefined && job.lat != null) {
      const dist = getDistanceKm(parseFloat(lat), parseFloat(lng), job.lat, job.lng);
      if (dist > QR_PROXIMITY_KM) {
        return res.status(400).json({ error: `Too far from job location (${dist.toFixed(2)}km). Must be within ${QR_PROXIMITY_KM * 1000}m.` });
      }
    }

    const qrConfirmedBy = (job.qrConfirmedBy || []).map(String);
    if (qrConfirmedBy.includes(String(req.userId))) {
      return res.json({ message: 'QR handshake already recorded by you', awaitingOther: qrConfirmedBy.length < 2 });
    }

    // Atomic guarded append (same pattern as payment-handshake).
    const otherUserId = isPoster ? acceptedApplicantId : String(job.posterId);
    const scanEntry = JSON.stringify([{
      scannerId: req.userId,
      scannedId: scannedUserId || otherUserId,
      method: manual ? 'manual' : 'qr_scan',
      scannedAt: new Date()
    }]);
    const appended = await prisma.$executeRaw`
      UPDATE jobs
      SET qr_confirmed_by = array_append(qr_confirmed_by, ${req.userId}::uuid),
          qr_handshakes = qr_handshakes || ${scanEntry}::jsonb
      WHERE id = ${req.params.id}::uuid
        AND status = 'accepted'
        AND NOT (qr_confirmed_by @> ARRAY[${req.userId}::uuid])`;
    if (appended === 0) {
      return res.json({ message: 'QR handshake already recorded by you', awaitingOther: true });
    }

    const fresh = await prisma.job.findUnique({ where: { id: job.id }, select: { qrConfirmedBy: true } });
    const confirmedCount = (fresh?.qrConfirmedBy || []).length;

    const io = req.app.get('io');
    const room = `job_${job.id}`;
    io.to(room).emit('device_handshake_complete', {
      jobId: String(job.id),
      confirmedBy: req.userId,
      awaitingOther: confirmedCount < 2
    });

    let jobStarted = false;
    let startedAt = null;

    if (confirmedCount >= 2) {
      // Guarded start: exactly one request flips accepted → in_progress.
      startedAt = new Date();
      const startGuard = await prisma.job.updateMany({
        where: { id: job.id, status: 'accepted' },
        data: { status: 'in_progress', startedAt }
      });
      jobStarted = true;

      if (startGuard.count > 0) {
        io.to(room).emit('job_started', {
          jobId: String(job.id),
          title: job.title,
          startedAt
        });

        notify(req, job.posterId, {
          type: 'job_started',
          title: 'Job Started 🚀',
          message: `"${job.title}" has started! Track it in your Active jobs.`,
          jobId: job.id
        });
        if (otherUserId) {
          notify(req, otherUserId, {
            type: 'job_started',
            title: 'Job Started 🚀',
            message: `"${job.title}" has started! Track it in your Active jobs.`,
            jobId: job.id
          });
        }
      }
    } else if (otherUserId) {
      notify(req, otherUserId, {
        type: 'qr_handshake_ready',
        title: 'QR Handshake Waiting 📱',
        message: `The other party scanned your QR for "${job.title}". Please scan theirs to start the job.`,
        jobId: job.id
      });
    }

    res.json({
      message: jobStarted
        ? 'Job started! Both parties confirmed.'
        : 'QR handshake recorded. Awaiting other party.',
      status: jobStarted ? 'in_progress' : job.status,
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
    if (!isId(req.params.id)) return res.status(404).json({ error: 'Job not found' });
    const updated = await prisma.job.updateMany({
      where: { id: req.params.id, posterId: req.userId },
      data: {
        manualStartAllowedByPoster: true,
        manualStartPermissionAt: new Date(),
        manualStartPermissionBy: req.userId
      }
    });
    if (updated.count === 0) return res.status(404).json({ error: 'Job not found' });
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
