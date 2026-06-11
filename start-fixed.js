const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static files FIRST (before API routes)
app.use(express.static(path.join(__dirname, '../client/build_v2')));

// Health endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', mode: 'MONGODB', time: new Date().toISOString() });
});

mongoose.connect('mongodb://localhost:27017/gshop')
  .then(() => {
    console.log('MongoDB connected');
    
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
    
    const httpServer = http.createServer(app);
    httpServer.listen(PORT, '0.0.0.0', () => {
      console.log('========================================');
      console.log('GShop Server running on port', PORT);
      console.log('Mode: MONGODB');
      console.log('Features: Auth, Services, Transactions, Jobs');
      console.log('========================================');
    });
  })
  .catch(err => {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  });
