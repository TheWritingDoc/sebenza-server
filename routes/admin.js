const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { whitelistSelf } = require('../lib/atlas-whitelist');

// Reusable JWT auth middleware
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
    const user = await User.findById(req.userId).select('role');
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

// Whitelist the server's current public IP in MongoDB Atlas
router.post('/atlas/whitelist-self', auth, requireAdmin, async (req, res) => {
  try {
    const result = await whitelistSelf();
    res.json({
      message: result.alreadyWhitelisted ? 'IP already whitelisted' : 'IP whitelisted successfully',
      ...result
    });
  } catch (err) {
    console.error('Atlas whitelist error:', err.message);
    res.status(500).json({ error: 'Failed to whitelist IP', details: err.message });
  }
});

module.exports = router;
