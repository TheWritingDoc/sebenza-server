const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { body, validationResult } = require('express-validator');
require('dotenv').config();

const app = express();
const PORT = 3001;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false, // Disable for React app compatibility
  crossOriginEmbedderPolicy: false
}));

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 requests per windowMs
  message: { error: 'Too many auth attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false
});

// General API rate limiting
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: { error: 'Too many requests, please slow down' }
});

app.use('/api/', apiLimiter);

// Serve static files FIRST (before API routes)
app.use(express.static(path.join(__dirname, '../client/build_v2')));

// Enhanced health endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    mode: 'MONGODB',
    time: new Date().toISOString(),
    version: '1.0.0',
    uptime: process.uptime()
  });
});

// Database connection with retry logic
const connectWithRetry = async (retries = 5, delay = 5000) => {
  for (let i = 0; i < retries; i++) {
    try {
      await mongoose.connect('mongodb://localhost:27017/gshop');
      console.log('MongoDB connected');
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
    // Load models
    require('./models/User');
    require('./models/Service');
    require('./models/Transaction');
    require('./models/Verification');
    require('./models/SMSVerification');
    require('./models/Message');
    require('./models/Review');
    require('./models/Job');
    console.log('Models loaded');
    
    // Load routes
    app.use('/api/verification', require('./routes/verification'));
    app.use('/api/sms', require('./routes/sms'));
    app.use('/api/transactions', require('./routes/transactions'));
    app.use('/api/services', require('./routes/services'));
    app.use('/api/users', require('./routes/users'));
    app.use('/api/messages', require('./routes/messages'));
    app.use('/api/reviews', require('./routes/reviews'));
    app.use('/api/jobs', require('./routes/jobs'));
    app.use('/api/notifications', require('./routes/notifications'));
    console.log('Routes loaded');
    
    // API 404 fallback
    app.use('/api', (req, res) => {
      res.status(404).json({ error: 'API endpoint not found', path: req.path });
    });
    
    // Catch-all: serve React app for any non-API route
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, '../client/build_v2', 'index.html'));
    });
    
    // Global error handling middleware
    app.use((err, req, res, next) => {
      console.error('Error:', err);
      
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large. Maximum upload size is 15MB per photo.' });
      }
      if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ error: 'Unexpected file field.', details: err.message });
      }
      
      res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
      });
    });
    
    const httpServer = http.createServer(app);
    httpServer.listen(PORT, '0.0.0.0', () => {
      console.log('========================================');
      console.log('GShop Server running on port', PORT);
      console.log('Mode: MONGODB');
      console.log('Features: Auth, Services, Transactions, Jobs');
      console.log('Security: Rate limiting, Helmet, Input validation');
      console.log('========================================');
    });
  })
  .catch(err => {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  });
