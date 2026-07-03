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
const { body, validationResult } = require('express-validator');

require('dotenv').config();

const upload = require('./middleware/upload');
const { whitelistSelf } = require('./lib/atlas-whitelist');

// Import currency configuration
const currency = require('./config/currency');

const app = express();
const PORT = process.env.PORT || 3001;

// Fail fast in production if secrets are not set from environment
const isProd = process.env.NODE_ENV === 'production';
const JWT_SECRET = process.env.JWT_SECRET;
if (isProd && (!JWT_SECRET || JWT_SECRET === 'your-secret-key')) {
  console.error('FATAL: JWT_SECRET must be set in production');
  process.exit(1);
}
const effectiveJwtSecret = JWT_SECRET || 'your-secret-key';
process.env.JWT_SECRET = effectiveJwtSecret; // ensure all routes/middleware use the same secret


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

// Trust the Render proxy so req.ip and X-Forwarded-For are accurate.
// Must be set before any middleware that reads the client IP.
app.set('trust proxy', 1);

app.use('/api/', apiLimiter);

// CORS: explicit allowlist in production. Defaults include the Render URL and localhost for dev.
const rawCorsOrigins = process.env.CORS_ORIGINS || 'https://sebenza-server.onrender.com,http://localhost:3000,http://localhost:3001,http://localhost:5173';
const allowedOrigins = new Set(rawCorsOrigins.split(',').map(s => s.trim()).filter(Boolean));

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, server-to-server, curl)
    if (!origin) return callback(null, true);
    if (allowedOrigins.has(origin)) return callback(null, true);
    // Allow ngrok in non-production environments only
    if (!isProd && (origin.includes('ngrok-free.dev') || origin.includes('ngrok.io'))) {
      return callback(null, true);
    }
    callback(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

// Middleware
app.use(cors(corsOptions));
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// CSRF intentionally removed: this API uses JWT bearer tokens in the Authorization
// header, which makes CSRF cookie-based protection unnecessary and breaks cross-origin
// mobile/WebView clients. XSS is mitigated by input validation, Helmet, and CSP.

// Uploads are persisted to Cloudinary, not local disk. See middleware/upload.js.
// No /uploads/* static routes are exposed.

// Serve APK downloads with correct MIME type
app.use('/downloads', express.static(path.join(__dirname, 'downloads'), {
  setHeaders: (res, path) => {
    if (path.endsWith('.apk')) {
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    }
  }
}));

// Serve static files from the React build. The build lives at ./client/build
// both locally and on Render, so resolve it the same way everywhere. (The old
// ../client/build_v2 fallback pointed outside the repo and never existed,
// which broke local serving of the SPA.)
const buildPath = path.join(__dirname, 'client', 'build');
app.use(express.static(buildPath));

// MongoDB Connection with retry logic
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/sebenza';

// Production-safe Atlas connection options: fail fast on a bad primary,
// keep a bounded pool, and don't let a single slow query hang forever.
const MONGO_OPTIONS = {
  serverSelectionTimeoutMS: 10000,
  socketTimeoutMS: 45000,
  maxPoolSize: 10,
  family: 4
};

const connectWithRetry = async (retries = 5, delay = 5000) => {
  for (let i = 0; i < retries; i++) {
    try {
      await mongoose.connect(MONGODB_URI, MONGO_OPTIONS);
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
  .then(async () => {
    mongoConnected = true;
    // Auto-whitelist the server's public IP in Atlas so API automation works
    if (process.env.MONGODB_ATLAS_PUBLIC_KEY && process.env.MONGODB_ATLAS_PRIVATE_KEY) {
      try {
        const result = await whitelistSelf({ comment: 'Auto-whitelisted on Sebenza server startup' });
        console.log(`Atlas IP whitelist: ${result.alreadyWhitelisted ? 'already allowed' : 'added'} ${result.ip}`);
      } catch (err) {
        console.warn('Atlas auto-whitelist failed (non-fatal):', err.message);
      }
    }
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
const adminRoutes = require('./routes/admin');



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
  app.use('/api/admin', adminRoutes);

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
  app.use(`${API_VERSION}/admin`, adminRoutes);

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
  // Strip spaces/dashes/parens so "071 234 5678" and "+27 71 234 5678" pass validation
  body('phone').optional().customSanitizer(v => String(v || '').replace(/[\s\-().]/g, ''))
    .custom(v => v === '' || /^\+?\d{9,15}$/.test(v)).withMessage('Valid phone number required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    const { name, email, phone, password, location, skills, primaryCategory, ref, accountType, businessName, teamSize } = req.body;
    
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
      referredBy,
      accountType: ['individual', 'team', 'business'].includes(accountType) ? accountType : 'individual',
      businessName: String(businessName || '').trim().slice(0, 120),
      teamSize: Math.max(1, Math.min(50, parseInt(teamSize) || 1))
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
        referralCount: user.referralCount,
        accountType: user.accountType,
        businessName: user.businessName,
        teamSize: user.teamSize
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
        emailVerified: user.emailVerified || false,
        profileImage: user.profileImage || '',
        referralCode: user.referralCode,
        location: user.location ? { lat: user.location.lat, lng: user.location.lng } : null,
        accountType: user.accountType || 'individual',
        businessName: user.businessName || '',
        teamSize: user.teamSize || 1
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

    

    const { uploadFile } = require('./middleware/upload');
    const imageUrl = await uploadFile(req.file, 'profiles');

    

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
  res.sendFile(path.join(buildPath, 'index.html'));
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
  console.error(err.stack);
  // Never leak internal error details/stack to clients in production.
  const body = { error: 'Something went wrong!' };
  if (!isProd) body.details = err.message;
  res.status(500).json(body);
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
    origin: corsOptions.origin,
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Authenticate Socket.IO connections using the same JWT as the HTTP API
io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1];
    if (!token || token === 'null' || token === 'undefined') {
      return next(new Error('Authentication required'));
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = String(decoded.userId);
    next();
  } catch (err) {
    next(new Error('Authentication failed'));
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

  // SECURITY: never trust a client-supplied userId. The socket is already
  // authenticated in io.use() above, which sets socket.userId from the verified
  // JWT. Using the client's value here would let anyone claim another user's
  // socket and receive their private notifications/messages.
  socket.on('register', () => {
    if (!socket.userId) return;
    onlineUsers.set(socket.userId, socket.id);
  });

  socket.on('user_online', async () => {
    const userId = socket.userId;
    if (!userId) return;
    onlineUsers.set(userId, socket.id);
    if (mongoConnected && User) {
      try {
        await User.findByIdAndUpdate(userId, { isOnline: true, lastActive: new Date() });
      } catch (err) {
        console.error('user_online DB error:', err.message);
      }
    }
    socket.broadcast.emit('user_status_changed', { userId, isOnline: true });
  });

  socket.on('user_away', async () => {
    const userId = socket.userId;
    if (!userId) return;
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
    const { transactionId, receiverId, text, type, offerAmount } = data;
    // SECURITY: the sender is always the authenticated socket user, never a
    // client-supplied id — otherwise a user could post messages as someone else.
    const senderId = socket.userId;
    if (!senderId) return;
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

    // Authorization: only authenticated socket users can join; verify they are a job party
    if (!socket.userId) return;
    const socketUserId = socket.userId;

    let isAuthorized = false;
    if (mongoConnected && Job) {
      try {
        const job = await Job.findById(jobId)
          .select('posterId status acceptedApplicationId applications')
          .lean();
        if (job) {
          const isPoster = String(job.posterId) === socketUserId;
          const acceptedApp = job.applications?.find(
            a => String(a._id) === String(job.acceptedApplicationId)
          );
          const isProvider = acceptedApp && String(acceptedApp.applicantId) === socketUserId;
          isAuthorized = isPoster || isProvider;
        }
      } catch (err) {
        console.error('Job room auth error:', err);
      }
    }

    if (!isAuthorized) {
      socket.emit('error_message', { message: 'Not authorized to join this job room' });
      return;
    }

    socket.join(room);
    socket.jobRoom = room;
    console.log(`User ${socketUserId} joined job room ${room}`);

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

  console.log('Sebenza Server running on port', PORT);

  console.log('Mode:', mongoConnected ? 'MONGODB' : 'DEMO (In-Memory)');

  console.log('Features: Auth, Services, Transactions, Image Upload');

  console.log('========================================');

  logRoutes();

});

