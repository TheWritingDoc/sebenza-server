const express = require('express');
const router = express.Router();
const Service = require('../models/Service');
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

// Middleware to verify JWT
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

// Public services endpoint (no auth required for homepage display)
router.get('/public', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 6;
    const category = req.query.category;
    const filter = { available: true, mapVisibility: 'public' };
    if (category) filter.category = category;
    
    const services = await Service.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    
    const publicServices = services.map(s => ({
      id: s._id,
      providerId: s.providerId,
      title: s.title,
      description: s.description,
      category: s.category,
      randAmount: s.randAmount,
      location: s.location,
      images: s.images || [],
      averageRating: s.averageRating || 5,
      completedJobsCount: s.completedJobsCount || 0
    }));
    
    res.json(publicServices);
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
    const services = await Service.find({ available: true, mapVisibility: 'public' });

    // Calculate distance for each service and filter by radius
    const nearbyServices = services.map(service => {
      const serviceLat = service.location?.lat;
      const serviceLng = service.location?.lng;
      
      if (!serviceLat || !serviceLng) return null;

      // Haversine formula to calculate distance
      const R = 6371; // Earth radius in km
      const dLat = (serviceLat - latNum) * Math.PI / 180;
      const dLng = (serviceLng - lngNum) * Math.PI / 180;
      const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(latNum * Math.PI / 180) * Math.cos(serviceLat * Math.PI / 180) *
                Math.sin(dLng/2) * Math.sin(dLng/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      const distance = R * c;

      return {
        ...service.toObject(),
        distance
      };
    }).filter(s => s && s.distance <= radiusNum)
      .sort((a, b) => a.distance - b.distance);

    res.json(nearbyServices);
  } catch (err) {
    console.error('Nearby services error:', err);
    res.status(500).json({ error: 'Server error fetching nearby services' });
  }
});

// Get all services (optionally filter by category)
router.get('/', auth, async (req, res) => {
  try {
    const { category } = req.query;
    const filter = { available: true, mapVisibility: 'public' };
    if (category && category !== 'all') {
      filter.category = category;
    }
    const services = await Service.find(filter).limit(50);
    res.json(services);
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
    const User = require('../models/User');
    const user = await User.findById(req.userId);

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
    const images = serviceImageUrls.map(url => ({
      url,
      caption: '',
      uploadedAt: new Date()
    }));

    const lockOnMap = mapPinLocked === undefined ? true : String(mapPinLocked) !== 'false';
    const requestedVisibility = mapVisibility === 'hidden' ? 'hidden' : 'public';

    const service = new Service({
      providerId: req.userId,
      title,
      description,
      category,
      randAmount: parseFloat(randAmount) || 0,
      location: parsedLocation,
      mapPinLocked: lockOnMap,
      mapVisibility: lockOnMap ? 'public' : requestedVisibility,
      pricingType: pricingType || 'fixed',
      scheduledDate: scheduledDate ? new Date(scheduledDate) : undefined,
      estimatedDuration: estimatedDuration || '',
      tags: parsedTags || [],
      images: serviceImages,
      profileViewFee: Math.min(50, Math.max(0, parseFloat(profileViewFee) || 0)),
      completedJobsCount: 0,
      averageRating: 5
    });

    await service.save();

    const io = req.app.get('io');
    const onlineUsers = req.app.get('onlineUsers');

    // Notify nearby online users about new service
    const svcLat = service.location?.lat;
    const svcLng = service.location?.lng;
    if (io && svcLat != null && svcLng != null) {
      const onlineUserIds = Array.from(onlineUsers.keys());
      const onlineUsersData = await User.find({ _id: { $in: onlineUserIds } }).select('location lat lng');
      const NEARBY_KM = 20;
      for (const u of onlineUsersData) {
        if (String(u._id) === String(req.userId)) continue;
        const ulat = u.lat ?? u.location?.lat;
        const ulng = u.lng ?? u.location?.lng;
        if (ulat == null || ulng == null) continue;
        const dist = getDistanceKm(svcLat, svcLng, ulat, ulng);
        if (dist <= NEARBY_KM) {
          const sid = onlineUsers.get(String(u._id));
          if (sid) {
            io.to(sid).emit('new_service_nearby', {
              serviceId: String(service._id),
              title: service.title,
              lat: svcLat,
              lng: svcLng,
              distanceKm: Math.round(dist * 100) / 100,
              randAmount: service.randAmount || 0
            });
          }
          sendNotification(io, onlineUsers, u._id, {
            type: 'service_nearby',
            title: 'New Service Nearby!',
            message: `"${service.title}" posted ${dist < 1 ? '<1' : Math.round(dist)}km away — R${service.randAmount || 0}`,
            data: { serviceId: service._id }
          });
        }
      }
    }
    
    res.json({ 
      message: 'Service created successfully!', 
      service,
      imagesUploaded: serviceImages.length,
      charged: 0,
      remainingBalance: user.randBalance
    });
  } catch (err) {
    console.error('Create service error:', err);
    res.status(500).json({ error: 'Server error creating service', details: err.message });
  }
});

