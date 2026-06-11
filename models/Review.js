const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  transactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', index: true },
  jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', index: true },
  reviewerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  revieweeId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  serviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Service' },

  // Category ratings — helps identify specific strengths/growth areas
  categories: {
    punctuality: { type: Number, min: 1, max: 5 },
    quality: { type: Number, min: 1, max: 5 },
    communication: { type: Number, min: 1, max: 5 },
    respect: { type: Number, min: 1, max: 5 }
  },

  overallRating: { type: Number, min: 1, max: 5, required: true },
  comment: { type: String, maxlength: 1000 },

  // If rating <= 2, require constructive comment
  isConstructive: { type: Boolean, default: false },

  // Meta
  isVisible: { type: Boolean, default: true },
  moderatedAt: { type: Date },
  moderationReason: { type: String },

  createdAt: { type: Date, default: Date.now }
});

// Indexes for fast lookups
reviewSchema.index({ revieweeId: 1, createdAt: -1 });
reviewSchema.index({ reviewerId: 1, createdAt: -1 });
reviewSchema.index({ serviceId: 1, createdAt: -1 });
reviewSchema.index({ transactionId: 1 });

module.exports = mongoose.model('Review', reviewSchema);
