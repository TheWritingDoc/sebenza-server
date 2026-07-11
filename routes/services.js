const express = require('express');
const router = express.Router();
const { prisma } = require('../db');
const { toDTO, sanitizeUser, isId } = require('../utils/dto');
const upload = require('../middleware/upload');
const { uploadFiles } = require('../middleware/upload');
const jwt = require('jsonwebtoken');
const { sendNotification } = require('../utils/notifications');

// Haversine distance helper (km)
function getDistanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Mongo-era clients expect service.location = { lat, lng }
const serviceOut = (s) => {
  if (!s) return s;
  return { ...s, location: { lat: s.lat, lng: s.lng } };
};

// Middleware to verify JWT
const { auth } = require('../middleware/authToken');

// Public services endpoint (no auth required for homepage display)
router.get('/public', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 6;
    const category = req.query.category;
    const where = { available: true, mapVisibility: 'public' };
    if (category) where.category = category;

    const services = await prisma.service.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit
    });

    const publicServices = services.map(s => ({
      id: s.id,
      providerId: s.providerId,
      title: s.title,
      description: s.description,
      category: s.category,
      randAmount: s.randAmount,
      location: { lat: s.lat, lng: s.lng },
      images: s.images || [],
      averageRating: Number(s.averageRating) || 5,
      completedJobsCount: s.completedJobsCount || 0
    }));

    res.json(toDTO(publicServices));
  } catch (err) {
    console.error('Public services error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get nearby services within radius
router.get('/nearby', auth, async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    let isAuthenticated = false;
    if (token) {
      try {
        jwt.verify(token, process.env.JWT_SECRET);
        isAuthenticated = true;
      } catch (e) { /* invalid token */ }
    }

    const { lat, lng, radius } = req.query;
    // FREE users: 1km max, Authenticated: 50km max
    const maxRadius = isAuthenticated ? 50 : 1;
    const requestedRadius = parseFloat(radius) || maxRadius;
    const radiusNum = Math.min(requestedRadius, maxRadius);

    if (!lat || !lng) {
      return res.status(400).json({ error: 'Latitude and longitude required' });
    }

    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);

    // Find all services and calculate distance
    const services = await prisma.service.findMany({ where: { available: true, mapVisibility: 'public' } });

    // Calculate distance for each service and filter by radius
    const nearbyServices = services.map(service => {
      const serviceLat = service.lat;
      const serviceLng = service.lng;

      if (!serviceLat || !serviceLng) return null;

      const distance = getDistanceKm(latNum, lngNum, serviceLat, serviceLng);

      return {
        ...serviceOut(service),
        distance
      };
    }).filter(s => s && s.distance <= radiusNum)
      .sort((a, b) => a.distance - b.distance);

    res.json(toDTO(nearbyServices));
  } catch (err) {
    console.error('Nearby services error:', err);
    res.status(500).json({ error: 'Server error fetching nearby services' });
  }
});