// Get provider's services
router.get('/my-services', auth, async (req, res) => {
  try {
    const services = await Service.find({ providerId: req.userId })
      .sort({ createdAt: -1 });
    res.json(services);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Update map lock / visibility for provider service
router.patch('/:serviceId/map-lock', auth, async (req, res) => {
  try {
    const service = await Service.findOne({
      _id: req.params.serviceId,
      providerId: req.userId
    });

    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }

    const lockOnMap = req.body?.mapPinLocked !== undefined
      ? String(req.body.mapPinLocked) !== 'false'
      : service.mapPinLocked;

    const requestedVisibility = req.body?.mapVisibility === 'hidden' ? 'hidden' : 'public';

    service.mapPinLocked = lockOnMap;
    service.mapVisibility = lockOnMap ? 'public' : requestedVisibility;

    await service.save();

    res.json({
      message: service.mapPinLocked
        ? 'Service is now locked on the map.'
        : `Service visibility set to ${service.mapVisibility}.`,
      service
    });
  } catch (err) {
    console.error('Map lock update error:', err);
    res.status(500).json({ error: 'Server error updating map lock', details: err.message });
  }
});

// Delete service
router.delete('/:serviceId', auth, async (req, res) => {
  try {
    const service = await Service.findOne({
      _id: req.params.serviceId,
      providerId: req.userId
    });

    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }

    if (service.mapPinLocked) {
      return res.status(400).json({
        error: 'This service is locked on the map. Unlock it first before deleting.'
      });
    }

    await service.deleteOne();

    res.json({ message: 'Service deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Pay to view provider profile
router.post('/pay-profile-view', auth, async (req, res) => {
  try {
    const { serviceId } = req.body;
    const User = require('../models/User');
    
    const service = await Service.findById(serviceId);
    if (!service) return res.status(404).json({ error: 'Service not found' });
    
    const fee = service.profileViewFee || 0;
    if (fee <= 0) {
      return res.json({ paid: true, message: 'Profile view is free' });
    }
    
    const viewer = await User.findById(req.userId);
    const provider = await User.findById(service.providerId);
    
    if (!viewer || !provider) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if already paid
    const alreadyPaid = viewer.paidProfileViews?.some(p => p.serviceId === String(serviceId));
    if (alreadyPaid) {
      return res.json({ paid: true, message: 'Already paid for this profile view' });
    }
    
    // Check balance
    if ((viewer.randBalance || 0) < fee) {
      return res.status(400).json({ 
        error: `Insufficient balance. You need R${fee} for verification. Your balance: R${viewer.randBalance || 0}`
      });
    }
    
    // Process payment — fee goes to Sebenza platform, not the provider
    viewer.randBalance = (viewer.randBalance || 0) - fee;
    
    viewer.paidProfileViews = viewer.paidProfileViews || [];
    viewer.paidProfileViews.push({
      serviceId: String(serviceId),
      providerId: String(service.providerId),
      amount: fee,
      paidAt: new Date()
    });
    
    await viewer.save();
    
    res.json({ 
      paid: true, 
      message: `R${fee} verified successfully. You can now connect.`,
      fee,
      remainingBalance: viewer.randBalance
    });
  } catch (err) {
    console.error('Pay profile view error:', err);
    res.status(500).json({ error: 'Server error processing payment', details: err.message });
  }
});

module.exports = router;






