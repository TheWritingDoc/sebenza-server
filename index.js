// Sentry must load before express (see instrument.js). No-op without SENTRY_DSN.
const Sentry = require('./instrument');
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

// Current legal document version. Bump when Terms/Privacy materially change so
// existing users can be re-prompted to re-accept.
const TERMS_VERSION = '2026-07-08';

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

// Security middleware. CSP is enabled with an allowlist matching what the SPA
// actually loads (CRA inline runtime, Leaflet/qrcode CDNs, Google Fonts,
// Supabase Storage images, same-origin socket.io). This limits where a stored
// XSS could exfiltrate the localStorage JWT to.
const SUPABASE_ORIGIN = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'self'"],
      formAction: ["'self'"],
      // CRA inlines the runtime chunk, so 'unsafe-inline' is required for
      // scripts. Leaflet + qrcode are bundled now — no CDN script hosts.
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'", 'data:'],
      // Images: self, inline previews (data/blob), any https (OSM map tiles,
      // Supabase Storage photos, avatars).
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      // Where the app may open connections: same-origin API + websockets, and
      // Supabase (Storage). Tight enough to blunt token exfiltration.
      connectSrc: ["'self'", 'wss:', SUPABASE_ORIGIN].filter(Boolean),
      workerSrc: ["'self'", 'blob:'],
      upgradeInsecureRequests: []
    }
  }
}));

// Rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many auth attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false
});

// SMS-cost abuse guard for phone signup/login: cap requests PER PHONE NUMBER
// (not just per IP) so one IP can't fan out real SMS to many numbers, and one
// number can't be spammed with codes.
const phoneStartLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  keyGenerator: (req) => {
    const phone = String(req.body?.phone || '').replace(/[\s\-().]/g, '');
    return phone || ipKeyGenerator(req);
  },
  message: { error: 'Too many code requests for this number. Please wait a while and try again.' },
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

// Direct APK download (beta distribution until the Play Store listing is live).
app.use('/downloads', express.static(path.join(__dirname, 'downloads'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.apk')) {
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    }
  }
}));

// Structured JSON request logs with request IDs (pino). Health-check and
// static-asset noise is filtered; auth headers are redacted.
const { logger, httpLogger } = require('./utils/logger');
app.use(httpLogger);

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

// JWT auth (shared, with token-version revocation)
const { auth, currentTokenVersion, startExclusiveSession } = require('./middleware/authToken');

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
    teamSize: user.teamSize || 1,
    role: user.role || 'client'
  };
}

// Register with validation
app.post('/api/register', authLimiter, [
  body('name').trim().isLength({ min: 2, max: 100 }).withMessage('Name must be 2-100 characters'),
  body('email').isEmail().normalizeEmail({ gmail_remove_dots: false }).withMessage('Valid email required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('phone').optional().customSanitizer(v => String(v || '').replace(/[\s\-().]/g, ''))
    .custom(v => v === '' || /^\+?\d{9,15}$/.test(v)).withMessage('Valid phone number required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    const { name, email, phone, password, location, skills, primaryCategory, ref, accountType, businessName, teamSize, acceptTerms } = req.body;

    // POPIA: explicit consent to Terms + Privacy is required to register (the
    // app collects ID documents, selfies and location).
    if (acceptTerms !== true && acceptTerms !== 'true') {
      return res.status(400).json({ error: 'You must accept the Terms of Service and Privacy Policy to create an account' });
    }

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
        termsAcceptedAt: new Date(),
        termsVersion: TERMS_VERSION,
        communityStats: {
          reliabilityScore: 100, givenRatingsAvg: 0, receivedRatingsAvg: 0,
          totalGivenReviews: 0, totalReceivedReviews: 0, complainerScore: 0,
          completionRate: 100, cancellationRate: 0, disputeRate: 0,
          jobsCompleted: 0, jobsRequested: 0, timeWasterFlags: 0,
          providerLateFlags: 0, impatientFlags: 0
        }
      }
    });

    const token = jwt.sign({ userId: user.id, tv: user.tokenVersion || 0 }, effectiveJwtSecret, { expiresIn: '30d' });
    res.json({ token, user: authUserPayload(user) });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});

