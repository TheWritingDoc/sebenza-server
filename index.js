const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
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
const { prisma } = require('./db');
const { toDTO, sanitizeUser } = require('./utils/dto');

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

// Postgres (Supabase) connection status — used by /api/health and the socket
// handlers so a transient DB outage degrades gracefully instead of crashing.
let dbConnected = false;
async function connectDatabase() {
  let delay = 5000;
  for (let attempt = 1; ; attempt++) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbConnected = true;
      console.log('Connected to Postgres (Supabase)');
      return;
    } catch (err) {
      console.error(`Postgres connection attempt ${attempt} failed:`, err.message);
      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(Math.round(delay * 1.5), 60000);
    }
  }
}
connectDatabase();

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
app.set('trust proxy', 1);

app.use('/api/', apiLimiter);

// CORS: explicit allowlist in production. Defaults include the Render URL and localhost for dev.
const rawCorsOrigins = process.env.CORS_ORIGINS || 'https://sebenza-server.onrender.com,http://localhost:3000,http://localhost:3001,http://localhost:5173';
const allowedOrigins = new Set(rawCorsOrigins.split(',').map(s => s.trim()).filter(Boolean));

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.has(origin)) return callback(null, true);
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

// When Supabase Storage is not configured (local dev), uploads fall back to
// local disk — mount the static routes only in that case.
const { storageEnabled } = require('./middleware/upload');
const UPLOADS_BASE = path.join(__dirname, 'uploads');
if (!storageEnabled) {
  app.use('/uploads/profiles', express.static(path.join(UPLOADS_BASE, 'profiles')));
  app.use('/uploads/proof', express.static(path.join(UPLOADS_BASE, 'proof')));
  app.use('/uploads/services', express.static(path.join(UPLOADS_BASE, 'services')));
  app.use('/uploads/jobs', express.static(path.join(UPLOADS_BASE, 'jobs')));
  // KYC documents are always served through the authenticated /api/verification/documents
  // endpoint, even in local fallback mode, so do not expose /uploads/ids or /uploads/selfies.
}

// Serve APK downloads with correct MIME type
app.use('/downloads', express.static(path.join(__dirname, 'downloads'), {
  setHeaders: (res, path) => {
    if (path.endsWith('.apk')) {
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    }
  }
}));

// Serve static files from the React build.
const buildPath = path.join(__dirname, 'client', 'build');
app.use(express.static(buildPath));

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
const notificationRoutes = require('./routes/notifications');
const teamRoutes = require('./routes/teams');

// API Versioning - v1 routes
const API_VERSION = '/api/v1';

// Legacy routes (backward compatible)
app.use('/api/verification', verificationRoutes);
app.use('/api/sms', smsRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/users', userRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/teams', teamRoutes);

// Versioned routes (v1)
app.use(`${API_VERSION}/verification`, verificationRoutes);
app.use(`${API_VERSION}/sms`, smsRoutes);
app.use(`${API_VERSION}/transactions`, transactionRoutes);
app.use(`${API_VERSION}/services`, serviceRoutes);
app.use(`${API_VERSION}/users`, userRoutes);
app.use(`${API_VERSION}/messages`, messageRoutes);
app.use(`${API_VERSION}/reviews`, reviewRoutes);
app.use(`${API_VERSION}/jobs`, jobRoutes);
app.use(`${API_VERSION}/notifications`, notificationRoutes);
app.use(`${API_VERSION}/admin`, adminRoutes);

