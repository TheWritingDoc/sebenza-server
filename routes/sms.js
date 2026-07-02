const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const SMSVerification = require('../models/SMSVerification');
const jwt = require('jsonwebtoken');

// In production, use Twilio. For demo, we'll simulate SMS.
// To use real SMS, set TWILIO_SID, TWILIO_TOKEN, TWILIO_PHONE in .env

// Strict limiter: max 3 send attempts per user per hour
const smsSendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  keyGenerator: (req) => req.userId || req.ip,
  message: { error: 'Too many SMS requests. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Verify limiter: max 5 attempts per code
const smsVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => req.userId || req.ip,
  message: { error: 'Too many verification attempts. Request a new code.' },
  standardHeaders: true,
  legacyHeaders: false
});

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

// Generate 6-digit code
const generateCode = () => Math.floor(100000 + Math.random() * 900000).toString();

// Send SMS verification code
router.post('/send', auth, smsSendLimiter, async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone number required' });

    // Generate code
    const code = generateCode();
    
    // Delete any existing codes for this user/phone
    await SMSVerification.deleteMany({ userId: req.userId, phone });
    
    // Save new code (expires in 10 minutes)
    const sms = new SMSVerification({
      userId: req.userId,
      phone,
      code,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000)
    });
    await sms.save();

    // In production, send real SMS via Twilio
    // For now, return code in response (NEVER do this in production!)
    const isDemo = !process.env.TWILIO_SID;
    
    if (isDemo) {
      console.log('Demo mode - SMS code:', code);
      res.json({
        message: 'Verification code sent (demo mode - check server console)'
        // Never return demoCode to the client, even in demo mode.
      });
    } else {
      // Real Twilio integration would go here
      const twilio = require('twilio');
      const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
      await client.messages.create({
        body: 'Your GShop verification code is: ' + code,
        from: process.env.TWILIO_PHONE,
        to: phone
      });
      res.json({ message: 'Verification code sent' });
    }
  } catch (err) {
    console.error('SMS error:', err);
    res.status(500).json({ error: 'Failed to send SMS' });
  }
});

// Verify SMS code
router.post('/verify', auth, smsVerifyLimiter, async (req, res) => {
  try {
    const { phone, code } = req.body;
    if (!phone || !code) return res.status(400).json({ error: 'Phone and code required' });

    // Sanitize input
    const safeCode = String(code).replace(/\D/g, '').slice(0, 6);
    if (safeCode.length !== 6) {
      return res.status(400).json({ error: 'Invalid code format' });
    }

    const sms = await SMSVerification.findOne({
      userId: req.userId,
      phone,
      code: safeCode,
      verified: false,
      expiresAt: { $gt: new Date() }
    });

    if (!sms) {
      return res.status(400).json({ error: 'Invalid or expired code' });
    }

    sms.verified = true;
    await sms.save();
    // Delete the code once verified to prevent reuse
    await SMSVerification.deleteMany({ userId: req.userId, phone });

    // Update user phone verified status
    const User = require('../models/User');
    await User.findByIdAndUpdate(req.userId, { phoneVerified: true });

    res.json({ message: 'Phone verified successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Verification failed' });
  }
});

module.exports = router;
