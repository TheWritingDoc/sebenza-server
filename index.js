const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const csrf = require('csurf');
const { body, validationResult } = require('express-validator');

require('dotenv').config();

const upload = require('./middleware/upload');

// Import currency configuration
const currency = require('./config/currency');

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// Flag to track MongoDB connection status
let useMongoDB = true;
let mongoConnected = false;



// In-memory storage for demo mode

const memStorage = {

  users: [],

  services: [],

  transactions: [],

  notifications: [],

  userIdCounter: 1,

  serviceIdCounter: 1,

  transactionIdCounter: 1

};



// Security middleware
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// Rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many auth attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false
});

// General API rate limiting
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please slow down' }
});

app.use('/api/', apiLimiter);

// CORS configuration
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (origin.includes('localhost') || origin.includes('ngrok-free.dev') || origin.includes('ngrok.io')) {
      return callback(null, true);
    }
    callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token']
};

// Middleware
app.use(cors(corsOptions));
app.use(cookieParser());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// CSRF protection for state-changing routes.
// In production (HTTPS) we need SameSite=None;Secure so the APK / cross-origin
// clients can send the cookie. Over plain HTTP (local/dev) a Secure cookie is
// rejected by the browser, which silently breaks login — so fall back to Lax.
const isProd = process.env.NODE_ENV === 'production';
const csrfProtection = csrf({
  cookie: {
    httpOnly: true,
    sameSite: isProd ? 'none' : 'lax',
    secure: isProd
  }
});

// Apply CSRF to state-changing routes
app.use('/api/register', csrfProtection);
app.use('/api/login', csrfProtection);
app.use('/api/jobs', csrfProtection);
app.use('/api/services', csrfProtection);
app.use('/api/transactions', csrfProtection);
app.use('/api/users/profile-image', csrfProtection);