// Get all services (optionally filter by category)
router.get('/', auth, async (req, res) => {
  try {
    const { category } = req.query;
    const where = { available: true, mapVisibility: 'public' };
    if (category && category !== 'all') {
      where.category = category;
    }
    const services = await prisma.service.findMany({ where, take: 50 });
    res.json(toDTO(services.map(serviceOut)));
  } catch (err) {
    console.error('Get services error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create Service with images
router.post('/create', auth, upload.array('images', 10), async (req, res) => {
  try {
    const { title, description, category, randAmount, location, pricingType, scheduledDate, estimatedDuration, tags, profileViewFee, mapPinLocked, mapVisibility } = req.body;

    // All services are free to post
    const user = await prisma.user.findUnique({ where: { id: req.userId } });

    // Verify user has accepted professional service T&C
    if (!user.professionalServiceTCAccepted) {
      return res.status(403).json({ error: 'You must accept the Professional Service Terms & Conditions before creating a service.', code: 'TC_NOT_ACCEPTED' });
    }

    // Parse location if it's a string
    let parsedLocation = location;
    if (typeof location === 'string') {
      try {
        parsedLocation = JSON.parse(location);
      } catch (e) {
        return res.status(400).json({ error: 'Invalid location format' });
      }
    }

    // Parse tags if string
    let parsedTags = tags;
    if (typeof tags === 'string') {
      try { parsedTags = JSON.parse(tags); } catch (e) { parsedTags = []; }
    }

    // Handle uploaded images
    const serviceImageUrls = req.files && req.files.length > 0 ? await uploadFiles(req.files, 'services') : [];
    const serviceImages = serviceImageUrls.map(url => ({
      url,
      caption: '',
      uploadedAt: new Date()
    }));

    const lockOnMap = mapPinLocked === undefined ? true : String(mapPinLocked) !== 'false';
    const requestedVisibility = mapVisibility === 'hidden' ? 'hidden' : 'public';

    const service = await prisma.service.create({
      data: {
        providerId: req.userId,
        title,
        description,
        category,
        randAmount: parseFloat(randAmount) || 0,
        lat: parseFloat(parsedLocation?.lat) || 0,
        lng: parseFloat(parsedLocation?.lng) || 0,
        mapPinLocked: lockOnMap,
        mapVisibility: lockOnMap ? 'public' : requestedVisibility,
        pricingType: pricingType || 'fixed',
        scheduledDate: scheduledDate ? new Date(scheduledDate) : null,
        estimatedDuration: estimatedDuration || '',
        tags: parsedTags || [],
        images: serviceImages,
        profileViewFee: Math.min(50, Math.max(0, parseFloat(profileViewFee) || 0)),
        completedJobsCount: 0,
        averageRating: 5,
        ratingBreakdown: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
      }
    });

    const io = req.app.get('io');
    const onlineUsers = req.app.get('onlineUsers');

    // Notify nearby online users about new service
    const svcLat = service.lat;
    const svcLng = service.lng;
    if (io && svcLat != null && svcLng != null) {
      const onlineUserIds = Array.from(onlineUsers.keys()).filter(isId);
      const onlineUsersData = await prisma.user.findMany({
        where: { id: { in: onlineUserIds } },
        select: { id: true, lat: true, lng: true }
      });
      const NEARBY_KM = 20;
      for (const u of onlineUsersData) {
        if (String(u.id) === String(req.userId)) continue;
        const ulat = u.lat;
        const ulng = u.lng;
        if (ulat == null || ulng == null) continue;
        const dist = getDistanceKm(svcLat, svcLng, ulat, ulng);
        if (dist <= NEARBY_KM) {
          const sid = onlineUsers.get(String(u.id));
          if (sid) {
            io.to(sid).emit('new_service_nearby', {
              serviceId: String(service.id),
              title: service.title,
              lat: svcLat,
              lng: svcLng,
              distanceKm: Math.round(dist * 100) / 100,
              randAmount: Number(service.randAmount) || 0
            });
          }
          sendNotification(io, onlineUsers, u.id, {
            type: 'service_nearby',
            title: 'New Service Nearby!',
            message: `"${service.title}" posted ${dist < 1 ? '<1' : Math.round(dist)}km away — R${Number(service.randAmount) || 0}`,
            data: { serviceId: service.id }
          });
        }
      }
    }

    res.json({
      message: 'Service created successfully!',
      service: toDTO(serviceOut(service)),
      imagesUploaded: serviceImages.length,
      charged: 0,
      remainingBalance: Number(user.randBalance)
    });
  } catch (err) {
    console.error('Create service error:', err);
    res.status(500).json({ error: 'Server error creating service', ...(process.env.NODE_ENV !== 'production' ? { details: err.message } : {}) });
  }
});

// Get provider's services
router.get('/my-services', auth, async (req, res) => {
  try {
    const services = await prisma.service.findMany({
      where: { providerId: req.userId },
      orderBy: { createdAt: 'desc' }
    });
    res.json(toDTO(services.map(serviceOut)));
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Update map lock / visibility for provider service
router.patch('/:serviceId/map-lock', auth, async (req, res) => {
  try {
    const service = isId(req.params.serviceId) ? await prisma.service.findFirst({
      where: {
        id: req.params.serviceId,
        providerId: req.userId
      }
    }) : null;

    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }

    const lockOnMap = req.body?.mapPinLocked !== undefined
      ? String(req.body.mapPinLocked) !== 'false'
      : service.mapPinLocked;

    const requestedVisibility = req.body?.mapVisibility === 'hidden' ? 'hidden' : 'public';

    const updated = await prisma.service.update({
      where: { id: service.id },
      data: {
        mapPinLocked: lockOnMap,
        mapVisibility: lockOnMap ? 'public' : requestedVisibility
      }
    });

    res.json({
      message: updated.mapPinLocked
        ? 'Service is now locked on the map.'
        : `Service visibility set to ${updated.mapVisibility}.`,
      service: toDTO(serviceOut(updated))
    });
  } catch (err) {
    console.error('Map lock update error:', err);
    res.status(500).json({ error: 'Server error updating map lock', ...(process.env.NODE_ENV !== 'production' ? { details: err.message } : {}) });
  }
});

// Delete service
router.delete('/:serviceId', auth, async (req, res) => {
  try {
    const service = isId(req.params.serviceId) ? await prisma.service.findFirst({
      where: {
        id: req.params.serviceId,
        providerId: req.userId
      }
    }) : null;

    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }

    if (service.mapPinLocked) {
      return res.status(400).json({
        error: 'This service is locked on the map. Unlock it first before deleting.'
      });
    }

    await prisma.service.delete({ where: { id: service.id } });

    res.json({ message: 'Service deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Pay to view provider profile
router.post('/pay-profile-view', auth, async (req, res) => {
  try {
    const { serviceId } = req.body;

    const service = isId(serviceId)
      ? await prisma.service.findUnique({ where: { id: serviceId } })
      : null;
    if (!service) return res.status(404).json({ error: 'Service not found' });

    const fee = Number(service.profileViewFee) || 0;
    if (fee <= 0) {
      return res.json({ paid: true, message: 'Profile view is free' });
    }

    const viewer = await prisma.user.findUnique({ where: { id: req.userId } });
    const provider = await prisma.user.findUnique({ where: { id: service.providerId } });

    if (!viewer || !provider) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if already paid
    const paidProfileViews = Array.isArray(viewer.paidProfileViews) ? viewer.paidProfileViews : [];
    const alreadyPaid = paidProfileViews.some(p => p.serviceId === String(serviceId));
    if (alreadyPaid) {
      return res.json({ paid: true, message: 'Already paid for this profile view' });
    }

    // Check balance
    if (Number(viewer.randBalance || 0) < fee) {
      return res.status(400).json({
        error: `Insufficient balance. You need R${fee} for verification. Your balance: R${Number(viewer.randBalance || 0)}`
      });
    }

    // Process payment — fee goes to Sebenza platform, not the provider
    const updatedViewer = await prisma.user.update({
      where: { id: req.userId },
      data: {
        randBalance: { decrement: fee },
        paidProfileViews: [
          ...paidProfileViews,
          {
            serviceId: String(serviceId),
            providerId: String(service.providerId),
            amount: fee,
            paidAt: new Date()
          }
        ]
      }
    });

    res.json({
      paid: true,
      message: `R${fee} verified successfully. You can now connect.`,
      fee,
      remainingBalance: Number(updatedViewer.randBalance)
    });
  } catch (err) {
    console.error('Pay profile view error:', err);
    res.status(500).json({ error: 'Server error processing payment', ...(process.env.NODE_ENV !== 'production' ? { details: err.message } : {}) });
  }
});

module.exports = router;
