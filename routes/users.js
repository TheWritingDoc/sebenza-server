const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { prisma } = require('../db');
const { toDTO, sanitizeUser, isId } = require('../utils/dto');
const upload = require('../middleware/upload');
const { uploadFile } = require('../middleware/upload');
const { computeTrust, refreshTrust } = require('../utils/trustScore');
const { sendVerificationEmail } = require('../utils/email');

const genCode = () => Math.floor(100000 + Math.random() * 900000).toString();

const optionalAuth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (token) {
    try {
      req.user = jwt.verify(token, process.env.JWT_SECRET);
      req.isAuthenticated = true;
    } catch {
      req.isAuthenticated = false;
    }
  } else {
    req.isAuthenticated = false;
  }
  next();
};

const auth = (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.split(' ')[1];
  if (!token || token === 'null' || token === 'undefined') {
    return res.status(401).json({ error: 'No token provided' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
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

router.get('/public', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 6, 50);
    const users = await prisma.user.findMany({
      where: { NOT: { email: { contains: 'test@', mode: 'insensitive' } } },
      select: {
        id: true,
        name: true,
        avatar: true,
        primaryCategory: true,
        rating: true,
        communityStats: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    res.json(toDTO(users));
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

router.get('/nearby', optionalAuth, async (req, res) => {
  try {
    const { lat, lng, radius = 50 } = req.query;
    if (!lat || !lng) return res.status(400).json({ error: 'Lat/lng required' });
    if (isNaN(parseFloat(lat)) || isNaN(parseFloat(lng))) return res.status(400).json({ error: 'Lat/lng must be numbers' });
    if (parseFloat(radius) > 100) return res.status(400).json({ error: 'Max radius 100km' });

    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    const radiusNum = parseFloat(radius);

    const users = await prisma.user.findMany({
      where: { OR: [{ lat: { not: 0 } }, { lng: { not: 0 } }] },
      select: {
        id: true,
        name: true,
        avatar: true,
        primaryCategory: true,
        rating: true,
        communityStats: true,
        lat: true,
        lng: true,
        createdAt: true,
      },
    });

    const R = 6371;
    const nearbyUsers = users.map(user => {
      const userLat = user.lat;
      const userLng = user.lng;
      if (!userLat || !userLng) return null;

      const dLat = (userLat - latNum) * Math.PI / 180;
      const dLng = (userLng - lngNum) * Math.PI / 180;
      const a = Math.sin(dLat/2)**2 + Math.cos(latNum*Math.PI/180)*Math.cos(userLat*Math.PI/180)*Math.sin(dLng/2)**2;
      const distance = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

      if (distance > radiusNum) return null;
      const { lat: _lat, lng: _lng, ...rest } = user;
      const obj = {
        ...rest,
        // Coarsen public location to ~1km for privacy
        location: {
          coordinates: [
            Math.round(userLng * 100) / 100,
            Math.round(userLat * 100) / 100,
          ],
        },
        distance: Math.round(distance*10)/10,
      };
      return obj;
    }).filter(Boolean);

    nearbyUsers.sort((a,b) => a.distance - b.distance);
    res.json(toDTO(nearbyUsers.slice(0, 50)));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch nearby users' });
  }
});

// Get current user's referral info
router.get('/me/referral', auth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { referralCode: true, referralCount: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ referralCode: user.referralCode, referralCount: user.referralCount });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get public referrer info by referral code (for invite page)
router.get('/referrer/:code', async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { referralCode: req.params.code.toUpperCase() },
      select: { name: true, avatar: true },
    });
    if (!user) return res.status(404).json({ error: 'Referrer not found' });
    res.json({ name: user.name, avatar: user.avatar });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ===== IDENTITY TRUST STARS =====
// These stars reflect ONLY how well a user has proven their identity — they
// encourage uploading ID so both sides feel safe. Job quality lives separately
// in communityStats. See utils/trustScore.js.

// My own trust profile + checklist (drives the Trust Centre screen)
router.get('/me/trust', auth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      include: { trustDocs: true, workExperience: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const trust = computeTrust(user);
    res.json({
      ...trust,                       // score, stars, level, checklist
      accountType: user.accountType || 'individual',
      businessName: user.businessName || '',
    });
  } catch (err) {
    console.error('Trust (me) error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Public trust view for another user's profile (no sensitive data)
router.get('/:id/trust', async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(404).json({ error: 'User not found' });
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: { trustDocs: true, workExperience: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const trust = computeTrust(user);
    const recommendations = await prisma.endorsement.count({ where: { userId: user.id } });
    // If the caller is authenticated, tell them whether they've endorsed already.
    let viewerEndorsed = false;
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
      try {
        const viewerId = jwt.verify(token, process.env.JWT_SECRET).userId;
        const existing = await prisma.endorsement.findUnique({
          where: { userId_endorserId: { userId: user.id, endorserId: viewerId } },
        });
        viewerEndorsed = !!existing;
      } catch (e) { /* anonymous */ }
    }
    res.json({
      stars: trust.stars,
      level: trust.level,
      score: trust.score,
      verified: !!user.verified,
      emailVerified: !!user.emailVerified,
      phoneVerified: !!user.phoneVerified,
      recommendations,
      viewerEndorsed,
      accountType: user.accountType || 'individual',
      businessName: user.businessName || '',
    });
  } catch (err) {
    console.error('Trust (public) error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Upload a trust document (address / id / drivers_license / qualification).
// Uploaded docs count toward stars immediately (encourages ID) and are marked
// 'pending' for optional admin review; a rejected doc stops counting.
router.post('/trust-docs', auth, upload.single('trustDoc'), async (req, res) => {
  try {
    const { docType, title } = req.body;
    const allowed = ['address', 'id', 'drivers_license', 'qualification', 'experience'];
    if (!allowed.includes(docType)) {
      return res.status(400).json({ error: 'Invalid document type' });
    }
    if (!req.file) return res.status(400).json({ error: 'A document photo is required' });

    const fileUrl = await uploadFile(req.file, `trust/${docType}`);
    await prisma.trustDoc.create({
      data: {
        userId: req.user.userId,
        docType,
        title: (title || '').toString().slice(0, 120),
        fileUrl,
        status: 'pending',
        uploadedAt: new Date(),
      },
    });
    const trust = await refreshTrust(prisma, req.user.userId);
    res.json({ message: 'Document uploaded', stars: trust?.stars, level: trust?.level, score: trust?.score });
  } catch (err) {
    console.error('Trust doc upload error:', err);
    res.status(500).json({ error: 'Server error uploading document' });
  }
});

// Verified work: jobs this user completed THROUGH the app, with the proof
// photos they took during the job (camera-only, geo-tagged) and the poster's
// rating. Nothing here is self-uploaded — it's the app-verified track record.
router.get('/:id/verified-work', async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ error: 'Invalid user id' });
    const jobs = await prisma.job.findMany({
      where: {
        status: 'completed',
        applications: { some: { applicantId: req.params.id } },
      },
      select: {
        id: true,
        title: true,
        category: true,
        completedAt: true,
        posterReview: true,
        workProofPhotos: true,
        completionRequest: true,
        acceptedApplicationId: true,
        applications: { select: { id: true, applicantId: true } },
      },
      orderBy: { completedAt: 'desc' },
      take: 30,
    });

    const work = [];
    for (const j of jobs) {
      // Only count the job if THIS user was the accepted worker on it.
      const accepted = (j.applications || []).find(a => String(a.id) === String(j.acceptedApplicationId));
      if (!accepted || String(accepted.applicantId) !== String(req.params.id)) continue;

      const photos = [
        ...(j.workProofPhotos || [])
          .filter(p => String(p.uploadedBy) === String(req.params.id) && p.url)
          .map(p => ({ url: p.url, stage: p.stage })),
        ...((j.completionRequest?.initiatorPhotos || [])
          .filter(p => p.url)
          .map(p => ({ url: p.url, stage: 'after' }))),
      ].slice(0, 6);

      work.push({
        jobId: j.id,
        title: j.title,
        category: j.category,
        completedAt: j.completedAt,
        rating: j.posterReview?.overallRating || null,
        photos,
      });
      if (work.length >= 12) break;
    }
    res.json(toDTO({ work, count: work.length }));
  } catch (err) {
    console.error('Verified work error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Add a work-experience entry (no document required — self-declared)
router.post('/work-experience', auth, async (req, res) => {
  try {
    const { title, place, years } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ error: 'Please describe the work you did' });
    await prisma.workExperience.create({
      data: {
        userId: req.user.userId,
        title: title.toString().slice(0, 160),
        place: (place || '').toString().slice(0, 120),
        years: (years || '').toString().slice(0, 40),
        addedAt: new Date(),
      },
    });
    const trust = await refreshTrust(prisma, req.user.userId);
    res.json({ message: 'Experience added', stars: trust?.stars, level: trust?.level, score: trust?.score });
  } catch (err) {
    console.error('Work experience error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ===== EMAIL VERIFICATION =====
// Registration already requires an email; this lets the user prove it's theirs
// (a verifiable contact channel — phone OR email). A 6-digit code mirrors the
// SMS flow and works inside the native app without email deep-links. Demo mode
// (no SMTP creds) returns the code so the flow is testable immediately.

// Send / resend an email verification code to the signed-in user's address
router.post('/send-email-code', auth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { email: true, emailVerified: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.emailVerified) return res.json({ message: 'Email already verified', alreadyVerified: true });

    const code = genCode();
    await prisma.user.update({
      where: { id: req.user.userId },
      data: {
        emailVerificationToken: code,
        emailVerificationExpires: new Date(Date.now() + 15 * 60 * 1000),
      },
    });
    const result = await sendVerificationEmail(user.email, code);
    res.json({
      message: result.demo ? 'Verification code generated (demo mode)' : 'Verification code sent to your email',
      demo: result.demo || false,
      ...(result.demo ? { code: result.code } : {}), // demo only, for testing
    });
  } catch (err) {
    console.error('Send email code error:', err);
    res.status(500).json({ error: 'Failed to send verification email' });
  }
});

// Verify the email code -> set emailVerified + refresh trust stars
router.post('/verify-email-code', auth, async (req, res) => {
  try {
    const { code } = req.body;
    const safe = String(code || '').replace(/\D/g, '').slice(0, 6);
    if (safe.length !== 6) return res.status(400).json({ error: 'Invalid code format' });

    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { emailVerificationToken: true, emailVerificationExpires: true, emailVerified: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.emailVerified) return res.json({ message: 'Email already verified' });
    if (!user.emailVerificationToken || user.emailVerificationToken !== safe) {
      return res.status(400).json({ error: 'Incorrect code' });
    }
    if (!user.emailVerificationExpires || user.emailVerificationExpires < new Date()) {
      return res.status(400).json({ error: 'Code expired — request a new one' });
    }

    await prisma.user.update({
      where: { id: req.user.userId },
      data: {
        emailVerified: true,
        emailVerificationToken: null,
        emailVerificationExpires: null,
      },
    });
    const trust = await refreshTrust(prisma, req.user.userId);
    res.json({ message: 'Email verified', stars: trust?.stars, level: trust?.level, score: trust?.score });
  } catch (err) {
    console.error('Verify email code error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ===== BUSINESSES ON THE MAP (always-on pins) =====
// Registered businesses/teams with a location are shown on the map full-time
// (unlike jobs, which are temporary). Public — powers the map's business layer.
router.get('/businesses', async (req, res) => {
  try {
    const teams = await prisma.team.findMany({
      where: {
        lat: { not: 0 },
        lng: { not: 0 },
      },
      include: {
        supervisor: {
          select: {
            id: true,
            primaryCategory: true,
            trustStars: true,
            trustLevel: true,
            verified: true,
            profileImage: true,
          },
        },
      },
      take: 500,
    });

    res.json(toDTO(teams
      .filter(t => t.lat != null && t.lng != null && t.lat !== 0 && t.lng !== 0)
      .map(t => ({
        id: t.id,
        name: t.name,
        accountType: t.type,
        category: t.supervisor?.primaryCategory || '',
        lat: t.lat,
        lng: t.lng,
        trustStars: Number(t.supervisor?.trustStars) || 0,
        trustLevel: t.supervisor?.trustLevel || '',
        verified: !!t.supervisor?.verified,
      }))));
  } catch (err) {
    console.error('Businesses map error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ===== RECOMMEND / ENDORSE A USER =====
// "I vouch for this person." One endorsement per user; toggle on/off.
router.post('/:id/endorse', auth, async (req, res) => {
  try {
    const targetId = req.params.id;
    if (String(targetId) === String(req.user.userId)) {
      return res.status(400).json({ error: 'You cannot recommend yourself' });
    }
    if (!isId(targetId)) return res.status(404).json({ error: 'User not found' });
    const target = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true, name: true } });
    if (!target) return res.status(404).json({ error: 'User not found' });

    const existing = await prisma.endorsement.findUnique({
      where: { userId_endorserId: { userId: targetId, endorserId: req.user.userId } },
    });
    if (existing) {
      await prisma.endorsement.delete({ where: { id: existing.id } });
      const count = await prisma.endorsement.count({ where: { userId: targetId } });
      return res.json({ endorsed: false, count });
    }
    await prisma.endorsement.create({
      data: { userId: targetId, endorserId: req.user.userId, createdAt: new Date() },
    });
    const count = await prisma.endorsement.count({ where: { userId: targetId } });
    res.json({ endorsed: true, count });
  } catch (err) {
    console.error('Endorse error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ===== SAVED SERVICES (BUSINESS CARDS) =====

// Save a service to user's business cards
router.post('/save-service', auth, async (req, res) => {
  try {
    const { serviceId, notes } = req.body;
    if (!serviceId) return res.status(400).json({ error: 'Service ID required' });

    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { savedServices: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const savedServices = Array.isArray(user.savedServices) ? user.savedServices : [];

    // Check if already saved
    const alreadySaved = savedServices.some(s => String(s.serviceId) === String(serviceId));
    if (alreadySaved) {
      return res.status(400).json({ error: 'Service already saved' });
    }

    savedServices.push({ serviceId, notes: notes || '', savedAt: new Date() });
    await prisma.user.update({
      where: { id: req.user.userId },
      data: { savedServices },
    });

    res.json(toDTO({ message: 'Service saved to your Business Cards', savedServices }));
  } catch (err) {
    console.error('Save service error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Remove a saved service
router.post('/unsave-service', auth, async (req, res) => {
  try {
    const { serviceId } = req.body;
    if (!serviceId) return res.status(400).json({ error: 'Service ID required' });

    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { savedServices: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const savedServices = (Array.isArray(user.savedServices) ? user.savedServices : []).filter(
      s => String(s.serviceId) !== String(serviceId)
    );
    await prisma.user.update({
      where: { id: req.user.userId },
      data: { savedServices },
    });

    res.json(toDTO({ message: 'Service removed', savedServices }));
  } catch (err) {
    console.error('Unsave service error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get user's saved services with full service data populated
router.get('/saved-services', auth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { savedServices: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const saved = Array.isArray(user.savedServices) ? user.savedServices : [];
    const serviceIds = [...new Set(saved.map(s => s.serviceId).filter(id => isId(String(id))))];
    const services = serviceIds.length
      ? await prisma.service.findMany({
          where: { id: { in: serviceIds } },
          include: { provider: { select: { id: true, name: true, avatar: true, phone: true } } },
        })
      : [];
    const byId = new Map(services.map(({ provider, ...s }) => [s.id, { ...s, providerId: provider }]));

    const enriched = saved
      .map(s => {
        const service = byId.get(String(s.serviceId));
        if (!service) return null; // filter out deleted services
        return { ...s, serviceId: service, service };
      })
      .filter(Boolean);

    res.json(toDTO(enriched));
  } catch (err) {
    console.error('Saved services error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Check if user has saved a specific service
router.get('/has-saved/:serviceId', auth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { savedServices: true },
    });
    const hasSaved = (Array.isArray(user?.savedServices) ? user.savedServices : [])
      .some(s => String(s.serviceId) === String(req.params.serviceId));
    res.json({ hasSaved: !!hasSaved });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ===== SERVICE RECOMMENDATIONS =====

// Send a service recommendation to another user (builds clientele)
router.post('/recommend', auth, async (req, res) => {
  try {
    const { serviceId, recipientId, message } = req.body;
    if (!serviceId || !recipientId) {
      return res.status(400).json({ error: 'Service ID and recipient ID required' });
    }
    if (recipientId === req.user.userId) {
      return res.status(400).json({ error: 'Cannot recommend to yourself' });
    }
    if (!isId(String(serviceId))) return res.status(404).json({ error: 'Service not found' });
    if (!isId(String(recipientId))) return res.status(404).json({ error: 'Recipient not found' });

    const service = await prisma.service.findUnique({
      where: { id: serviceId },
      include: { provider: { select: { id: true, name: true } } },
    });
    if (!service) return res.status(404).json({ error: 'Service not found' });

    const sender = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { name: true, recommendationsSent: true },
    });
    const recipient = await prisma.user.findUnique({
      where: { id: recipientId },
      select: { id: true, name: true, savedServices: true },
    });
    if (!recipient) return res.status(404).json({ error: 'Recipient not found' });

    // Auto-save to recipient's business cards (they can remove if they want)
    const recipientSaved = Array.isArray(recipient.savedServices) ? recipient.savedServices : [];
    const alreadySaved = recipientSaved.some(s => String(s.serviceId) === String(serviceId));
    if (!alreadySaved) {
      recipientSaved.push({
        serviceId,
        notes: `Recommended by ${sender.name}${message ? ': ' + message : ''}`,
        savedAt: new Date(),
      });
      await prisma.user.update({
        where: { id: recipientId },
        data: { savedServices: recipientSaved },
      });
    }

    // Also store a recommendation record on sender for tracking
    const recommendationsSent = Array.isArray(sender.recommendationsSent) ? sender.recommendationsSent : [];
    recommendationsSent.push({
      serviceId,
      recipientId,
      message: message || '',
      sentAt: new Date(),
    });
    await prisma.user.update({
      where: { id: req.user.userId },
      data: { recommendationsSent },
    });

    res.json({
      message: `Service recommended to ${recipient.name}. It has been saved to their Business Cards.`,
      service: { title: service.title, provider: service.provider?.name },
    });
  } catch (err) {
    console.error('Recommend error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get users the current user can recommend to (contacts / nearby / interacted with)
router.get('/contacts', auth, async (req, res) => {
  try {
    const userId = req.user.userId;

    // Find users they've had transactions with
    const transactions = await prisma.transaction.findMany({
      where: { OR: [{ requesterId: userId }, { providerId: userId }] },
      select: { requesterId: true, providerId: true },
    });

    const contactIds = new Set();
    transactions.forEach(t => {
      if (t.requesterId && String(t.requesterId) !== String(userId)) contactIds.add(String(t.requesterId));
      if (t.providerId && String(t.providerId) !== String(userId)) contactIds.add(String(t.providerId));
    });

    const userSelect = { id: true, name: true, avatar: true, lat: true, lng: true, primaryCategory: true };
    const withLocation = ({ lat, lng, ...u }) => ({ ...u, location: { lat, lng } });

    // Also include nearby users (exclude self and test accounts)
    const nearbyUsers = await prisma.user.findMany({
      where: {
        id: { not: userId, notIn: Array.from(contactIds) },
        NOT: { email: { contains: 'test@', mode: 'insensitive' } },
        lat: { not: 0 },
      },
      select: userSelect,
      take: 20,
    });

    const contacts = contactIds.size
      ? await prisma.user.findMany({
          where: { id: { in: Array.from(contactIds) } },
          select: userSelect,
        })
      : [];

    res.json(toDTO({ contacts: contacts.map(withLocation), nearby: nearbyUsers.map(withLocation) }));
  } catch (err) {
    console.error('Contacts error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ===== PROFESSIONAL SERVICE TERMS & CONDITIONS =====

// Accept T&C for creating professional services
router.post('/accept-professional-tc', auth, async (req, res) => {
  try {
    const updated = await prisma.user.updateMany({
      where: { id: req.user.userId },
      data: {
        professionalServiceTCAccepted: true,
        professionalServiceTCAcceptedAt: new Date(),
      },
    });
    if (updated.count === 0) return res.status(404).json({ error: 'User not found' });

    res.json({ message: 'Terms accepted', professionalServiceTCAccepted: true });
  } catch (err) {
    console.error('Accept TC error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Check T&C status
router.get('/professional-tc-status', auth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { professionalServiceTCAccepted: true, professionalServiceTCAcceptedAt: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({
      accepted: user.professionalServiceTCAccepted || false,
      acceptedAt: user.professionalServiceTCAcceptedAt,
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/users/stats - Public stats for homepage
router.get('/stats', async (req, res) => {
  try {
    const userCount = await prisma.user.count();
    const jobCount = await prisma.job.count();
    const serviceCount = await prisma.service.count();

    res.json({
      neighbors: userCount,
      tasksListed: jobCount,
      jobsDone: jobCount,
      services: serviceCount,
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Update my own profile (name, bio, phone, skills, category). Completing the
// profile is an identity trust item, so stars refresh after every save.
// Non-UUID ids fall through to the app-level /status and /location handlers.
router.put('/:id', auth, async (req, res, next) => {
  try {
    if (!isId(req.params.id)) return next();
    if (String(req.params.id) !== String(req.user.userId)) {
      return res.status(403).json({ error: 'You can only update your own profile' });
    }

    const { name, bio, phone, skills, primaryCategory } = req.body;
    const data = {};
    if (typeof name === 'string' && name.trim()) data.name = name.trim().slice(0, 100);
    if (typeof bio === 'string') data.bio = bio.trim().slice(0, 600);
    if (typeof phone === 'string') data.phone = phone.replace(/[\s\-().]/g, '').slice(0, 20);
    if (typeof primaryCategory === 'string') data.primaryCategory = primaryCategory.trim().slice(0, 60);
    if (skills !== undefined) {
      const list = Array.isArray(skills) ? skills : String(skills).split(',');
      data.skills = list.map(s => String(s).trim().slice(0, 40)).filter(Boolean).slice(0, 20);
    }
    // Email changes are deliberately ignored — email is the login identity
    // and is verified separately.

    const user = await prisma.user.update({ where: { id: req.user.userId }, data });
    const trust = await refreshTrust(prisma, req.user.userId).catch(() => null);

    const dto = sanitizeUser(user);
    dto.location = { lat: user.lat, lng: user.lng };
    if (trust) { dto.trustStars = trust.stars; dto.trustLevel = trust.level; }
    res.json(dto);
  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).json({ error: 'Server error updating profile' });
  }
});

module.exports = router;
