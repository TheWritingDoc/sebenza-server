const mongoose = require('mongoose');

// Dynamic schema that works with both ObjectId (MongoDB) and String (Demo mode)
const serviceSchema = new mongoose.Schema({
  providerId: { 
    type: mongoose.Schema.Types.Mixed, 
    required: true,
    
  },
  title: { type: String, required: true },
  description: { type: String, required: true },
  category: { type: String, required: true },
  randAmount: { type: Number, required: true },
  location: {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true }
  },
  available: { type: Boolean, default: true },
  mapPinLocked: { type: Boolean, default: true },
  mapVisibility: { type: String, enum: ['public', 'hidden'], default: 'public' },
  pricingType: { type: String, enum: ['fixed', 'quote'], default: 'fixed' },
  scheduledDate: { type: Date },
  estimatedDuration: { type: String },
  tags: [{ type: String }],
  images: [{
    url: String,
    caption: { type: String, default: '' },
    uploadedAt: { type: Date, default: Date.now }
  }],
  profileViewFee: { type: Number, default: 0, min: 0, max: 50 },
  completedJobsCount: { type: Number, default: 0 },
  averageRating: { type: Number, default: 0 },
  totalReviews: { type: Number, default: 0 },
  ratingBreakdown: {
    1: { type: Number, default: 0 },
    2: { type: Number, default: 0 },
    3: { type: Number, default: 0 },
    4: { type: Number, default: 0 },
    5: { type: Number, default: 0 }
  },
  createdAt: { type: Date, default: Date.now }
});

// Performance indexes
serviceSchema.index({ providerId: 1, available: 1, createdAt: -1 });
serviceSchema.index({ category: 1, available: 1 });
serviceSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('Service', serviceSchema);
