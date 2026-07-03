const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Service = require('../models/Service');
const jwt = require('jsonwebtoken');
const upload = require('../middleware/upload');
const { uploadFile } = require('../middleware/upload');
const { computeTrust, refreshTrust } = require('../utils/trustScore');

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
    const users = await User.find({ email: { $not: /test@/i } })
      .select('name avatar primaryCategory rating communityStats createdAt')
      .sort({ createdAt: -1 })
      .limit(limit);
    res.json(users);
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

    const users = await User.find({
      'location.coordinates': { $ne: [0, 0] }
    }).select('name avatar primaryCategory rating communityStats location.coordinates createdAt');

    const R = 6371;
    const nearbyUsers = users.map(user => {
      const userLat = user.location?.coordinates?.[1];
      const userLng = user.location?.coordinates?.[0];
      if (!userLat || !userLng) return null;

      const dLat = (userLat - latNum) * Math.PI / 180;
      const dLng = (userLng - lngNum) * Math.PI / 180;
      const a = Math.sin(dLat/2)**2 + Math.cos(latNum*Math.PI/180)*Math.cos(userLat*Math.PI/180)*Math.sin(dLng/2)**2;
      const distance = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

      if (distance > radiusNum) return null;
      const obj = user.toObject();
      // Coarsen public location to ~1km for privacy
      if (obj.location?.coordinates) {
        obj.location.coordinates = [
          Math.round(userLng * 100) / 100,
          Math.round(userLat * 100) / 100
        ];
      }
      obj.distance = Math.round(distance*10)/10;
      return obj;
    }).filter(Boolean);

    nearbyUsers.sort((a,b) => a.distance - b.distance);
    res.json(nearbyUsers.slice(0, 50));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch nearby users' });
  }
});