// Login with validation
app.post('/api/login', authLimiter, [
  body('email').isEmail().normalizeEmail({ gmail_remove_dots: false }).withMessage('Valid email required'),
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

    // New-device check: an existing user signing in from an unrecognised
    // device must confirm via phone OTP before getting a session (only
    // enforceable when they have a verified phone and SMS is configured).
    const deviceId = String(req.body.deviceId || '').slice(0, 80);
    const smsConfigured = !!(process.env.TWILIO_SID && process.env.TWILIO_TOKEN && process.env.TWILIO_PHONE);
    const knownDevice = deviceId && user.lastDeviceId && deviceId === user.lastDeviceId;
    if (!knownDevice && user.phoneVerified && user.phone && smsConfigured) {
      const code = genSmsCode();
      await prisma.smsVerification.deleteMany({ where: { userId: user.id, phone: user.phone } });
      await prisma.smsVerification.create({
        data: { userId: user.id, phone: user.phone, code, expiresAt: new Date(Date.now() + 10 * 60 * 1000) }
      });
      try {
        const twilio = require('twilio');
        const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
        const { toE164ZA } = require('./utils/phone');
        await client.messages.create({
          body: 'New device sign-in: your Sebenza code is ' + code,
          from: process.env.TWILIO_PHONE,
          to: toE164ZA(user.phone)
        });
      } catch (smsErr) {
        console.error('New-device OTP send failed:', smsErr.message);
        return res.status(500).json({ error: 'Could not send the verification code. Try again.' });
      }
      const masked = user.phone.replace(/.(?=.{4})/g, '•');
      return res.json({ otpRequired: true, phone: user.phone, phoneMasked: masked,
        message: `New device detected — we sent a code to ${masked}.` });
    }

    // One device at a time: this login becomes the only valid session.
    const tv = await startExclusiveSession(user.id);
    if (deviceId) {
      await prisma.user.update({ where: { id: user.id }, data: { lastDeviceId: deviceId } }).catch(() => {});
    }
    const token = jwt.sign({ userId: user.id, tv }, effectiveJwtSecret, { expiresIn: '30d' });
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
app.post('/api/phone/start', phoneStartLimiter, async (req, res) => {
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
      // POPIA consent required to create the account.
      if (req.body.acceptTerms !== true && req.body.acceptTerms !== 'true') {
        return res.status(400).json({ error: 'TERMS_REQUIRED', message: 'Please accept the Terms and Privacy Policy to continue' });
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
            termsAcceptedAt: new Date(),
            termsVersion: TERMS_VERSION,
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
      // SECURITY: never return the code in production. Without SMS creds a prod
      // deploy would otherwise hand the OTP to anyone who asks → account takeover.
      if (isProd) {
        return res.status(503).json({ error: 'SMS delivery is not configured. Please try again later or use email.' });
      }
      return res.json({ message: 'Verification code sent (demo mode)', demo: true, code, newUser });
    }
    const twilio = require('twilio');
    const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
    const { toE164ZA } = require('./utils/phone');
    await client.messages.create({
      body: 'Your Sebenza sign-in code is: ' + code,
      from: process.env.TWILIO_PHONE,
      to: toE164ZA(phone)
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

    // One device at a time: this login becomes the only valid session.
    const tv = await startExclusiveSession(user.id);
    const verifiedDeviceId = String(req.body.deviceId || '').slice(0, 80);
    if (verifiedDeviceId) {
      await prisma.user.update({ where: { id: user.id }, data: { lastDeviceId: verifiedDeviceId } }).catch(() => {});
    }
    const token = jwt.sign({ userId: user.id, tv }, effectiveJwtSecret, { expiresIn: '30d' });
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

    // Public profile: explicit allowlist. Never expose balances, moderation
    // flags, referral codes, contact details, or exact GPS.
    const dto = {
      id: user.id,
      _id: user.id,
      name: user.name,
      avatar: user.avatar,
      profileImage: user.profileImage,
      bio: user.bio,
      primaryCategory: user.primaryCategory,
      skills: user.skills,
      accountType: user.accountType,
      businessName: user.businessName,
      verified: user.verified,
      emailVerified: user.emailVerified,
      phoneVerified: user.phoneVerified,
      trustStars: Number(user.trustStars),
      trustLevel: user.trustLevel,
      rating: Number(user.rating),
      communityStats: user.communityStats,
      workExperience: toDTO(user.workExperience || []),
      status: user.status,
      isOnline: user.showOnlineStatus === false ? false : user.isOnline,
      createdAt: user.createdAt,
      // Coarsen public location to ~1km (2 decimals) — never the exact home GPS.
      location: {
        lat: Math.round((user.lat || 0) * 100) / 100,
        lng: Math.round((user.lng || 0) * 100) / 100
      }
    };
    if (user.showOnlineStatus !== false) dto.lastActive = user.lastActive;

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
    const lat = parseFloat(req.body.lat);
    const lng = parseFloat(req.body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ error: 'Valid latitude (-90..90) and longitude (-180..180) required' });
    }
    await prisma.user.update({ where: { id: req.userId }, data: { lat, lng } });
    res.json({ message: 'Location updated', location: { lat, lng } });
  } catch (err) {
    console.error('Location update error:', err);
    res.status(500).json({ error: 'Server error updating location' });
  }
});

// Health check
// Lightweight health check — a single cheap round-trip so uptime monitors
// polling this don't burn pooler connections / DB CPU with COUNT(*) scans.
app.get('/api/health', async (req, res) => {
  let db = 'down';
  if (dbConnected) {
    try { await prisma.$queryRaw`SELECT 1`; db = 'up'; } catch (e) { db = 'error'; }
  } else {
    db = 'connecting';
  }
  const providers = {
    sms: !!(process.env.TWILIO_SID && process.env.TWILIO_TOKEN && process.env.TWILIO_PHONE),
    email: !!((process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS) || process.env.SENDGRID_API_KEY),
  };
  res.json({
    status: db === 'up' ? 'ok' : 'degraded',
    mode: dbConnected ? 'POSTGRES' : 'CONNECTING',
    db,
    currency: {
      code: currency.CURRENCY_CODE,
      symbol: currency.CURRENCY_SYMBOL,
      creditToRandRate: currency.CREDIT_TO_RAND_RATE
    },
    timestamp: new Date().toISOString(),
    providers,
  });
});

// Aggregate counts (moved off the health check). Cached lightly to avoid a DB
// hit on every homepage load.
let statsCache = { at: 0, data: null };
app.get('/api/stats/public', async (req, res) => {
  try {
    if (!statsCache.data || Date.now() - statsCache.at > 60 * 1000) {
      const [users, services] = await Promise.all([
        prisma.user.count().catch(() => 0),
        prisma.service.count().catch(() => 0)
      ]);
      statsCache = { at: Date.now(), data: { users, services } };
    }
    res.json(statsCache.data);
  } catch (err) {
    res.json({ users: 0, services: 0 });
  }
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

// External cron (GitHub Actions) hits this every 15 min — it both sweeps and
// wakes a sleeping free-tier instance, so expiries can't be missed while
// asleep. Guarded by CRON_SECRET; disabled if the secret isn't set.
app.post('/api/internal/sweep', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers['x-cron-secret'] !== secret) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  await sweepExpiredJobs();
  res.json({ ok: true });
});

// Fallback for any unmatched API routes — return JSON 404 instead of HTML
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found', path: req.path, method: req.method });
});