// CSRF token endpoint
app.get('/api/csrf-token', csrfProtection, (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

// Serve uploads from project root
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// Serve APK downloads with correct MIME type
app.use('/downloads', express.static(path.join(__dirname, 'downloads'), {
  setHeaders: (res, path) => {
    if (path.endsWith('.apk')) {
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    }
  }
}));

// Serve static files from React build
app.use(express.static(path.join(__dirname, '../client/build_v2')));

// MongoDB Connection with retry logic
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/gshop';

const connectWithRetry = async (retries = 5, delay = 5000) => {
  for (let i = 0; i < retries; i++) {
    try {
      await mongoose.connect(MONGODB_URI);
      console.log('Connected to MongoDB');
      mongoConnected = true;
      return true;
    } catch (err) {
      console.error(`MongoDB connection attempt ${i + 1} failed:`, err.message);
      if (i < retries - 1) {
        console.log(`Retrying in ${delay / 1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw new Error('Failed to connect to MongoDB after multiple attempts');
};

connectWithRetry()
  .then(() => {
    mongoConnected = true;
  })
  .catch(err => {
    console.error('MongoDB connection failed:', err.message);
  });



// Import Models (only use if MongoDB is connected)

let User, Service, Transaction, Verification, SMSVerification, Message, Review, Job;



if (useMongoDB) {

  User = require('./models/User');

  Service = require('./models/Service');

  Transaction = require('./models/Transaction');

  Verification = require('./models/Verification');

  SMSVerification = require('./models/SMSVerification');

  Message = require('./models/Message');
  Review = require('./models/Review');
  Job = require('./models/Job');

}



// Import Routes

const verificationRoutes = require('./routes/verification');

const smsRoutes = require('./routes/sms');

const transactionRoutes = require('./routes/transactions');

const serviceRoutes = require('./routes/services');
const userRoutes = require('./routes/users');
const messageRoutes = require('./routes/messages');
const reviewRoutes = require('./routes/reviews');
const jobRoutes = require('./routes/jobs');



// API Versioning - v1 routes
const API_VERSION = '/api/v1';

// Use Routes only if MongoDB is connected
if (useMongoDB) {
  // Legacy routes (backward compatible)
  app.use('/api/verification', verificationRoutes);
  app.use('/api/sms', smsRoutes);
  app.use('/api/transactions', transactionRoutes);
  app.use('/api/services', serviceRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/messages', messageRoutes);
  app.use('/api/reviews', reviewRoutes);
  app.use('/api/jobs', jobRoutes);
  app.use('/api/notifications', require('./routes/notifications'));

  // Versioned routes (v1)
  app.use(`${API_VERSION}/verification`, verificationRoutes);
  app.use(`${API_VERSION}/sms`, smsRoutes);
  app.use(`${API_VERSION}/transactions`, transactionRoutes);
  app.use(`${API_VERSION}/services`, serviceRoutes);
  app.use(`${API_VERSION}/users`, userRoutes);
  app.use(`${API_VERSION}/messages`, messageRoutes);
  app.use(`${API_VERSION}/reviews`, reviewRoutes);
  app.use(`${API_VERSION}/jobs`, jobRoutes);
  app.use(`${API_VERSION}/notifications`, require('./routes/notifications'));

  // DEBUG: test endpoint to verify /api/jobs routing is working
  app.all('/api/jobs/:id/qr-test', (req, res) => {
    res.json({ ok: true, method: req.method, id: req.params.id, message: 'QR route test OK' });
  });

}





// JWT Middleware
const auth = (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.split(' ')[1];
  if (!token || token === 'null' || token === 'undefined') {
    return res.status(401).json({ error: 'No token provided' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
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



// ==================== DEMO MODE ENDPOINTS ====================

// These work without MongoDB using in-memory storage



// Helper: generate unique referral code
function generateReferralCode(name) {
  const clean = (name || 'user').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 4);
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${clean}${random}`;
}

// MongoDB: Register with validation
app.post('/api/register', authLimiter, [
  body('name').trim().isLength({ min: 2, max: 100 }).withMessage('Name must be 2-100 characters'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('phone').optional().trim().isMobilePhone().withMessage('Valid phone number required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    const { name, email, phone, password, location, skills, primaryCategory, ref } = req.body;
    
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Convert { lat, lng } to GeoJSON format
    let geoLocation = { 
      type: 'Point', 
      coordinates: [0, 0],
      lat: 0,
      lng: 0
    };
    
    if (location && location.lat != null && location.lng != null) {
      geoLocation = {
        type: 'Point',
        coordinates: [location.lng, location.lat],  // GeoJSON: [lng, lat]
        lat: location.lat,
        lng: location.lng
      };
    }

    // Handle referral
    let referredBy = null;
    if (ref) {
      const referrer = await User.findOne({ referralCode: ref.toUpperCase() });
      if (referrer) {
        referredBy = referrer._id;
        referrer.referralCount = (referrer.referralCount || 0) + 1;
        await referrer.save();
      }
    }

    // Generate unique referral code
    let referralCode = generateReferralCode(name);
    let codeExists = await User.findOne({ referralCode });
    while (codeExists) {
      referralCode = generateReferralCode(name);
      codeExists = await User.findOne({ referralCode });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({
      name,
      email,
      phone: phone || '',
      password: hashedPassword,
      location: geoLocation,
      skills: skills?.length > 0 ? skills : ['General work/Helper'],
      primaryCategory: primaryCategory || 'General work/Helper',
      credits: 1000,
      randBalance: 1000,
      escrowRand: 0,
      totalEarnedRand: 0,
      rating: 0,
      verified: false,
      phoneVerified: false,
      referralCode,
      referredBy
    });

    const token = jwt.sign({ userId: user._id.toString() }, JWT_SECRET, { expiresIn: '30d' });

    res.json({
      token,
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        phone: user.phone,
        credits: user.credits,
        randBalance: user.randBalance,
        escrowRand: user.escrowRand,
        totalEarnedRand: user.totalEarnedRand,
        skills: user.skills,
        primaryCategory: user.primaryCategory,
        location: { lat: user.location.lat, lng: user.location.lng },
        verified: user.verified,
        phoneVerified: user.phoneVerified,
        referralCode: user.referralCode,
        referralCount: user.referralCount
      }
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});// MongoDB: Login with validation
app.post('/api/login', authLimiter, [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 1 }).withMessage('Password required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    const { email, password } = req.body;
    
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    // Check if account is locked
    if (user.lockUntil && user.lockUntil > Date.now()) {
      return res.status(423).json({ 
        error: 'Account temporarily locked due to too many failed attempts. Please try again later.' 
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      // Increment login attempts
      user.loginAttempts = (user.loginAttempts || 0) + 1;
      
      // Lock account after 5 failed attempts for 30 minutes
      if (user.loginAttempts >= 5) {
        user.lockUntil = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
        user.loginAttempts = 0;
        await user.save();
        return res.status(423).json({ 
          error: 'Account locked for 30 minutes due to too many failed login attempts.' 
        });
      }
      
      await user.save();
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    // Update login tracking
    user.lastLoginAt = new Date();
    user.loginAttempts = 0;
    await user.save();

    const token = jwt.sign({ userId: user._id.toString() }, JWT_SECRET, { expiresIn: '30d' });

    res.json({
      token,
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        phone: user.phone,
        randBalance: user.randBalance,
        escrowRand: user.escrowRand,
        totalEarnedRand: user.totalEarnedRand,
        skills: user.skills,
        primaryCategory: user.primaryCategory,
        freeServiceUsed: user.freeServiceUsed,
        verified: user.verified,
        phoneVerified: user.phoneVerified,
        emailVerified: user.emailVerified || false
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});



// MongoDB: Get Profile
app.get('/api/profile', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const userObj = user.toObject();
    res.json({
      ...userObj,
      credits: userObj.credits || 1000,
      formattedBalance: 'R' + ((userObj.credits || 1000) / 100).toFixed(2),
      location: userObj.location ? { 
        lat: userObj.location.lat || userObj.location.coordinates?.[1], 
        lng: userObj.location.lng || userObj.location.coordinates?.[0] 
      } : null,
      isOnline: userObj.isOnline,
      showOnlineStatus: userObj.showOnlineStatus,
      lastActive: userObj.lastActive,
      profileImage: userObj.profileImage,
      primaryCategory: userObj.primaryCategory,
      freeServiceUsed: userObj.freeServiceUsed
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});

// Upload profile image

app.post('/api/users/profile-image', auth, upload.single('profileImage'), async (req, res) => {

  try {

    if (!req.file) {

      return res.status(400).json({ error: 'No image uploaded' });

    }

    

    const imageUrl = `/uploads/profiles/${req.file.filename}`;

    

    // Update user in DB
    const user = await User.findByIdAndUpdate(
      req.userId,
      { profileImage: imageUrl },
      { new: true }
    );

    

    res.json({
      message: 'Profile image uploaded successfully',
      imageUrl: imageUrl,
      user: { profileImage: imageUrl }
    });

  } catch (err) {

    console.error('Profile image upload error:', err);

    res.status(500).json({ error: 'Server error uploading image' });

  }

});





// Public profile view (no auth required)
app.get('/api/users/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('-password -bankAccount -email -phone')
      .lean();
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    // Respect privacy setting
    if (user.showOnlineStatus === false) {
      user.isOnline = false;
      user.lastActive = undefined;
    }
    
    const services = await Service.find({ providerId: req.params.id, available: true })
      .select('title description category randAmount images location averageRating completedJobsCount totalReviews pricingType tags estimatedDuration')
      .lean();

    // Fetch recent visible reviews
    const reviews = await Review.find({ revieweeId: req.params.id, isVisible: true })
      .populate('reviewerId', 'name avatar')
      .populate('serviceId', 'title category')
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();
    
    res.json({ ...user, services, reviews });
  } catch (err) {
    console.error('Public profile error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update user online status
app.put('/api/users/status', auth, async (req, res) => {
  try {
    const { isOnline, showOnlineStatus } = req.body;
    const update = { lastActive: new Date() };
    if (typeof isOnline === 'boolean') update.isOnline = isOnline;
    if (typeof showOnlineStatus === 'boolean') update.showOnlineStatus = showOnlineStatus;
    
    const user = await User.findByIdAndUpdate(
      req.userId,
      update,
      { new: true }
    ).select('-password');
    res.json({ 
      message: 'Status updated', 
      isOnline: user.isOnline, 
      showOnlineStatus: user.showOnlineStatus,
      lastActive: user.lastActive 
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Update user location
app.put('/api/users/location', auth, async (req, res) => {
  try {
    const { lat, lng } = req.body;
    
    if (lat == null || lng == null) {
      return res.status(400).json({ error: 'Latitude and longitude required' });
    }
    
    if (mongoConnected && User) {
      const user = await User.findByIdAndUpdate(
        req.userId,
        { 
          location: {
            type: 'Point',
            coordinates: [lng, lat],
            lat: lat,
            lng: lng
          }
        },
        { new: true }
      );
      res.json({ message: 'Location updated', location: { lat, lng } });
    } else {
      // In-memory fallback
      const user = memStorage.users.find(u => u._id === req.userId);
      if (user) {
        user.location = { type: 'Point', coordinates: [lng, lat], lat, lng };
        res.json({ message: 'Location updated', location: { lat, lng } });
      } else {
        res.status(404).json({ error: 'User not found' });
      }
    }
  } catch (err) {
    console.error('Location update error:', err);
    res.status(500).json({ error: 'Server error updating location' });
  }
});

// Health check

app.get('/api/health', async (req, res) => {

  res.json({ 

    status: 'ok', 

    mode: mongoConnected ? 'MONGODB' : 'DEMO',

    features: ['auth', 'verification', 'sms', 'escrow', 'transactions', 'rand-conversion', 'image-upload'],

    currency: {

      code: currency.CURRENCY_CODE,

      symbol: currency.CURRENCY_SYMBOL,

      creditToRandRate: currency.CREDIT_TO_RAND_RATE

    },

    stats: {

      users: mongoConnected ? await User.countDocuments().catch(() => 0) : memStorage.users.length,

      services: mongoConnected ? await Service.countDocuments().catch(() => 0) : memStorage.services.length,

      transactions: mongoConnected ? await Transaction.countDocuments().catch(() => 0) : memStorage.transactions.length

    },

    timestamp: new Date().toISOString()

  });

});




// DEBUG: verify jobs router is reachable
app.all('/api/jobs-debug/:id/qr-test', (req, res) => {
  res.json({ ok: true, method: req.method, id: req.params.id, ts: Date.now() });
});

// Public services endpoint (no auth required for homepage display)
app.get('/api/services/public', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 6;
    const category = req.query.category;
    let services = [];
    
    const query = { available: true };
    if (category) query.category = category;
    
    if (mongoConnected) {
      services = await Service.find(query)
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();
    } else {
      services = memStorage.services.filter(s => !category || s.category === category).slice(0, limit);
    }
    
    const publicServices = services.map(s => ({
      id: s._id || s.id,
      providerId: s.providerId || s.provider?._id || s.provider,
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
// Enhanced health endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    mode: mongoConnected ? 'MONGODB' : 'DEMO',
    time: new Date().toISOString(),
    version: '1.0.0',
    uptime: process.uptime()
  });
});

// Versioned health endpoint
app.get('/api/v1/health', (req, res) => {
  res.json({
    status: 'ok',
    mode: mongoConnected ? 'MONGODB' : 'DEMO',
    time: new Date().toISOString(),
    version: '1.0.0',
    uptime: process.uptime()
  });
});

// Fallback for any unmatched API routes — return JSON 404 instead of HTML
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found', path: req.path, method: req.method });
});

// Catch-all: serve React app for any non-API route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/build_v2', 'index.html'));
});

// Error handling
app.use((err, req, res, next) => {
  // Multer file upload errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large. Maximum upload size is 15MB per photo.' });
  }
  if (err.code === 'LIMIT_FILE_COUNT') {
    return res.status(413).json({ error: 'Too many files. Maximum 10 files per upload.' });
  }
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ error: 'Unexpected file field.', details: err.message });
  }
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: 'Upload error', details: err.message });
  }
  // File type validation errors
  if (err.message && err.message.includes('Invalid file')) {
    return res.status(400).json({ error: err.message });
  }
  // CSRF token failures — return 403 so clients can refresh the token and retry
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).json({ error: 'Invalid CSRF token', details: 'csrf' });
  }
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!', details: err.message });
});



// Log all registered routes on startup
function logRoutes() {
  console.log('\n=== REGISTERED API ROUTES ===');
  app._router.stack.forEach((middleware) => {
    if (middleware.route) {
      const methods = Object.keys(middleware.route.methods).map(m => m.toUpperCase()).join(', ');
      console.log(`  ${methods} ${middleware.route.path}`);
    } else if (middleware.name === 'router') {
      const basePath = middleware.regexp.toString().replace('/^\\', '').replace('\\/?(?=\/|$)/i', '').replace('\\\\', '/');
      middleware.handle.stack.forEach((handler) => {
        if (handler.route) {
          const methods = Object.keys(handler.route.methods).map(m => m.toUpperCase()).join(', ');
          const path = basePath + handler.route.path;
          console.log(`  ${methods} ${path}`);
        }
      });
    }
  });
  console.log('==============================\n');
}


const httpServer = http.createServer(app);



const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (origin.includes('localhost') || origin.includes('ngrok-free.dev') || origin.includes('ngrok.io')) {
        return callback(null, true);
      }
      callback(null, true);
    },
    methods: ['GET', 'POST'],
    credentials: true
  }
});



// Track online users
const onlineUsers = new Map();

// Track job location sharing for device handshake
const jobLocations = new Map(); // jobId -> { posterId, providerId, locations: { userId: { lat, lng, updatedAt } } }
const PROXIMITY_THRESHOLD_KM = 0.1; // 100 meters

function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

app.set('io', io);
app.set('onlineUsers', onlineUsers);

io.on('connection', (socket) => {

  console.log('Client connected:', socket.id);

  socket.on('register', (userId) => {
    onlineUsers.set(String(userId), socket.id);
    socket.userId = String(userId);
  });

  socket.on('user_online', async (userId) => {
    onlineUsers.set(userId, socket.id);
    socket.userId = userId;
    if (mongoConnected && User) {
      try {
        await User.findByIdAndUpdate(userId, { isOnline: true, lastActive: new Date() });
      } catch (err) {
        console.error('user_online DB error:', err.message);
      }
    }
    socket.broadcast.emit('user_status_changed', { userId, isOnline: true });
  });
  
  socket.on('user_away', async (userId) => {
    if (mongoConnected && User) {
      try {
        await User.findByIdAndUpdate(userId, { isOnline: false, lastActive: new Date() });
      } catch (err) {
        console.error('user_away DB error:', err.message);
      }
    }
    socket.broadcast.emit('user_status_changed', { userId, isOnline: false });
  });
  
  socket.on('join_chat', (transactionId) => {
    socket.join(`chat_${transactionId}`);
  });
  
  socket.on('send_message', async (data) => {
    const { transactionId, senderId, receiverId, text, type, offerAmount } = data;
    let savedMessage = null;
    if (mongoConnected && Message) {
      const message = new Message({
        transactionId,
        senderId,
        receiverId,
        text,
        type: type || 'text',
        offerAmount
      });
      savedMessage = await message.save();
    }
    const msgPayload = {
      _id: savedMessage?._id?.toString(),
      transactionId,
      senderId: senderId?.toString ? senderId.toString() : String(senderId),
      receiverId: receiverId?.toString ? receiverId.toString() : String(receiverId),
      text,
      type: type || 'text',
      offerAmount,
      createdAt: savedMessage?.createdAt?.toISOString() || new Date().toISOString()
    };
    io.to(`chat_${transactionId}`).emit('new_message', msgPayload);
    const receiverSocketId = onlineUsers.get(String(receiverId));
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('chat_notification', {
        transactionId,
        senderId: String(senderId),
        text: text.substring(0, 50)
      });
    }
  });
  
  socket.on('join_job_room', async ({ jobId, userId }) => {
    const room = `job_${jobId}`;
    socket.join(room);
    socket.jobRoom = room;
    console.log(`User ${userId} joined job room ${room}`);

    // Cache job data on first join to avoid DB queries on every GPS tick
    if (mongoConnected && Job && !jobLocations.has(jobId)) {
      try {
        const job = await Job.findById(jobId)
          .select('posterId status location acceptedApplicationId applications')
          .lean();
        if (job) {
          const acceptedApp = job.applications?.find(
            a => String(a._id) === String(job.acceptedApplicationId)
          );
          jobLocations.set(jobId, {
            locations: {},
            nearbyNotified: false,
            jobData: {
              posterId: String(job.posterId),
              providerId: acceptedApp ? String(acceptedApp.applicantId) : null,
              status: job.status,
              lat: job.location?.lat,
              lng: job.location?.lng,
              cachedAt: Date.now()
            }
          });
        }
      } catch (err) {
        console.error('Job cache error on join:', err);
      }
    }
  });

  socket.on('leave_job_room', ({ jobId }) => {
    const room = `job_${jobId}`;
    socket.leave(room);
    socket.jobRoom = null;
    console.log(`User left job room ${room}`);

    // Clean up cache if room is empty
    const roomSockets = io.sockets.adapter.rooms.get(room);
    if (!roomSockets || roomSockets.size === 0) {
      jobLocations.delete(jobId);
      console.log(`Cleared job cache for ${room} (room empty)`);
    }
  });

  socket.on('share_location', async ({ jobId, lat, lng }) => {
    if (!socket.userId || !jobId || lat == null || lng == null) return;
    const userId = String(socket.userId);

    // Initialize job tracking
    if (!jobLocations.has(jobId)) {
      jobLocations.set(jobId, { locations: {}, nearbyNotified: false });
    }
    const jobTrack = jobLocations.get(jobId);
    jobTrack.locations[userId] = { lat, lng, updatedAt: new Date() };

    // Broadcast to room
    const room = `job_${jobId}`;
    socket.to(room).emit('job_location_update', { userId, lat, lng, updatedAt: new Date() });

    // GPS proximity check — uses cached job data; refreshes status every 30s
    if (mongoConnected && Job && jobTrack.jobData) {
      try {
        const now = Date.now();
        // Lightweight status refresh every 30 seconds to catch QR handshake starts
        if (now - jobTrack.jobData.cachedAt > 30000) {
          const fresh = await Job.findById(jobId).select('status').lean();
          if (fresh) {
            jobTrack.jobData.status = fresh.status;
            jobTrack.jobData.cachedAt = now;
          }
        }

        if (jobTrack.jobData.status !== 'accepted') return;

        const posterId = jobTrack.jobData.posterId;
        const providerId = jobTrack.jobData.providerId;
        if (!providerId) return;

        const posterLoc = jobTrack.locations[posterId];
        const providerLoc = jobTrack.locations[providerId];
        if (!posterLoc || !providerLoc) return;

        const jobLat = jobTrack.jobData.lat;
        const jobLng = jobTrack.jobData.lng;
        if (jobLat == null || jobLng == null) return;

        const posterDist = haversineDistance(posterLoc.lat, posterLoc.lng, jobLat, jobLng);
        const providerDist = haversineDistance(providerLoc.lat, providerLoc.lng, jobLat, jobLng);

        if (posterDist <= PROXIMITY_THRESHOLD_KM && providerDist <= PROXIMITY_THRESHOLD_KM && !jobTrack.nearbyNotified) {
          jobTrack.nearbyNotified = true;
          io.to(room).emit('both_parties_nearby', {
            jobId,
            message: 'Both parties are within 100m of the job location. Use QR handshake to start the job.',
            posterDist,
            providerDist
          });
        }
      } catch (err) {
        console.error('GPS proximity check error:', err);
      }
    }
  });

  socket.on('disconnect', async () => {
    console.log('Client disconnected:', socket.id);
    if (socket.userId) {
      onlineUsers.delete(socket.userId);
      if (mongoConnected && User) {
        try {
          await User.findByIdAndUpdate(socket.userId, { isOnline: false, lastActive: new Date() });
        } catch (err) {
          console.error('disconnect DB error:', err.message);
        }
      }
      socket.broadcast.emit('user_status_changed', { userId: socket.userId, isOnline: false });
    }
  });

});



httpServer.listen(PORT, () => {

  console.log('========================================');

  console.log('GShop Server running on port', PORT);

  console.log('Mode:', mongoConnected ? 'MONGODB' : 'DEMO (In-Memory)');

  console.log('Features: Auth, Services, Transactions, Image Upload');

  console.log('========================================');

  logRoutes();

});

