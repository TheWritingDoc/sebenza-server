const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload');
const Verification = require('../models/Verification');
const jwt = require('jsonwebtoken');

// Middleware to verify JWT
const auth = (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.split(' ')[1];
  if (!token || token === 'null' || token === 'undefined') {
    return res.status(401).json({ error: 'No token provided' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
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

// Upload ID and selfie for verification
router.post('/upload', auth, upload.fields([
  { name: 'idFront', maxCount: 1 },
  { name: 'idBack', maxCount: 1 },
  { name: 'selfie', maxCount: 1 }
]), async (req, res) => {
  try {
    if (!req.files || !req.files.idFront || !req.files.idBack || !req.files.selfie) {
      return res.status(400).json({ error: 'All three files required: idFront, idBack, selfie' });
    }

    const existing = await Verification.findOne({ userId: req.userId });
    if (existing) {
      return res.status(400).json({ error: 'Verification already submitted' });
    }

    const verification = new Verification({
      userId: req.userId,
      idFront: req.files.idFront[0].filename,
      idBack: req.files.idBack[0].filename,
      selfie: req.files.selfie[0].filename,
      idNumber: req.body.idNumber || null
    });

    await verification.save();

    res.json({
      message: 'Documents uploaded successfully. Pending review.',
      verificationId: verification._id
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Server error during upload' });
  }
});

// Get verification status
router.get('/status', auth, async (req, res) => {
  try {
    const verification = await Verification.findOne({ userId: req.userId });
    if (!verification) {
      return res.json({ status: 'not_submitted' });
    }
    
    res.json({
      status: verification.verified ? 'verified' : 'pending',
      submittedAt: verification.submittedAt,
      verifiedAt: verification.verifiedAt
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: Verify user (simplified - in production, add admin auth)
router.post('/approve/:userId', async (req, res) => {
  try {
    const verification = await Verification.findOneAndUpdate(
      { userId: req.params.userId },
      { verified: true, verifiedAt: new Date() },
      { new: true }
    );
    
    if (!verification) {
      return res.status(404).json({ error: 'Verification not found' });
    }

    // Update user verified status
    const User = require('../models/User');
    await User.findByIdAndUpdate(req.params.userId, { verified: true });

    res.json({ message: 'User verified successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
