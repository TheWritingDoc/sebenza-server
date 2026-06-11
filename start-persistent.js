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
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', mode: 'MONGODB', time: new Date().toISOString() });
});

mongoose.connect('mongodb://localhost:27017/gshop')
  .then(() => {
    console.log('MongoDB connected');
    require('./models/User');
    require('./models/Service');
    require('./models/Transaction');
    require('./models/Verification');
    require('./models/SMSVerification');
    require('./models/Message');
    require('./models/Review');
    require('./models/Job');
    console.log('Models loaded');
    
    app.use('/api/verification', require('./routes/verification'));
    app.use('/api/sms', require('./routes/sms'));
    app.use('/api/transactions', require('./routes/transactions'));
    app.use('/api/services', require('./routes/services'));
    app.use('/api/users', require('./routes/users'));
    app.use('/api/messages', require('./routes/messages'));
    app.use('/api/reviews', require('./routes/reviews'));
    app.use('/api/jobs', require('./routes/jobs'));
    console.log('Routes loaded');
    
    const httpServer = http.createServer(app);
    httpServer.listen(PORT, '0.0.0.0', () => {
      console.log('SERVER_READY');
      console.log('Port:', PORT);
    });
  })
  .catch(err => {
    console.error('Failed:', err.message);
    process.exit(1);
  });
