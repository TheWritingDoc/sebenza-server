const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  requesterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  providerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  serviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', default: null },
  jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', default: null }, // Link to job for idempotency
  // Changed from credits to randAmount
  randAmount: { type: Number, required: true },
  status: { 
    type: String, 
    enum: ['pending', 'accepted', 'in_progress', 'completed', 'cancelled', 'disputed'],
    default: 'pending'
  },
  escrowStatus: {
    type: String,
    enum: ['held', 'released', 'refunded', 'none'],
    default: 'held'
  },
  // NEW: Job description images (uploaded when requesting - showing what needs to be done)
  jobDescriptionImages: [{ 
    url: String,
    caption: String,
    uploadedAt: { type: Date, default: Date.now }
  }],
  // Proof images from completed work
  proofImages: [{ 
    url: String,
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    uploadedAt: { type: Date, default: Date.now },
    caption: String
  }],
  requesterRating: { type: Number, min: 1, max: 5 },
  providerRating: { type: Number, min: 1, max: 5 },
  requesterReview: { type: String },
  providerReview: { type: String },
  // Negotiation & Payment
  negotiatedAmount: { type: Number }, // Final agreed price after negotiation
  paymentMethod: { type: String, enum: ['escrow', 'cash'], default: 'cash' }, // cash = face-to-face (default), escrow = in-app
  negotiationHistory: [{
    proposedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    amount: Number,
    status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
    createdAt: { type: Date, default: Date.now }
  }],
  // Location for GPS navigation
  location: {
    lat: { type: Number },
    lng: { type: Number }
  },
  completedAt: { type: Date },
  // Partial escrow release (up to 50% released after QR handshake)
  partialReleaseAmount: { type: Number, default: 0 },
  partialReleasedAt: { type: Date },
  partialReleasedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now }
});

// Performance indexes for common lookups
transactionSchema.index({ requesterId: 1, status: 1, createdAt: -1 });
transactionSchema.index({ providerId: 1, status: 1, createdAt: -1 });
transactionSchema.index({ serviceId: 1 });
transactionSchema.index({ jobId: 1 }); // For idempotent escrow lookups

module.exports = mongoose.model('Transaction', transactionSchema);