// Get current user's referral info
router.get('/me/referral', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('referralCode referralCount');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ referralCode: user.referralCode, referralCount: user.referralCount });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get public referrer info by referral code (for invite page)
router.get('/referrer/:code', async (req, res) => {
  try {
    const user = await User.findOne({ referralCode: req.params.code.toUpperCase() }).select('name avatar');
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
    const user = await User.findById(req.user.userId)
      .select('trustDocs workExperience profileImage avatar verified phoneVerified communityStats accountType businessName')
      .lean();
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
    const user = await User.findById(req.params.id)
      .select('trustDocs workExperience profileImage avatar verified phoneVerified communityStats accountType businessName name')
      .lean();
    if (!user) return res.status(404).json({ error: 'User not found' });
    const trust = computeTrust(user);
    res.json({
      stars: trust.stars,
      level: trust.level,
      score: trust.score,
      verified: !!user.verified,
      phoneVerified: !!user.phoneVerified,
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
    await User.findByIdAndUpdate(req.user.userId, {
      $push: {
        trustDocs: {
          docType,
          title: (title || '').toString().slice(0, 120),
          fileUrl,
          status: 'pending',
          uploadedAt: new Date(),
        },
      },
    });
    const trust = await refreshTrust(User, req.user.userId);
    res.json({ message: 'Document uploaded', stars: trust?.stars, level: trust?.level, score: trust?.score });
  } catch (err) {
    console.error('Trust doc upload error:', err);
    res.status(500).json({ error: 'Server error uploading document' });
  }
});

// Add a work-experience entry (no document required — self-declared)
router.post('/work-experience', auth, async (req, res) => {
  try {
    const { title, place, years } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ error: 'Please describe the work you did' });
    await User.findByIdAndUpdate(req.user.userId, {
      $push: {
        workExperience: {
          title: title.toString().slice(0, 160),
          place: (place || '').toString().slice(0, 120),
          years: (years || '').toString().slice(0, 40),
          addedAt: new Date(),
        },
      },
    });
    const trust = await refreshTrust(User, req.user.userId);
    res.json({ message: 'Experience added', stars: trust?.stars, level: trust?.level, score: trust?.score });
  } catch (err) {
    console.error('Work experience error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ===== SAVED SERVICES (BUSINESS CARDS) =====

// Save a service to user's business cards
router.post('/save-service', auth, async (req, res) => {
  try {
    const { serviceId, notes } = req.body;
    if (!serviceId) return res.status(400).json({ error: 'Service ID required' });

    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Check if already saved
    const alreadySaved = user.savedServices?.some(s => s.serviceId?.toString() === serviceId);
    if (alreadySaved) {
      return res.status(400).json({ error: 'Service already saved' });
    }

    user.savedServices = user.savedServices || [];
    user.savedServices.push({ serviceId, notes: notes || '', savedAt: new Date() });
    await user.save();

    res.json({ message: 'Service saved to your Business Cards', savedServices: user.savedServices });
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

    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.savedServices = (user.savedServices || []).filter(
      s => s.serviceId?.toString() !== serviceId
    );
    await user.save();

    res.json({ message: 'Service removed', savedServices: user.savedServices });
  } catch (err) {
    console.error('Unsave service error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get user's saved services with full service data populated
router.get('/saved-services', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId)
      .populate({
        path: 'savedServices.serviceId',
        model: 'Service',
        populate: { path: 'providerId', select: 'name avatar phone' }
      });

    if (!user) return res.status(404).json({ error: 'User not found' });

    const enriched = (user.savedServices || []).map(s => ({
      ...s.toObject(),
      service: s.serviceId
    })).filter(s => s.service); // filter out deleted services

    res.json(enriched);
  } catch (err) {
    console.error('Saved services error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Check if user has saved a specific service
router.get('/has-saved/:serviceId', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('savedServices');
    const hasSaved = user?.savedServices?.some(s => s.serviceId?.toString() === req.params.serviceId);
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

    const service = await Service.findById(serviceId).populate('providerId', 'name');
    if (!service) return res.status(404).json({ error: 'Service not found' });

    const sender = await User.findById(req.user.userId).select('name');
    const recipient = await User.findById(recipientId);
    if (!recipient) return res.status(404).json({ error: 'Recipient not found' });

    // Auto-save to recipient's business cards (they can remove if they want)
    recipient.savedServices = recipient.savedServices || [];
    const alreadySaved = recipient.savedServices.some(s => s.serviceId?.toString() === serviceId);
    if (!alreadySaved) {
      recipient.savedServices.push({
        serviceId,
        notes: `Recommended by ${sender.name}${message ? ': ' + message : ''}`,
        savedAt: new Date()
      });
      await recipient.save();
    }

    // Also store a recommendation record on sender for tracking
    const senderUser = await User.findById(req.user.userId);
    senderUser.recommendationsSent = senderUser.recommendationsSent || [];
    senderUser.recommendationsSent.push({
      serviceId,
      recipientId,
      message: message || '',
      sentAt: new Date()
    });
    await senderUser.save();

    res.json({
      message: `Service recommended to ${recipient.name}. It has been saved to their Business Cards.`,
      service: { title: service.title, provider: service.providerId?.name }
    });
  } catch (err) {
    console.error('Recommend error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get users the current user can recommend to (contacts / nearby / interacted with)
router.get('/contacts', auth, async (req, res) => {
  try {
    const Transaction = require('../models/Transaction');
    const userId = req.user.userId;

    // Find users they've had transactions with
    const transactions = await Transaction.find({
      $or: [{ requesterId: userId }, { providerId: userId }]
    }).select('requesterId providerId');

    const contactIds = new Set();
    transactions.forEach(t => {
      if (t.requesterId?.toString() !== userId) contactIds.add(t.requesterId.toString());
      if (t.providerId?.toString() !== userId) contactIds.add(t.providerId.toString());
    });

    // Also include nearby users (exclude self and test accounts)
    const user = await User.findById(userId).select('location');
    const nearbyUsers = await User.find({
      _id: { $ne: userId, $nin: Array.from(contactIds) },
      email: { $not: /test@/i },
      'location.lat': { $ne: 0 }
    }).select('name avatar location primaryCategory').limit(20);

    const contacts = await User.find({
      _id: { $in: Array.from(contactIds) }
    }).select('name avatar location primaryCategory');

    res.json({ contacts, nearby: nearbyUsers });
  } catch (err) {
    console.error('Contacts error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ===== PROFESSIONAL SERVICE TERMS & CONDITIONS =====

// Accept T&C for creating professional services
router.post('/accept-professional-tc', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.professionalServiceTCAccepted = true;
    user.professionalServiceTCAcceptedAt = new Date();
    await user.save();

    res.json({ message: 'Terms accepted', professionalServiceTCAccepted: true });
  } catch (err) {
    console.error('Accept TC error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Check T&C status
router.get('/professional-tc-status', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('professionalServiceTCAccepted professionalServiceTCAcceptedAt');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({
      accepted: user.professionalServiceTCAccepted || false,
      acceptedAt: user.professionalServiceTCAcceptedAt
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/users/stats - Public stats for homepage
router.get('/stats', async (req, res) => {
  try {
    const userCount = await User.countDocuments();
    const jobCount = await require('../models/Job').countDocuments();
    const serviceCount = await require('../models/Service').countDocuments();
    
    res.json({
      neighbors: userCount,
      tasksListed: jobCount,
      jobsDone: jobCount,
      services: serviceCount
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

module.exports = router;