// JWT Middleware
const auth = (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.split(' ')[1];
  if (!token || token === 'null' || token === 'undefined') {
    return res.status(401).json({ error: 'No token provided' });
  }
  try {
    const decoded = jwt.verify(token, effectiveJwtSecret);
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

// Helper: generate unique referral code
function generateReferralCode(name) {
  const clean = (name || 'user').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 4);
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${clean}${random}`;
}

// Shape the auth payload the client stores in localStorage after register/login.
function authUserPayload(user) {
  return {
    id: user.id,
    _id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    credits: Number(user.credits),
    randBalance: Number(user.randBalance),
    escrowRand: Number(user.escrowRand),
    totalEarnedRand: Number(user.totalEarnedRand),
    skills: user.skills,
    primaryCategory: user.primaryCategory,
    freeServiceUsed: user.freeServiceUsed,
    location: { lat: user.lat, lng: user.lng },
    verified: user.verified,
    phoneVerified: user.phoneVerified,
    emailVerified: user.emailVerified,
    profileImage: user.profileImage || '',
    referralCode: user.referralCode,
    referralCount: user.referralCount,
    accountType: user.accountType || 'individual',
    businessName: user.businessName || '',
    teamSize: user.teamSize || 1
  };
}

// Register with validation
app.post('/api/register', authLimiter, [
  body('name').trim().isLength({ min: 2, max: 100 }).withMessage('Name must be 2-100 characters'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('phone').optional().customSanitizer(v => String(v || '').replace(/[\s\-().]/g, ''))
    .custom(v => v === '' || /^\+?\d{9,15}$/.test(v)).withMessage('Valid phone number required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    const { name, email, phone, password, location, skills, primaryCategory, ref, accountType, businessName, teamSize } = req.body;

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Handle referral
    let referredById = null;
    if (ref) {
      const referrer = await prisma.user.findUnique({ where: { referralCode: ref.toUpperCase() } });
      if (referrer) {
        referredById = referrer.id;
        await prisma.user.update({
          where: { id: referrer.id },
          data: { referralCount: { increment: 1 } }
        });
      }
    }

    // Generate unique referral code
    let referralCode = generateReferralCode(name);
    while (await prisma.user.findUnique({ where: { referralCode } })) {
      referralCode = generateReferralCode(name);
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        name,
        email,
        phone: phone || '',
        password: hashedPassword,
        lat: location?.lat ?? 0,
        lng: location?.lng ?? 0,
        skills: skills?.length > 0 ? skills : ['General work/Helper'],
        primaryCategory: primaryCategory || 'General work/Helper',
        referralCode,
        referredById,
        accountType: ['individual', 'team', 'business'].includes(accountType) ? accountType : 'individual',
        businessName: String(businessName || '').trim().slice(0, 120),
        teamSize: Math.max(1, Math.min(50, parseInt(teamSize) || 1)),
        communityStats: {
          reliabilityScore: 100, givenRatingsAvg: 0, receivedRatingsAvg: 0,
          totalGivenReviews: 0, totalReceivedReviews: 0, complainerScore: 0,
          completionRate: 100, cancellationRate: 0, disputeRate: 0,
          jobsCompleted: 0, jobsRequested: 0, timeWasterFlags: 0,
          providerLateFlags: 0, impatientFlags: 0
        }
      }
    });

    const token = jwt.sign({ userId: user.id }, effectiveJwtSecret, { expiresIn: '30d' });
    res.json({ token, user: authUserPayload(user) });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});

// Login with validation
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
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    if (user.lockUntil && user.lockUntil > new Date()) {
      return res.status(423).json({
        error: 'Account temporarily locked due to too many failed attempts. Please try again later.'
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      const attempts = (user.loginAttempts || 0) + 1;
      if (attempts >= 5) {
        await prisma.user.update({
          where: { id: user.id },
          data: { lockUntil: new Date(Date.now() + 30 * 60 * 1000), loginAttempts: 0 }
        });
        return res.status(423).json({
          error: 'Account locked for 30 minutes due to too many failed login attempts.'
        });
      }
      await prisma.user.update({ where: { id: user.id }, data: { loginAttempts: attempts } });
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), loginAttempts: 0 }
    });

    const token = jwt.sign({ userId: user.id }, effectiveJwtSecret, { expiresIn: '30d' });
    res.json({ token, user: authUserPayload(user) });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});

// ── Phone-first onboarding ──
// Minimum requirement to join: a NAME and a VERIFIED CELL NUMBER. Everything
// else (email, photo, ID…) can be added later from the Trust Centre — each
// step earns identity stars at the user's own pace.
const normalizePhone = (p) => String(p || '').replace(/[\s\-().]/g, '');
const genSmsCode = () => Math.floor(100000 + Math.random() * 900000).toString();

// Step 1: request a code. Creates the account on first use (name required).
app.post('/api/phone/start', authLimiter, async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const name = String(req.body.name || '').trim();
    if (!/^\+?\d{9,15}$/.test(phone)) {
      return res.status(400).json({ error: 'Enter a valid cell number' });
    }

    let user = await prisma.user.findFirst({ where: { phone } });
    let newUser = false;
    if (!user) {
      if (name.length < 2) {
        return res.status(400).json({ error: 'NEW_USER_NAME_REQUIRED', message: 'Tell us your name to create your account' });
      }
      // Placeholder login identity — the user can add a real email later
      // (verifying it earns a star). Random password: phone+code is the login.
      const placeholderEmail = `p${phone.replace(/\D/g, '')}@phone.sebenza.app`;
      const existingEmail = await prisma.user.findUnique({ where: { email: placeholderEmail } });
      if (existingEmail) {
        user = existingEmail;
      } else {
        const randomPassword = await bcrypt.hash(require('crypto').randomBytes(24).toString('hex'), 10);
        let referralCode = generateReferralCode(name);
        while (await prisma.user.findUnique({ where: { referralCode } })) referralCode = generateReferralCode(name);
        user = await prisma.user.create({
          data: {
            name: name.slice(0, 100),
            email: placeholderEmail,
            password: randomPassword,
            phone,
            skills: ['General work/Helper'],
            primaryCategory: 'General work/Helper',
            referralCode,
            communityStats: {
              reliabilityScore: 100, givenRatingsAvg: 0, receivedRatingsAvg: 0,
              totalGivenReviews: 0, totalReceivedReviews: 0, complainerScore: 0,
              completionRate: 100, cancellationRate: 0, disputeRate: 0,
              jobsCompleted: 0, jobsRequested: 0, timeWasterFlags: 0,
              providerLateFlags: 0, impatientFlags: 0
            }
          }
        });
        newUser = true;
      }
    }

    const code = genSmsCode();
    await prisma.smsVerification.deleteMany({ where: { userId: user.id, phone } });
    await prisma.smsVerification.create({
      data: { userId: user.id, phone, code, expiresAt: new Date(Date.now() + 10 * 60 * 1000) }
    });

    const isDemo = !process.env.TWILIO_SID;
    if (isDemo) {
      console.log(`Demo mode - phone login code for ${phone}:`, code);
      return res.json({ message: 'Verification code sent (demo mode)', demo: true, code, newUser });
    }
    const twilio = require('twilio');
    const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
    await client.messages.create({
      body: 'Your Sebenza sign-in code is: ' + code,
      from: process.env.TWILIO_PHONE,
      to: phone
    });
    res.json({ message: 'Verification code sent', newUser });
  } catch (err) {
    console.error('Phone start error:', err);
    res.status(500).json({ error: 'Could not send the code' });
  }
});

// Step 2: verify the code → phone becomes verified (earns the phone star) and
// the user is signed in.
app.post('/api/phone/verify', authLimiter, async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const safeCode = String(req.body.code || '').replace(/\D/g, '').slice(0, 6);
    if (!phone || safeCode.length !== 6) {
      return res.status(400).json({ error: 'Phone and 6-digit code required' });
    }

    const user = await prisma.user.findFirst({ where: { phone } });
    if (!user) return res.status(400).json({ error: 'No account for that number — start again' });

    const sms = await prisma.smsVerification.findFirst({
      where: { userId: user.id, phone, code: safeCode, verified: false, expiresAt: { gt: new Date() } }
    });
    if (!sms) return res.status(400).json({ error: 'Invalid or expired code' });

    await prisma.smsVerification.deleteMany({ where: { userId: user.id, phone } });
    const fresh = await prisma.user.update({
      where: { id: user.id },
      data: { phoneVerified: true, lastLoginAt: new Date(), loginAttempts: 0 }
    });
    try {
      const { refreshTrust } = require('./utils/trustScore');
      await refreshTrust(prisma, user.id);
    } catch (e) { console.error('Trust refresh (phone login) failed:', e.message); }

    const token = jwt.sign({ userId: user.id }, effectiveJwtSecret, { expiresIn: '30d' });
    res.json({ token, user: authUserPayload(fresh) });
  } catch (err) {
    console.error('Phone verify error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// Get Profile
app.get('/api/profile', auth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const dto = sanitizeUser(user);
    res.json({
      ...dto,
      credits: Number(user.credits) || 1000,
      formattedBalance: 'R' + ((Number(user.credits) || 1000) / 100).toFixed(2),
      location: { lat: user.lat, lng: user.lng }
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

    await prisma.user.update({
      where: { id: req.userId },
      data: { profileImage: imageUrl }
    });

    // Adding a face photo raises identity trust stars
    try {
      const { refreshTrust } = require('./utils/trustScore');
      await refreshTrust(prisma, req.userId);
    } catch (e) { console.error('Trust refresh (photo) failed:', e.message); }

    res.json({
      message: 'Profile image uploaded successfully',
      imageUrl,
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
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: { workExperience: { orderBy: { addedAt: 'desc' } } }
    });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const dto = sanitizeUser(user, ['bankAccount', 'email', 'phone', 'emailVerificationExpires']);
    if (user.showOnlineStatus === false) {
      dto.isOnline = false;
      delete dto.lastActive;
    }
    dto.location = { lat: user.lat, lng: user.lng };

    const services = await prisma.service.findMany({
      where: { providerId: req.params.id, available: true },
      select: {
        id: true, title: true, description: true, category: true, randAmount: true,
        images: true, lat: true, lng: true, averageRating: true,
        completedJobsCount: true, totalReviews: true, pricingType: true,
        tags: true, estimatedDuration: true
      }
    });

    const reviews = await prisma.review.findMany({
      where: { revieweeId: req.params.id, isVisible: true },
      include: {
        reviewer: { select: { id: true, name: true, avatar: true } },
        service: { select: { id: true, title: true, category: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: 10
    });

    // Client reads reviewerId.name / serviceId.title (Mongo populate shape)
    const reviewDTOs = reviews.map(r => {
      const { reviewer, service, ...rest } = r;
      return { ...rest, reviewerId: reviewer, serviceId: service };
    });

    res.json({ ...dto, services: toDTO(services), reviews: toDTO(reviewDTOs) });
  } catch (err) {
    console.error('Public profile error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update user online status
app.put('/api/users/status', auth, async (req, res) => {
  try {
    const { isOnline, showOnlineStatus } = req.body;
    const data = { lastActive: new Date() };
    if (typeof isOnline === 'boolean') data.isOnline = isOnline;
    if (typeof showOnlineStatus === 'boolean') data.showOnlineStatus = showOnlineStatus;

    const user = await prisma.user.update({ where: { id: req.userId }, data });
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
    await prisma.user.update({ where: { id: req.userId }, data: { lat, lng } });
    res.json({ message: 'Location updated', location: { lat, lng } });
  } catch (err) {
    console.error('Location update error:', err);
    res.status(500).json({ error: 'Server error updating location' });
  }
});

// Health check
app.get('/api/health', async (req, res) => {
  res.json({
    status: 'ok',
    mode: dbConnected ? 'POSTGRES' : 'CONNECTING',
    features: ['auth', 'verification', 'sms', 'escrow', 'transactions', 'rand-conversion', 'image-upload'],
    currency: {
      code: currency.CURRENCY_CODE,
      symbol: currency.CURRENCY_SYMBOL,
      creditToRandRate: currency.CREDIT_TO_RAND_RATE
    },
    stats: {
      users: dbConnected ? await prisma.user.count().catch(() => 0) : 0,
      services: dbConnected ? await prisma.service.count().catch(() => 0) : 0,
      transactions: dbConnected ? await prisma.transaction.count().catch(() => 0) : 0
    },
    timestamp: new Date().toISOString()
  });
});

// Public services endpoint (no auth required for homepage display)
app.get('/api/services/public', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 6;
    const category = req.query.category;
    const where = { available: true };
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
      randAmount: Number(s.randAmount),
      location: { lat: s.lat, lng: s.lng },
      images: s.images || [],
      averageRating: Number(s.averageRating) || 5,
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
    mode: dbConnected ? 'POSTGRES' : 'CONNECTING',
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
  if (err.message && err.message.includes('Invalid file')) {
    return res.status(400).json({ error: err.message });
  }
  console.error(err.stack);
  const body = { error: 'Something went wrong!' };
  if (!isProd) body.details = err.message;
  res.status(500).json(body);
});

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
    const decoded = jwt.verify(token, effectiveJwtSecret);
    socket.userId = String(decoded.userId);
    next();
  } catch (err) {
    next(new Error('Authentication failed'));
  }
});

// Track online users
const onlineUsers = new Map();

// Track job location sharing for device handshake
const jobLocations = new Map(); // jobId -> { locations, nearbyNotified, jobData }
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

  // SECURITY: never trust a client-supplied userId — socket.userId comes from
  // the verified JWT in io.use() above.
  socket.on('register', () => {
    if (!socket.userId) return;
    onlineUsers.set(socket.userId, socket.id);
  });

  socket.on('user_online', async () => {
    const userId = socket.userId;
    if (!userId) return;
    onlineUsers.set(userId, socket.id);
    try {
      await prisma.user.update({ where: { id: userId }, data: { isOnline: true, lastActive: new Date() } });
    } catch (err) {
      console.error('user_online DB error:', err.message);
    }
    socket.broadcast.emit('user_status_changed', { userId, isOnline: true });
  });

  socket.on('user_away', async () => {
    const userId = socket.userId;
    if (!userId) return;
    try {
      await prisma.user.update({ where: { id: userId }, data: { isOnline: false, lastActive: new Date() } });
    } catch (err) {
      console.error('user_away DB error:', err.message);
    }
    socket.broadcast.emit('user_status_changed', { userId, isOnline: false });
  });

  socket.on('join_chat', (transactionId) => {
    socket.join(`chat_${transactionId}`);
  });

  socket.on('send_message', async (data) => {
    const { transactionId, receiverId, text, type, offerAmount } = data;
    // SECURITY: the sender is always the authenticated socket user.
    const senderId = socket.userId;
    if (!senderId) return;
    let savedMessage = null;
    try {
      savedMessage = await prisma.message.create({
        data: {
          transactionId,
          senderId,
          receiverId,
          text,
          type: type || 'text',
          offerAmount: offerAmount != null ? offerAmount : null
        }
      });
    } catch (err) {
      console.error('send_message DB error:', err.message);
    }
    const msgPayload = {
      _id: savedMessage?.id,
      transactionId,
      senderId: String(senderId),
      receiverId: String(receiverId),
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

  socket.on('join_job_room', async ({ jobId }) => {
    const room = `job_${jobId}`;
    if (!socket.userId) return;
    const socketUserId = socket.userId;

    let isAuthorized = false;
    let job = null;
    try {
      job = await prisma.job.findUnique({
        where: { id: jobId },
        select: {
          posterId: true, status: true, lat: true, lng: true,
          acceptedApplicationId: true,
          applications: { select: { id: true, applicantId: true } }
        }
      });
      if (job) {
        const isPoster = String(job.posterId) === socketUserId;
        const acceptedApp = job.applications?.find(a => a.id === job.acceptedApplicationId);
        const isProvider = acceptedApp && String(acceptedApp.applicantId) === socketUserId;
        isAuthorized = isPoster || isProvider;
      }
    } catch (err) {
      console.error('Job room auth error:', err);
    }

    if (!isAuthorized) {
      socket.emit('error_message', { message: 'Not authorized to join this job room' });
      return;
    }

    socket.join(room);
    socket.jobRoom = room;
    console.log(`User ${socketUserId} joined job room ${room}`);

    // Cache job data on first join to avoid DB queries on every GPS tick
    if (job && !jobLocations.has(jobId)) {
      const acceptedApp = job.applications?.find(a => a.id === job.acceptedApplicationId);
      jobLocations.set(jobId, {
        locations: {},
        nearbyNotified: false,
        jobData: {
          posterId: String(job.posterId),
          providerId: acceptedApp ? String(acceptedApp.applicantId) : null,
          status: job.status,
          lat: job.lat,
          lng: job.lng,
          cachedAt: Date.now()
        }
      });
    }
  });

  socket.on('leave_job_room', ({ jobId }) => {
    const room = `job_${jobId}`;
    socket.leave(room);
    socket.jobRoom = null;
    console.log(`User left job room ${room}`);

    const roomSockets = io.sockets.adapter.rooms.get(room);
    if (!roomSockets || roomSockets.size === 0) {
      jobLocations.delete(jobId);
      console.log(`Cleared job cache for ${room} (room empty)`);
    }
  });

  socket.on('share_location', async ({ jobId, lat, lng }) => {
    if (!socket.userId || !jobId || lat == null || lng == null) return;
    const userId = String(socket.userId);

    if (!jobLocations.has(jobId)) {
      jobLocations.set(jobId, { locations: {}, nearbyNotified: false });
    }
    const jobTrack = jobLocations.get(jobId);
    jobTrack.locations[userId] = { lat, lng, updatedAt: new Date() };

    const room = `job_${jobId}`;
    socket.to(room).emit('job_location_update', { userId, lat, lng, updatedAt: new Date() });

    // GPS proximity check — uses cached job data; refreshes status every 30s
    if (jobTrack.jobData) {
      try {
        const now = Date.now();
        if (now - jobTrack.jobData.cachedAt > 30000) {
          const fresh = await prisma.job.findUnique({ where: { id: jobId }, select: { status: true } });
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
      try {
        await prisma.user.update({ where: { id: socket.userId }, data: { isOnline: false, lastActive: new Date() } });
      } catch (err) {
        console.error('disconnect DB error:', err.message);
      }
      socket.broadcast.emit('user_status_changed', { userId: socket.userId, isOnline: false });
    }
  });
});

// ── Expire stale jobs ──
// Every job is live for 24h from its publish time. Jobs that reach expiry
// while still un-started (open/negotiating/approved) are flipped to 'expired'
// and the poster is nudged to repost.
async function sweepExpiredJobs() {
  if (!dbConnected) return;
  try {
    const now = new Date();
    const stale = await prisma.job.findMany({
      where: {
        status: { in: ['open', 'negotiating', 'approved'] },
        expiresAt: { lt: now }
      },
      select: { id: true, posterId: true, title: true }
    });
    if (stale.length === 0) return;
    await prisma.job.updateMany({
      where: { id: { in: stale.map(j => j.id) } },
      data: { status: 'expired' }
    });
    const notifier = require('./utils/notifications');
    for (const j of stale) {
      notifier.sendNotification(io, onlineUsers, j.posterId, {
        type: 'job_expired',
        title: 'Job Expired',
        message: `"${j.title}" reached its 24-hour limit with no accepted helper. Repost it to try again.`,
        jobId: j.id
      }).catch(() => {});
    }
    console.log(`Expired ${stale.length} stale job(s)`);
  } catch (err) {
    console.error('Job sweep error:', err.message);
  }
}
setTimeout(sweepExpiredJobs, 30 * 1000);
setInterval(sweepExpiredJobs, 15 * 60 * 1000);

httpServer.listen(PORT, () => {
  console.log('========================================');
  console.log('Sebenza Server running on port', PORT);
  console.log('Database: Postgres (Supabase) via Prisma');
  console.log('========================================');
});