// Catch-all: serve React app for any non-API route
app.get('*', (req, res) => {
  res.sendFile(path.join(buildPath, 'index.html'));
});

// Sentry sees every unhandled route error first (no-op without DSN)…
Sentry.setupExpressErrorHandler(app);

// …then our handler shapes the client-facing response.
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
  (req.log || logger).error({ err, reqId: req.id }, 'Unhandled route error');
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
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1];
    if (!token || token === 'null' || token === 'undefined') {
      return next(new Error('Authentication required'));
    }
    const decoded = jwt.verify(token, effectiveJwtSecret);
    const v = await currentTokenVersion(decoded.userId).catch(() => (decoded.tv || 0));
    if (v === null || (decoded.tv || 0) !== v) {
      return next(new Error('Session revoked'));
    }
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

  // Only the two parties to a transaction may read/post its chat. Returns the
  // transaction's requester/provider ids, or null if the socket user isn't one.
  const isUuid = (s) => typeof s === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
  async function chatParties(transactionId, userId) {
    if (!isUuid(transactionId) || !userId) return null;
    try {
      const t = await prisma.transaction.findUnique({
        where: { id: transactionId },
        select: { requesterId: true, providerId: true }
      });
      if (!t) return null;
      if (String(t.requesterId) !== String(userId) && String(t.providerId) !== String(userId)) return null;
      return t;
    } catch (err) {
      console.error('chatParties error:', err.message);
      return null;
    }
  }

  socket.on('join_chat', async (transactionId) => {
    // SECURITY: verify the socket user is a party before joining the room —
    // otherwise anyone could subscribe to any transaction's messages.
    const parties = await chatParties(transactionId, socket.userId);
    if (!parties) {
      socket.emit('error_message', { message: 'Not authorized for this chat' });
      return;
    }
    socket.join(`chat_${transactionId}`);
  });

  socket.on('send_message', async (data) => {
    const { transactionId, text, type, offerAmount } = data;
    const senderId = socket.userId;
    if (!senderId) return;

    // SECURITY: the sender must be a party to the transaction, and the receiver
    // is derived server-side (the OTHER party) — never trusted from the client.
    const parties = await chatParties(transactionId, senderId);
    if (!parties) {
      socket.emit('error_message', { message: 'Not authorized for this chat' });
      return;
    }
    const receiverId = String(parties.requesterId) === String(senderId)
      ? String(parties.providerId)
      : String(parties.requesterId);

    const safeText = String(text || '').slice(0, 2000);
    if (!safeText.trim()) return;

    let savedMessage = null;
    try {
      savedMessage = await prisma.message.create({
        data: {
          transactionId,
          senderId,
          receiverId,
          text: safeText,
          type: type === 'price_offer' || type === 'price_accept' || type === 'price_reject' ? type : 'text',
          offerAmount: offerAmount != null && !isNaN(Number(offerAmount)) ? Number(offerAmount) : null
        }
      });
    } catch (err) {
      console.error('send_message DB error:', err.message);
    }
    const msgPayload = {
      _id: savedMessage?.id,
      transactionId,
      senderId: String(senderId),
      receiverId,
      text: safeText,
      type: type || 'text',
      offerAmount,
      createdAt: savedMessage?.createdAt?.toISOString() || new Date().toISOString()
    };
    io.to(`chat_${transactionId}`).emit('new_message', msgPayload);
    const receiverSocketId = onlineUsers.get(receiverId);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('chat_notification', {
        transactionId,
        senderId: String(senderId),
        text: safeText.substring(0, 50)
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
const sweepTimer = setTimeout(sweepExpiredJobs, 30 * 1000);
const sweepInterval = setInterval(sweepExpiredJobs, 15 * 60 * 1000);

httpServer.listen(PORT, () => {
  console.log('========================================');
  console.log('Sebenza Server running on port', PORT);
  console.log('Database: Postgres (Supabase) via Prisma');
  console.log('========================================');
});

// Slow-client / slowloris protection and clean connection recycling.
httpServer.headersTimeout = 20 * 1000;   // must send headers within 20s
httpServer.requestTimeout = 60 * 1000;   // whole request within 60s
httpServer.keepAliveTimeout = 61 * 1000; // > Render's LB idle to avoid 502s

// ── Graceful shutdown ──
// Render sends SIGTERM on every deploy. Without this, in-flight requests and
// DB writes are killed mid-flight. Drain connections, close sockets, then
// disconnect Prisma before exiting.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} received — shutting down gracefully…`);
  clearTimeout(sweepTimer);
  clearInterval(sweepInterval);

  // Stop accepting new HTTP connections; close the socket.io server.
  const forceExit = setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 15 * 1000);

  try {
    io.close();
    await new Promise((resolve) => httpServer.close(resolve));
    await prisma.$disconnect();
    clearTimeout(forceExit);
    console.log('Clean shutdown complete');
    process.exit(0);
  } catch (err) {
    console.error('Error during shutdown:', err.message);
    process.exit(1);
  }
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Last-resort safety nets. A crashed process is restarted by Render; the goal
// here is to log the cause (so it's not silent) and exit cleanly rather than
// leave the process in a half-dead state.
process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason);
  try { Sentry.captureException(reason); } catch (e) { /* sentry off */ }
});
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
  try { Sentry.captureException(err); } catch (e) { /* sentry off */ }
  shutdown('uncaughtException');
});
