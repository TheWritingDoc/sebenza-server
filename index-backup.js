const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/gshop';

mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// User Schema
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  phone: { type: String, required: true },
  password: { type: String, required: true },
  location: {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true }
  },
  skills: [{ type: String }],
  credits: { type: Number, default: 10 },
  rating: { type: Number, default: 5 },
  verified: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

// Service Schema
const serviceSchema = new mongoose.Schema({
  providerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  description: { type: String, required: true },
  category: { type: String, required: true },
  credits: { type: Number, required: true },
  location: {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true }
  },
  available: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

// Transaction Schema
const transactionSchema = new mongoose.Schema({
  requesterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  providerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  serviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true },
  credits: { type: Number, required: true },
  status: { 
    type: String, 
    enum: ['pending', 'accepted', 'completed', 'cancelled'],
    default: 'pending'
  },
  rating: { type: Number, default: 0 },
  review: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  completedAt: { type: Date }
});

const User = mongoose.model('User', userSchema);
const Service = mongoose.model('Service', serviceSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'gshop-secret-key-2026';

// Authentication Middleware
const auth = (req, res, next) => {
  const token = req.header('x-auth-token');
  if (!token) return res.status(401).json({ message: 'No token, authorization denied' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ message: 'Token is not valid' });
  }
};

// Haversine formula for distance calculation
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Routes

// Register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, phone, password, location, skills } = req.body;

    // Check if user exists
    let user = await User.findOne({ email });
    if (user) return res.status(400).json({ message: 'User already exists' });

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create user
    user = new User({
      name,
      email,
      phone,
      password: hashedPassword,
      location,
      skills,
      credits: 10 // Starter credits
    });

    await user.save();

    // Generate JWT
    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        credits: user.credits,
        location: user.location
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: 'Invalid credentials' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: 'Invalid credentials' });

    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        credits: user.credits,
        location: user.location
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get current user
app.get('/api/auth/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Get nearby services
app.get('/api/services/nearby', auth, async (req, res) => {
  try {
    const { lat, lng, radius = 10 } = req.query;
    const userId = req.user.id;

    const services = await Service.find({ available: true })
      .populate('providerId', 'name rating location')
      .lean();

    // Calculate distance and filter
    const nearbyServices = services
      .map(service => {
        const distance = calculateDistance(
          parseFloat(lat),
          parseFloat(lng),
          service.location.lat,
          service.location.lng
        );
        return { ...service, distance };
      })
      .filter(service => service.distance <= radius && service.providerId._id.toString() !== userId)
      .sort((a, b) => a.distance - b.distance);

    res.json(nearbyServices);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create service
app.post('/api/services', auth, async (req, res) => {
  try {
    const { title, description, category, credits } = req.body;
    const user = await User.findById(req.user.id);

    const service = new Service({
      providerId: req.user.id,
      title,
      description,
      category,
      credits,
      location: user.location
    });

    await service.save();
    res.json(service);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Request service
app.post('/api/transactions/request', auth, async (req, res) => {
  try {
    const { serviceId } = req.body;
    const requesterId = req.user.id;

    const service = await Service.findById(serviceId);
    if (!service) return res.status(404).json({ message: 'Service not found' });

    const requester = await User.findById(requesterId);
    if (requester.credits < service.credits) {
      return res.status(400).json({ message: 'Insufficient credits' });
    }

    const transaction = new Transaction({
      requesterId,
      providerId: service.providerId,
      serviceId,
      credits: service.credits
    });

    await transaction.save();
    res.json(transaction);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Accept transaction
app.put('/api/transactions/:id/accept', auth, async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.id);
    if (!transaction) return res.status(404).json({ message: 'Transaction not found' });

    if (transaction.providerId.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    transaction.status = 'accepted';
    await transaction.save();

    res.json(transaction);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Complete transaction
app.put('/api/transactions/:id/complete', auth, async (req, res) => {
  try {
    const { rating, review } = req.body;
    const transaction = await Transaction.findById(req.params.id);
    if (!transaction) return res.status(404).json({ message: 'Transaction not found' });

    if (transaction.status !== 'accepted') {
      return res.status(400).json({ message: 'Transaction not accepted yet' });
    }

    // Transfer credits
    const requester = await User.findById(transaction.requesterId);
    const provider = await User.findById(transaction.providerId);

    if (requester.credits < transaction.credits) {
      return res.status(400).json({ message: 'Insufficient credits' });
    }

    requester.credits -= transaction.credits;
    provider.credits += transaction.credits;

    await requester.save();
    await provider.save();

    transaction.status = 'completed';
    transaction.rating = rating;
    transaction.review = review;
    transaction.completedAt = new Date();
    await transaction.save();

    res.json({ transaction, requesterCredits: requester.credits });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get user transactions
app.get('/api/transactions', auth, async (req, res) => {
  try {
    const transactions = await Transaction.find({
      $or: [{ requesterId: req.user.id }, { providerId: req.user.id }]
    })
    .populate('requesterId providerId serviceId')
    .sort({ createdAt: -1 });

    res.json(transactions);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Get categories
app.get('/api/categories', (req, res) => {
  const categories = [
    'Plumbing', 'Electrical', 'Carpentry', 'Painting', 'Cleaning',
    'Gardening', 'Cooking', 'Tutoring', 'Computer Repair', 'Sewing',
    'Driving', 'Babysitting', 'Elderly Care', 'Pet Care', 'Other'
  ];
  res.json(categories);
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`🚀 GShop Server running on port ${PORT}`);
});
