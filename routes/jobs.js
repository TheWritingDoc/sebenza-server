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
const { auth } = require('../middleware/authToken');

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
  communityStats: true, flags: true, primaryCategory: true, portfolioImages: true
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
  // These contain geo-tagged on-site photos and dispute notes — only the two
  // parties should see them, never a random browser of the job.
  delete j.issueReports;
  delete j.workProofPhotos;
  delete j.completionRequest;
  delete j.paymentConfirmedBy;
  delete j.qrConfirmedBy;
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
  return hideBlindReviews(j, requesterId);
}

// ─── Double-blind reviews ───
// Until the job is fully completed (payment received + final QR scan), each
// party can only see the review THEY wrote — never the one written about them.
function hideBlindReviews(j, requesterId) {
  if (!j || j.status === 'completed') return j;
  const posterId = String(j.posterId?.id || j.posterId?._id || j.posterId || '');
  if (requesterId && String(requesterId) === posterId) {
    delete j.providerReview;
  } else {
    delete j.posterReview;
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

// Apply-spam guard (notification spam to posters).
const applyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 40,
  keyGenerator: (req, res) => req.userId || ipKeyGenerator(req, res),
  message: { error: 'You are applying too quickly. Please slow down.' },
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

// ── Community feedback plumbing ───────────────────────────────────────
// Job ratings feed the COMMUNITY half of the 10-star ladder. Every rating a
// user receives updates their running average; completing a job bumps the
// jobsCompleted/jobsRequested counters (and the firstJob identity star).
async function applyRatingToUser(userId, rating) {
  try {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { communityStats: true } });
    if (!u) return;
    const cs = { ...(u.communityStats || {}) };
    const n = (cs.totalReceivedReviews || 0) + 1;
    cs.receivedRatingsAvg = Math.round(((((cs.receivedRatingsAvg || 0) * (n - 1)) + rating) / n) * 100) / 100;
    cs.totalReceivedReviews = n;
    // Redemption: a 4★+ rating from a real job wears down past issue reports.
    if (rating >= 4 && cs.jobIssuesAgainst > 0) cs.jobIssuesAgainst = cs.jobIssuesAgainst - 1;
    await prisma.user.update({ where: { id: userId }, data: { communityStats: cs } });
    await recomputeJobBehaviourFlags(userId).catch(() => {});
  } catch (e) {
    console.error('applyRatingToUser failed:', e.message);
  }
}

async function bumpCompletionCounters(providerId, posterId) {
  try {
    for (const [id, key] of [[providerId, 'jobsCompleted'], [posterId, 'jobsRequested']]) {
      if (!id) continue;
      const u = await prisma.user.findUnique({ where: { id }, select: { communityStats: true } });
      if (!u) continue;
      const cs = { ...(u.communityStats || {}) };
      cs[key] = (cs[key] || 0) + 1;
      // Redemption: every cleanly completed job wears down "complains often" —
      // filed complaints fade as the user proves they can work with others.
      if (cs.jobComplaintsFiled > 0) cs.jobComplaintsFiled = cs.jobComplaintsFiled - 1;
      await prisma.user.update({ where: { id }, data: { communityStats: cs } });
      await recomputeJobBehaviourFlags(id).catch(() => {});
    }
    // First completed job is an identity trust item for the provider.
    if (providerId) {
      const { refreshTrust } = require('../utils/trustScore');
      await refreshTrust(prisma, providerId).catch(() => {});
    }
  } catch (e) {
    console.error('bumpCompletionCounters failed:', e.message);
  }
}

