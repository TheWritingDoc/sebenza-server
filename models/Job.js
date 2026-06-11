const mongoose = require('mongoose');

const negotiationEntrySchema = new mongoose.Schema({
  proposedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amount: { type: Number, required: true },
  proposedTime: { type: Date },
  message: { type: String, default: '', maxlength: 280, trim: true },
  status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
  createdAt: { type: Date, default: Date.now }
});

const applicationSchema = new mongoose.Schema({
  applicantId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  proposedAmount: { type: Number, required: true },
  proposedTime: { type: Date },
  timeAdjustment: { type: Date },
  approvedTime: { type: Date },
  approvedAmount: { type: Number },
  message: { type: String, default: '', maxlength: 500, trim: true },
  status: { type: String, enum: ['pending', 'negotiating', 'approved', 'accepted', 'rejected', 'withdrawn'], default: 'pending' },
  negotiationHistory: [negotiationEntrySchema],
  pingCount: { type: Number, default: 0 },
  autoPingSent: { type: Boolean, default: false },
  firstPingAt: { type: Date },
  lastPingAt: { type: Date },
  pingLog: [{
    type: { type: String, enum: ['manual', 'auto', 'poster_reminder'] },
    sentAt: { type: Date, default: Date.now }
  }],
  createdAt: { type: Date, default: Date.now }
});

// Compound index to prevent duplicate applications from the same user on the same job
applicationSchema.index({ applicantId: 1, _id: 1 }, { unique: false }); // per-job uniqueness enforced at application level via job.applications

const jobSchema = new mongoose.Schema({
  // ...
  posterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true, maxlength: 120, trim: true },
  description: { type: String, required: true, maxlength: 5000, trim: true },
  category: { type: String, required: true, maxlength: 60, trim: true },
  budget: { type: Number, required: true }, // Initial budget posted by client (legacy / fallback)
  budgetMin: { type: Number },
  budgetMax: { type: Number },
  isUrgent: { type: Boolean, default: false },
  location: {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true }
  },
  images: [{
    url: String,
    caption: { type: String, default: '' },
    uploadedAt: { type: Date, default: Date.now }
  }],
  status: {
    type: String,
    enum: ['open', 'negotiating', 'approved', 'accepted', 'in_progress', 'pending_review', 'pending_payment', 'completed', 'cancelled'],
    default: 'open'
  },
  applications: [applicationSchema],
  acceptedApplicationId: { type: mongoose.Schema.Types.ObjectId, default: null },
  transactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', default: null },
  paymentMethod: { type: String, enum: ['escrow', 'cash'], default: 'cash' },
  scheduledDate: { type: Date },
  proposedTime: { type: Date },
  timeIsNegotiable: { type: Boolean, default: true },
  applicationDeadline: { type: Date },
  publishAt: { type: Date }, // When the job becomes visible (for pre-posted jobs)
  expiresAt: { type: Date },
  estimatedDuration: { type: String, maxlength: 50 },
  tags: [{ type: String, maxlength: 30 }],
  workProofPhotos: [{
    url: String,
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    stage: { type: String, enum: ['before', 'during', 'after'], default: 'during' },
    note: { type: String, default: '', maxlength: 280, trim: true },
    location: { lat: Number, lng: Number },
    uploadedAt: { type: Date, default: Date.now }
  }],
  completionRequest: {
    initiatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    initiatorPhotos: [{
      url: String,
      lat: Number,
      lng: Number,
      uploadedAt: { type: Date, default: Date.now }
    }],
    status: { type: String, enum: ['pending', 'confirmed'] },
    createdAt: { type: Date }
  },
  startedAt: { type: Date },
  completedAt: { type: Date },
  posterReviewed: { type: Boolean, default: false },
  providerReviewed: { type: Boolean, default: false },
  posterReview: {
    overallRating: { type: Number, min: 1, max: 5 },
    comment: { type: String, maxlength: 2000, trim: true },
    createdAt: { type: Date }
  },
  providerReview: {
    overallRating: { type: Number, min: 1, max: 5 },
    comment: { type: String, maxlength: 2000, trim: true },
    createdAt: { type: Date }
  },
  handshakeLog: [{
    event: { type: String },
    posterDistanceKm: { type: Number },
    providerDistanceKm: { type: Number },
    posterLocation: { lat: Number, lng: Number },
    providerLocation: { lat: Number, lng: Number },
    triggeredAt: { type: Date, default: Date.now }
  }],
  qrHandshakes: [{
    scannerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    scannedId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    method: { type: String, default: 'qr_scan' },
    scannedAt: { type: Date, default: Date.now }
  }],
  paymentConfirmed: { type: Boolean, default: false },
  paymentConfirmedAt: { type: Date },
  paymentConfirmedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  // Partial escrow release tracking
  partialEscrowReleased: { type: Boolean, default: false },
  partialEscrowAmount: { type: Number, default: 0 },
  partialEscrowReleasedAt: { type: Date },
  paymentWaitTimeMinutes: { type: Number },
  issueReports: [{
    reporterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: ['issue', 'stop_request'], default: 'issue' },
    note: { type: String, default: '', maxlength: 1200, trim: true },
    photos: [{
      url: String,
      uploadedAt: { type: Date, default: Date.now }
    }],
    createdAt: { type: Date, default: Date.now }
  }],
  stoppedAt: { type: Date },
  stoppedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  // Timing tracking for job lifecycle
  helperCompletedAt: { type: Date },
  posterConfirmedAt: { type: Date },
  helperCompletionDurationMinutes: { type: Number },
  posterConfirmationDurationMinutes: { type: Number },
  // Poster-controlled permission for provider fallback start (within 20m)
  manualStartAllowedByPoster: { type: Boolean, default: false },
  manualStartPermissionAt: { type: Date },
  manualStartPermissionBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now }
});

// Performance indexes for common query patterns
jobSchema.index({ posterId: 1, status: 1, createdAt: -1 });        // my-jobs
jobSchema.index({ 'applications.applicantId': 1, status: 1 });     // my-applications
jobSchema.index({ status: 1, category: 1, createdAt: -1 });        // browse jobs
jobSchema.index({ location: '2dsphere' });                         // geo-distance queries
jobSchema.index({ transactionId: 1 });                             // escrow lookups
jobSchema.index({ acceptedApplicationId: 1 });                     // provider lookups

module.exports = mongoose.model('Job', jobSchema);
