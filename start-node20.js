const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const PORT = 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'gshop-production-secret-key-2026';

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Serve static files from React build
app.use(express.static(path.join(__dirname, 'client_build')));

// Health endpoint
app.get('/api/health', async (req, res) => {
  try {
    const User = mongoose.model('User');
    const Job = mongoose.model('Job');
    const Service = mongoose.model('Service');
    
    const [userCount, jobCount, serviceCount] = await Promise.all([
      User.countDocuments(),
      Job.countDocuments(),
      Service.countDocuments()
    ]);
    
    res.json({
      status: 'ok',
      mode: 'MONGODB',
      time: new Date().toISOString(),
      stats: {
        users: userCount,
        services: serviceCount,
        transactions: jobCount
      }
    });
  } catch (err) {
    res.json({ status: 'ok', mode: 'MONGODB', time: new Date().toISOString() });
  }
});

// Login endpoint (required for mobile app)
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const User = mongoose.model('User');
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ userId: user._id.toString() }, JWT_SECRET, { expiresIn: '30d' });
    res.json({
      token,
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        phone: user.phone,
        randBalance: user.randBalance || 0,
        escrowRand: user.escrowRand || 0,
        totalEarnedRand: user.totalEarnedRand || 0,
        skills: user.skills || [],
        primaryCategory: user.primaryCategory,
        verified: user.verified || false,
        phoneVerified: user.phoneVerified || false,
        emailVerified: user.emailVerified || false
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});

// Register endpoint (required for mobile app)
app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password, phone, location, primaryCategory, skills, referralCode } = req.body;
    const User = mongoose.model('User');
    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ error: 'Email already registered' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({
      name,
      email,
      password: hashedPassword,
      phone,
      location,
      primaryCategory,
      skills: skills || [],
      referralCode,
      randBalance: 0,
      escrowRand: 0,
      totalEarnedRand: 0
    });
    await newUser.save();
    const token = jwt.sign({ userId: newUser._id.toString() }, JWT_SECRET, { expiresIn: '30d' });
    res.status(201).json({
      token,
      user: {
        id: newUser._id.toString(),
        name: newUser.name,
        email: newUser.email,
        phone: newUser.phone,
        randBalance: 0,
        escrowRand: 0,
        totalEarnedRand: 0,
        skills: newUser.skills || [],
        primaryCategory: newUser.primaryCategory,
        verified: false,
        phoneVerified: false,
        emailVerified: false
      }
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
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
    require('./models/Notification');
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
    
    // Serve React app for all other routes
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'client_build', 'index.html'));
    });
    
    const httpServer = http.createServer(app);
    
    // ─── Socket.IO Setup ───
    const io = new Server(httpServer, {
      cors: {
        origin: (origin, callback) => {
          if (!origin) return callback(null, true);
          if (origin.includes('localhost') || origin.includes('ngrok-free.dev') || origin.includes('ngrok.io')) {
            return callback(null, true);
          }
          callback(null, true);
        },
        methods: ['GET', 'POST'],
        credentials: true
      }
    });
    
    // Track online users
    const onlineUsers = new Map();
    app.set('io', io);
    app.set('onlineUsers', onlineUsers);
    
    io.on('connection', (socket) => {
      console.log('Client connected:', socket.id);
      
      socket.on('register', (userId) => {
        onlineUsers.set(String(userId), socket.id);
        socket.userId = String(userId);
        console.log(`User ${userId} registered with socket ${socket.id}`);
      });
      
      socket.on('user_online', async (userId) => {
        onlineUsers.set(userId, socket.id);
        socket.userId = userId;
        try {
          const User = mongoose.model('User');
          await User.findByIdAndUpdate(userId, { isOnline: true, lastActive: new Date() });
        } catch (err) {
          console.error('user_online DB error:', err.message);
        }
        socket.broadcast.emit('user_status_changed', { userId, isOnline: true });
      });
      
      socket.on('user_away', async (userId) => {
        try {
          const User = mongoose.model('User');
          await User.findByIdAndUpdate(userId, { isOnline: false, lastActive: new Date() });
        } catch (err) {
          console.error('user_away DB error:', err.message);
        }
        socket.broadcast.emit('user_status_changed', { userId, isOnline: false });
      });
      
      socket.on('join_chat', (transactionId) => {
        socket.join(`chat_${transactionId}`);
      });
      
      socket.on('send_message', async (data) => {
        const { transactionId, senderId, receiverId, text, type, offerAmount } = data;
        let savedMessage = null;
        try {
          const Message = mongoose.model('Message');
          const message = new Message({
            transactionId,
            senderId,
            receiverId,
            text,
            type: type || 'text',
            offerAmount
          });
          savedMessage = await message.save();
        } catch (err) {
          console.error('Save message error:', err);
        }
        const msgPayload = {
          _id: savedMessage?._id?.toString(),
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
      
      socket.on('disconnect', async () => {
        console.log('Client disconnected:', socket.id);
        if (socket.userId) {
          onlineUsers.delete(socket.userId);
          try {
            const User = mongoose.model('User');
            await User.findByIdAndUpdate(socket.userId, { isOnline: false, lastActive: new Date() });
          } catch (err) {
            console.error('disconnect DB error:', err.message);
          }
          socket.broadcast.emit('user_status_changed', { userId: socket.userId, isOnline: false });
        }
      });
    });
    
    httpServer.listen(PORT, '0.0.0.0', () => {
      console.log('========================================');
      console.log('GShop Server running on port', PORT);
      console.log('Mode: MONGODB + Socket.IO');
      console.log('Features: Auth, Services, Transactions, Image Upload, Jobs, Real-time Notifications, Chat');
      console.log('========================================');
    });
  })
  .catch(err => {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  });