// ── Behaviour flags from the JOB flow ─────────────────────────────────
// Issue reports raise counters; good completed work lowers them again
// (redemption). Flags describe recorded facts, never labels: what shows on a
// profile is "N issue reports across M jobs", derived here.
//   jobIssuesAgainst    — issues other parties filed on this user's jobs
//   jobComplaintsFiled  — issues this user filed against others
async function recomputeJobBehaviourFlags(userId) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { communityStats: true, flags: true } });
  if (!u) return;
  const cs = u.communityStats || {};
  const flags = Array.isArray(u.flags) ? u.flags : [];
  const totalJobs = Math.max(1, (cs.jobsCompleted || 0) + (cs.jobsRequested || 0));
  const issuesAgainst = cs.jobIssuesAgainst || 0;
  const complaintsFiled = cs.jobComplaintsFiled || 0;

  const shouldDisputeFlag = issuesAgainst >= 2 && issuesAgainst / totalJobs >= 0.25;
  const shouldComplainerFlag = complaintsFiled >= 3 && complaintsFiled / totalJobs >= 0.5;

  let changed = false;
  const next = flags.map(f => {
    // Redemption: auto-resolve when the driving counter has recovered.
    if (!f.resolved && f.type === 'multiple_disputes' && f.source === 'jobs' && !shouldDisputeFlag) {
      changed = true;
      return { ...f, resolved: true, resolvedAt: new Date(), resolution: 'Redeemed — issue rate recovered through completed jobs' };
    }
    if (!f.resolved && f.type === 'high_complainer' && f.source === 'jobs' && !shouldComplainerFlag) {
      changed = true;
      return { ...f, resolved: true, resolvedAt: new Date(), resolution: 'Redeemed — completed jobs without further complaints' };
    }
    return f;
  });
  if (shouldDisputeFlag && !next.some(f => f.type === 'multiple_disputes' && !f.resolved)) {
    next.push({ type: 'multiple_disputes', source: 'jobs', reason: `${issuesAgainst} issue report${issuesAgainst === 1 ? '' : 's'} across ${totalJobs} job${totalJobs === 1 ? '' : 's'}`, createdAt: new Date() });
    changed = true;
  }
  if (shouldComplainerFlag && !next.some(f => f.type === 'high_complainer' && !f.resolved)) {
    next.push({ type: 'high_complainer', source: 'jobs', reason: `Filed ${complaintsFiled} issue report${complaintsFiled === 1 ? '' : 's'} across ${totalJobs} job${totalJobs === 1 ? '' : 's'}`, createdAt: new Date() });
    changed = true;
  }
  if (changed) {
    await prisma.user.update({ where: { id: userId }, data: { flags: next } });
  }
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
      return hideBlindReviews(obj, req.userId);
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
      return hideBlindReviews(obj, req.userId);
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
      return res.json(toDTO(hideBlindReviews(obj, reqUserId)));
    }

    // Non-party viewer: public DTO only (proof photos / issue reports stripped).
    const pub = toPublicJob(job, reqUserId);
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
router.post('/:id/apply', auth, applyLimiter, async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(404).json({ error: 'Job not found' });
    const { proposedAmount, proposedTime, message, quoteType, quoteFee } = req.body;
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

    // Quote terms: helpers can quote for free or charge a call-out/quote fee
    // (paid by the poster on approval - compensates travel/assessment time).
    const qType = quoteType === 'paid' ? 'paid' : 'free';
    const qFee = qType === 'paid' ? parseFloat(quoteFee) : 0;
    if (qType === 'paid' && (isNaN(qFee) || qFee < 1 || qFee > 500)) {
      return res.status(400).json({ error: 'Quote fee must be between R1 and R500' });
    }

    // Duplicate guard: unique (jobId, applicantId) constraint does it atomically.
    try {
      await prisma.application.create({
        data: {
          jobId: job.id,
          applicantId: req.userId,
          proposedAmount: amount,
          quoteType: qType,
          quoteFee: qFee,
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
        message: `${applicant?.name || 'Someone'} offered R${amount} for "${job.title}"${qType === 'paid' ? ` (quote fee R${qFee})` : ''}`,
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
      const app = await tx.application.findUnique({ where: { id: req.params.appId }, select: { quoteType: true, quoteFee: true, quoteFeePaid: true, applicantId: true } });
      // Paid quote: the fee moves poster -> helper the moment the quote is
      // accepted (approval), guarded against overdraw and double-payment.
      if (app && app.quoteType === 'paid' && Number(app.quoteFee) > 0 && !app.quoteFeePaid) {
        const fee = Number(app.quoteFee);
        const debit = await tx.user.updateMany({
          where: { id: req.userId, randBalance: { gte: fee } },
          data: { randBalance: { decrement: fee } }
        });
        if (debit.count === 0) throw Object.assign(new Error(`Insufficient balance for the R${fee} quote fee`), { status: 400 });
        await tx.user.update({ where: { id: app.applicantId }, data: { randBalance: { increment: fee }, totalEarnedRand: { increment: fee } } });
        await tx.application.update({ where: { id: req.params.appId }, data: { quoteFeePaid: true } });
      }
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
    if (err.status === 400) return res.status(400).json({ error: err.message });
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
// Two flows share this endpoint:
//  1. Helper locks in an already-approved offer (approved → accepted).
//  2. EITHER party accepts the other's pending counter while the job is still
//     open — this approves the application at the countered amount/time. The
//     helper must still /confirm afterwards (that is where escrow is funded),
//     so accepting a counter never skips the T&C/funding step.
router.post('/:id/applications/:appId/accept-offer', auth, async (req, res) => {
  try {
    if (!isId(req.params.id) || !isId(req.params.appId)) return res.status(400).json({ error: 'Cannot accept offer' });

    const job = await prisma.job.findUnique({
      where: { id: req.params.id },
      select: { id: true, title: true, posterId: true, status: true }
    });
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const app = await prisma.application.findFirst({ where: { id: req.params.appId, jobId: job.id } });
    if (!app) return res.status(404).json({ error: 'Application not found' });

    const isPoster = String(job.posterId) === req.userId;
    const isApplicant = String(app.applicantId) === req.userId;
    if (!isPoster && !isApplicant) return res.status(403).json({ error: 'Not authorized' });

    // Flow 1: helper locks in the approved offer.
    if (isApplicant && job.status === 'approved') {
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
        return true;
      });
      if (!accepted) return res.status(400).json({ error: 'Cannot accept offer' });
      res.json({ message: 'Offer accepted' });

      notify(req, job.posterId, {
        type: 'offer_accepted',
        title: 'Offer Accepted ✅',
        message: `Your helper accepted the offer for "${job.title}"`,
        jobId: job.id
      });
      return;
    }

    // Flow 2: accept the other party's pending counter (breaks the old
    // negotiation deadlock where neither side had a working Accept button).
    const history = Array.isArray(app.negotiationHistory) ? app.negotiationHistory : [];
    const lastOffer = history.length ? history[history.length - 1] : null;
    const lastBy = lastOffer ? String(lastOffer.proposedBy) : null;
    const isOthersPendingOffer = lastOffer && lastOffer.status === 'pending' && lastBy !== req.userId;
    if (job.status !== 'open' || !isOthersPendingOffer) {
      return res.status(400).json({ error: 'Cannot accept offer' });
    }

    const agreedAmount = parseFloat(lastOffer.amount) || Number(app.proposedAmount);
    const agreedTime = lastOffer.proposedTime ? new Date(lastOffer.proposedTime) : null;
    history[history.length - 1] = { ...lastOffer, status: 'accepted', acceptedAt: new Date() };

    const approved = await prisma.$transaction(async (tx) => {
      const guard = await tx.job.updateMany({
        where: { id: job.id, status: 'open' },
        data: { status: 'approved', acceptedApplicationId: app.id }
      });
      if (guard.count === 0) return null;
      await tx.application.update({
        where: { id: app.id },
        data: { status: 'approved', approvedAmount: agreedAmount, approvedTime: agreedTime, negotiationHistory: history }
      });
      return true;
    });
    if (!approved) return res.status(400).json({ error: 'Cannot accept offer' });

    res.json({ message: 'Offer accepted', agreedAmount, nextStep: 'confirm' });

    if (isPoster) {
      notify(req, app.applicantId, {
        type: 'application_approved',
        title: 'Your Offer Was Accepted! 🎉',
        message: `R${agreedAmount} agreed for "${job.title}" — confirm now to lock it in`,
        jobId: job.id
      });
    } else {
      notify(req, job.posterId, {
        type: 'offer_accepted',
        title: 'Offer Accepted ✅',
        message: `Your helper accepted R${agreedAmount} for "${job.title}" — waiting for their final confirmation`,
        jobId: job.id
      });
    }
  } catch (err) {
    console.error('Accept offer error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/jobs/:id/applications/:appId/reject-offer ───
// Either party can decline the other's pending counter. Rejecting closes the
// application (both clients treat it as final and prompt a fresh apply).
router.post('/:id/applications/:appId/reject-offer', auth, async (req, res) => {
  try {
    if (!isId(req.params.id) || !isId(req.params.appId)) return res.status(404).json({ error: 'Not found' });

    const job = await prisma.job.findUnique({ where: { id: req.params.id }, select: { id: true, title: true, posterId: true } });
    if (!job) return res.status(404).json({ error: 'Not found' });
    const app = await prisma.application.findFirst({ where: { id: req.params.appId, jobId: job.id } });
    if (!app) return res.status(404).json({ error: 'Not found' });

    const isPoster = String(job.posterId) === req.userId;
    const isApplicant = String(app.applicantId) === req.userId;
    if (!isPoster && !isApplicant) return res.status(403).json({ error: 'Not authorized' });

    const history = Array.isArray(app.negotiationHistory) ? app.negotiationHistory : [];
    if (history.length && history[history.length - 1].status === 'pending') {
      history[history.length - 1] = { ...history[history.length - 1], status: 'rejected', rejectedAt: new Date() };
    }
    await prisma.application.update({
      where: { id: app.id },
      data: { status: 'rejected', negotiationHistory: history }
    });
    res.json({ message: 'Offer rejected' });

    const counterparty = isPoster ? app.applicantId : job.posterId;
    notify(req, counterparty, {
      type: 'offer_rejected',
      title: 'Offer Declined',
      message: `Your offer for "${job.title}" was declined — you can send a new one`,
      jobId: job.id
    });
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

    // Job is now locked in — close out every other applicant and tell them.
    try {
      const losers = await prisma.application.findMany({
        where: {
          jobId: flipped.id,
          id: { not: req.params.appId },
          status: { notIn: ['rejected', 'withdrawn', 'accepted'] }
        },
        select: { id: true, applicantId: true }
      });
      if (losers.length > 0) {
        await prisma.application.updateMany({
          where: { id: { in: losers.map(l => l.id) } },
          data: { status: 'rejected' }
        });
        for (const uid of [...new Set(losers.map(l => String(l.applicantId)))]) {
          notify(req, uid, {
            type: 'application_unsuccessful',
            title: 'Position Filled',
            message: `"${flipped.title}" has been given to another helper. Thanks for offering — more jobs are posted every day!`,
            jobId: flipped.id
          });
        }
      }
    } catch (loserErr) {
      console.error('Unsuccessful-applicant notify error:', loserErr.message);
    }
  } catch (err) {
    console.error('Confirm error:', err);
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

    const { isPoster, acceptedApplicantId } = getJobParties(job, req.userId);
    const otherPartyId = isPoster ? acceptedApplicantId : job.posterId;
    if (otherPartyId) {
      notify(req, otherPartyId, {
        type: 'issue_reported',
        title: '⚠️ Issue Reported',
        message: `${isPoster ? 'The job provider' : 'Your helper'} reported an issue on "${job.title}"`,
        jobId: job.id
      });
    }

    // Behaviour tracking: raise the reported party's issue counter and the
    // reporter's complaint counter, then re-derive visible flags.
    try {
      for (const [uid, key] of [[String(otherPartyId || ''), 'jobIssuesAgainst'], [String(req.userId), 'jobComplaintsFiled']]) {
        if (!uid) continue;
        const u = await prisma.user.findUnique({ where: { id: uid }, select: { communityStats: true } });
        if (!u) continue;
        const cs = { ...(u.communityStats || {}) };
        cs[key] = (cs[key] || 0) + 1;
        await prisma.user.update({ where: { id: uid }, data: { communityStats: cs } });
        await recomputeJobBehaviourFlags(uid);
      }
    } catch (e) { console.error('Issue behaviour tracking failed:', e.message); }
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

    const { isPoster, acceptedApplicantId } = getJobParties(job, req.userId);
    const otherPartyId = isPoster ? acceptedApplicantId : job.posterId;
    if (otherPartyId) {
      notify(req, otherPartyId, {
        type: 'photos_uploaded',
        title: '📸 New Photos Uploaded',
        message: `${isPoster ? 'The job provider' : 'Your helper'} uploaded ${cleanStage} photos for "${job.title}"`,
        jobId: job.id
      });
    }
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

    // Tell the helper the job was cancelled — with the reason — so they are
    // never left waiting at a job that no longer exists.
    try {
      const acceptedApp = job.acceptedApplicationId
        ? await prisma.application.findUnique({ where: { id: job.acceptedApplicationId }, select: { applicantId: true } })
        : null;
      if (acceptedApp) {
        notify(req, acceptedApp.applicantId, {
          type: 'job_cancelled',
          title: 'Job Cancelled ⚠️',
          message: `"${job.title}" was cancelled by the poster${reason ? ` — reason: ${sanitizeString(reason, 300)}` : ''}. If it was due to unforeseen circumstances, they may repost it — you can offer to help again.`,
          jobId: job.id
        });
      }
    } catch (notifyErr) {
      console.error('Stop-job notify error:', notifyErr.message);
    }
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

    // Rating moved AFTER payment (owner decision 2026-07-12): confirming the
    // work and rating the person are separate moments now. An inline rating is
    // still accepted for backwards compatibility, but no longer required.
    const ratingNum = parseInt(rating);
    const hasInlineRating = !isNaN(ratingNum) && ratingNum >= 1 && ratingNum <= 5;

    // Confirmation photos accepted for parity but not persisted separately
    if (req.files && req.files.length > 0) await uploadFiles(req.files, 'proof');

    const data = {
      status: 'pending_payment',
      posterConfirmedAt: new Date()
    };
    const applyInlineRating = hasInlineRating && !job.posterReviewed;
    if (applyInlineRating) {
      data.posterReviewed = true;
      data.posterReview = {
        overallRating: ratingNum,
        comment: comment ? sanitizeString(comment, MAX_REVIEW) : '',
        createdAt: new Date()
      };
    }
    await prisma.job.update({ where: { id: job.id }, data });

    res.json({ message: 'Completion confirmed, awaiting payment' });

    // The poster's rating counts toward the provider's community stars.
    if (applyInlineRating) {
      try {
        const { acceptedApp: ratedApp } = getJobParties(job, req.userId);
        if (ratedApp) await applyRatingToUser(String(ratedApp.applicantId), ratingNum);
      } catch (e) { console.error('confirm-completion rating error:', e.message); }
    }

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

    let ratedUserId = null;
    if (isPoster && reviewTarget === 'provider') {
      if (job.posterReviewed) return res.status(400).json({ error: 'You already reviewed this job' });
      await prisma.job.update({ where: { id: job.id }, data: { posterReviewed: true, posterReview: review } });
      const { acceptedApp } = getJobParties(job, req.userId);
      if (acceptedApp) {
        ratedUserId = String(acceptedApp.applicantId);
        await applyRatingToUser(ratedUserId, ratingNum);
      }
    } else if (isProvider && reviewTarget === 'poster') {
      if (job.providerReviewed) return res.status(400).json({ error: 'You already reviewed this job' });
      await prisma.job.update({ where: { id: job.id }, data: { providerReviewed: true, providerReview: review } });
      ratedUserId = String(job.posterId);
      await applyRatingToUser(ratedUserId, ratingNum);
    } else {
      return res.status(403).json({ error: 'Not authorized for this review' });
    }

    res.json({ message: 'Review submitted' });

    // Double-blind: before the job is fully completed the other party only
    // learns THAT you rated, not WHAT. The star value is revealed by the
    // payment-handshake finalizer once payment is confirmed.
    if (ratedUserId && job.status === 'completed') {
      notify(req, ratedUserId, {
        type: 'rating_received',
        title: `You Got ${'⭐'.repeat(ratingNum)}`,
        message: `${ratingNum}/5 stars for "${job.title}"${review.comment ? ` — "${review.comment.slice(0, 80)}"` : ''}`,
        jobId: job.id
      });
    } else if (ratedUserId) {
      notify(req, ratedUserId, {
        type: 'review_submitted',
        title: 'You Were Rated ⭐',
        message: `Your rating for "${job.title}" will be revealed once payment is confirmed.`,
        jobId: job.id
      });
    }
  } catch (err) {
    console.error('Review error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/jobs/:id/payment-handshake ───
router.post('/:id/payment-handshake', auth, async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(404).json({ error: 'Job not found' });
    const { lat, lng, manual } = req.body;
    const job = await prisma.job.findUnique({
      where: { id: req.params.id },
      include: { applications: { select: { id: true, applicantId: true } } }
    });
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const { isPoster, isProvider, acceptedApplicantId } = getJobParties(job, req.userId);
    if (!isPoster && !isProvider) return res.status(403).json({ error: 'Not authorized' });

    if (job.status !== 'pending_payment') {
      // Idempotent: the other party's single scan already finalized it.
      if (job.status === 'completed' && job.paymentConfirmed) {
        return res.json({ message: 'Payment already confirmed. Job completed.', paymentConfirmed: true });
      }
      return res.status(400).json({ error: `Cannot handshake: job is ${job.status}` });
    }

    // ── QR Proximity check (skipped for manual confirmation) ──
    if (!manual && lat !== undefined && lng !== undefined) {
      const latNum = parseFloat(lat);
      const lngNum = parseFloat(lng);
      if (!isNaN(latNum) && !isNaN(lngNum) && job.lat != null && job.lng != null) {
        const dist = getDistanceKm(latNum, lngNum, job.lat, job.lng);
        if (dist > QR_PROXIMITY_KM) {
          return res.status(400).json({ error: `Too far from job location (${dist.toFixed(2)}km). Must be within ${QR_PROXIMITY_KM * 1000}m.` });
        }
      }
    }

    // ── Manual fallback requires BOTH parties ──
    // A QR scan proves the two phones were physically together, so one scan is
    // enough. A manual tap proves nothing, so each party must confirm manually
    // before the money moves.
    if (manual) {
      const already = (Array.isArray(job.paymentConfirmedBy) ? job.paymentConfirmedBy : []).map(String);
      if (!already.includes(String(req.userId))) {
        await prisma.$executeRaw`
          UPDATE jobs
          SET payment_confirmed_by = array_append(payment_confirmed_by, ${req.userId}::uuid)
          WHERE id = ${req.params.id}::uuid
            AND NOT (payment_confirmed_by @> ARRAY[${req.userId}::uuid])`;
      }
      const confirmedNow = new Set([...already, String(req.userId)]);
      const otherPartyId = isPoster ? String(acceptedApplicantId) : String(job.posterId);
      if (!confirmedNow.has(otherPartyId)) {
        notify(req, otherPartyId, {
          type: 'job_pending_payment',
          title: 'Confirm Payment ✋',
          message: `${isPoster ? 'The job provider' : 'Your helper'} manually confirmed payment for "${job.title}". Add your confirmation to complete the job.`,
          jobId: job.id
        });
        return res.json({
          message: 'Your confirmation is recorded. The job completes once the other party also confirms.',
          waitingForOther: true,
          paymentConfirmed: false
        });
      }
    }

    // Single-scan payment: ONE QR confirmation from either party (or the
    // second manual confirmation) finalizes the job. Guarded flip — exactly
    // one request wins and moves the money; the loser gets the idempotent
    // response.
    // Payment-wait timer: from the moment the helper marked the work done
    // until payment confirmation. This is the poster's "payer record" — it
    // aggregates onto their community stats so future helpers can see whether
    // they pay promptly.
    const paymentConfirmTime = new Date();
    const waitFromTs = job.helperCompletedAt || job.posterConfirmedAt || job.startedAt;
    const paymentWaitMinutes = waitFromTs
      ? Math.max(0, Math.round((paymentConfirmTime - new Date(waitFromTs)) / 60000 * 10) / 10)
      : null;

    const finalizedGuard = await prisma.job.updateMany({
      where: { id: job.id, status: 'pending_payment' },
      data: {
        paymentConfirmed: true,
        paymentConfirmedAt: paymentConfirmTime,
        status: 'completed',
        completedAt: paymentConfirmTime,
        ...(paymentWaitMinutes !== null ? { paymentWaitTimeMinutes: paymentWaitMinutes } : {})
      }
    });
    if (finalizedGuard.count === 0) {
      const fresh = await prisma.job.findUnique({ where: { id: job.id }, select: { status: true } });
      if (fresh?.status === 'completed') {
        return res.json({ message: 'Payment already confirmed. Job completed.', paymentConfirmed: true });
      }
      return res.status(400).json({ error: 'Job is no longer awaiting payment' });
    }

    // Poster payer record: rolling average of payment wait (non-critical).
    if (paymentWaitMinutes !== null) {
      try {
        const poster = await prisma.user.findUnique({ where: { id: job.posterId }, select: { communityStats: true } });
        const stats = poster?.communityStats || {};
        const n = Number(stats.paymentsConfirmed) || 0;
        const avg = Number(stats.avgPaymentWaitMinutes) || 0;
        stats.avgPaymentWaitMinutes = Math.round(((avg * n + paymentWaitMinutes) / (n + 1)) * 10) / 10;
        stats.paymentsConfirmed = n + 1;
        stats.maxPaymentWaitMinutes = Math.max(Number(stats.maxPaymentWaitMinutes) || 0, paymentWaitMinutes);
        await prisma.user.update({ where: { id: job.posterId }, data: { communityStats: stats } });
      } catch (statErr) {
        console.error('Payer record update error:', statErr.message);
      }
    }

    // Audit trail (non-critical).
    const latNum = lat !== undefined ? parseFloat(lat) : null;
    const lngNum = lng !== undefined ? parseFloat(lng) : null;
    const logEntry = JSON.stringify([{
      event: 'payment_confirmed',
      confirmedBy: req.userId,
      method: manual ? 'manual' : 'qr_scan',
      posterLocation: isPoster ? { lat: latNum, lng: lngNum } : undefined,
      providerLocation: isProvider ? { lat: latNum, lng: lngNum } : undefined,
      triggeredAt: new Date()
    }]);
    try {
      await prisma.$executeRaw`
        UPDATE jobs
        SET payment_confirmed_by = CASE
              WHEN payment_confirmed_by @> ARRAY[${req.userId}::uuid] THEN payment_confirmed_by
              ELSE array_append(payment_confirmed_by, ${req.userId}::uuid)
            END,
            handshake_log = handshake_log || ${logEntry}::jsonb
        WHERE id = ${req.params.id}::uuid`;
    } catch (logErr) {
      console.error('Payment handshake log error:', logErr.message);
    }

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

    // Completed job: bump counters (community) + firstJob star (identity)
    bumpCompletionCounters(acceptedApplicantId, String(finalized.posterId)).catch(() => {});

    const io = req.app.get('io');
    io.to(`job_${job.id}`).emit('payment_confirmed', {
      jobId: String(job.id),
      confirmed: true,
      message: 'Payment confirmed. Job completed.'
    });

    notify(req, finalized.posterId, {
      type: 'job_completed',
      title: 'Job Completed ✅',
      message: `"${finalized.title}" is done — payment confirmed.`,
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

    // Reveal double-blind ratings now that payment is confirmed.
    const revealRating = (userId, review) => {
      if (!userId || !review || !review.overallRating) return;
      const stars = parseInt(review.overallRating) || 0;
      notify(req, userId, {
        type: 'rating_received',
        title: `You Got ${'⭐'.repeat(Math.max(1, Math.min(5, stars)))}`,
        message: `${stars}/5 stars for "${finalized.title}"${review.comment ? ` — "${String(review.comment).slice(0, 80)}"` : ''}`,
        jobId: finalized.id
      });
    };
    revealRating(acceptedApplicantId, finalized.posterReview);
    revealRating(String(finalized.posterId), finalized.providerReview);

    res.json({
      message: 'Payment confirmed. Job completed.',
      paymentConfirmed: true
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
      // Idempotent: the other party's single scan already started it.
      if (job.status === 'in_progress') {
        return res.json({ message: 'Job already started.', status: 'in_progress', jobStarted: true, awaitingOther: false });
      }
      return res.status(400).json({ error: `Cannot start: job is ${job.status}` });
    }

    // Proximity check (skip for manual completion)
    if (!manual && lat !== undefined && lng !== undefined && job.lat != null) {
      const dist = getDistanceKm(parseFloat(lat), parseFloat(lng), job.lat, job.lng);
      if (dist > QR_PROXIMITY_KM) {
        return res.status(400).json({ error: `Too far from job location (${dist.toFixed(2)}km). Must be within ${QR_PROXIMITY_KM * 1000}m.` });
      }
    }

    // Single-scan start: ONE scan from either party (or a manual confirm when
    // the camera won't cooperate) starts the job. The guarded flip means only
    // the first request wins; concurrent scans get the idempotent response.
    const otherUserId = isPoster ? acceptedApplicantId : String(job.posterId);
    const startedAt = new Date();
    const startGuard = await prisma.job.updateMany({
      where: { id: job.id, status: 'accepted' },
      data: { status: 'in_progress', startedAt }
    });
    if (startGuard.count === 0) {
      return res.json({ message: 'Job already started.', status: 'in_progress', jobStarted: true, awaitingOther: false });
    }

    // Record who confirmed and how (audit trail; non-critical).
    const scanEntry = JSON.stringify([{
      scannerId: req.userId,
      scannedId: scannedUserId || otherUserId,
      method: manual ? 'manual' : 'qr_scan',
      scannedAt: startedAt
    }]);
    try {
      await prisma.$executeRaw`
        UPDATE jobs
        SET qr_confirmed_by = array_append(qr_confirmed_by, ${req.userId}::uuid),
            qr_handshakes = qr_handshakes || ${scanEntry}::jsonb
        WHERE id = ${req.params.id}::uuid`;
    } catch (logErr) {
      console.error('QR handshake log error:', logErr.message);
    }

    const io = req.app.get('io');
    const room = `job_${job.id}`;
    io.to(room).emit('device_handshake_complete', {
      jobId: String(job.id),
      confirmedBy: req.userId,
      jobStarted: true,
      awaitingOther: false
    });
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

    res.json({
      message: 'Job started!',
      status: 'in_progress',
      jobStarted: true,
      awaitingOther: false
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
