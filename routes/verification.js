const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const upload = require('../middleware/upload');
const { uploadFile } = require('../middleware/upload');
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

const requireAdmin = async (req, res, next) => {
  try {
    const User = require('../models/User');
    const user = await User.findById(req.userId).select('role');
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
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

    const [idFrontUrl, idBackUrl, selfieUrl] = await Promise.all([
      uploadFile(req.files.idFront[0], 'kyc/ids'),
      uploadFile(req.files.idBack[0], 'kyc/ids'),
      uploadFile(req.files.selfie[0], 'kyc/selfies')
    ]);

    const verification = new Verification({
      userId: req.userId,
      idFront: idFrontUrl,
      idBack: idBackUrl,
      selfie: selfieUrl,
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

// Admin: Verify user
router.post('/approve/:userId', auth, requireAdmin, async (req, res) => {
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

// Get my own verification documents (authenticated, ownership checked)
router.get('/documents/:type', auth, async (req, res) => {
  try {
    const { type } = req.params;
    if (!['idFront', 'idBack', 'selfie'].includes(type)) {
      return res.status(400).json({ error: 'Invalid document type' });
    }
    const verification = await Verification.findOne({ userId: req.userId });
    if (!verification || !verification[type]) {
      return res.status(404).json({ error: 'Document not found' });
    }
    const fileUrl = verification[type];
    if (!fileUrl.startsWith('http')) {
      // Legacy local file fallback: only available when Cloudinary is not enabled.
      // Use path.basename so a tampered stored value can never traverse out of
      // the uploads folder (e.g. "../../etc/passwd").
      const folder = type === 'selfie' ? 'selfies' : 'ids';
      const safeName = path.basename(fileUrl);
      const filePath = path.join(__dirname, '..', 'uploads', folder, safeName);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found' });
      }
      return res.sendFile(filePath);
    }
    // Cloudinary URL: redirect through the authenticated gate.
    res.redirect(fileUrl);
  } catch (err) {
    console.error('Document fetch error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
