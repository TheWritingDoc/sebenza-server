const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  phone: { type: String },
  role: { type: String, enum: ['client', 'provider', 'admin'], default: 'client' },
  location: {
    type: { type: String, default: 'Point', enum: ['Point'] },
    coordinates: { type: [Number], default: [0, 0] },  // [lng, lat]
    lat: { type: Number, default: 0 },  // Convenience field
    lng: { type: Number, default: 0 }   // Convenience field
  },
  avatar: { type: String, default: '' },
  credits: { type: Number, default: 1000 },
  randBalance: { type: Number, default: 1000 },
  escrowRand: { type: Number, default: 0 },
  totalEarnedRand: { type: Number, default: 0 },
  bankAccount: {
    accountNumber: { type: String, default: '' },
    bankName: { type: String, default: '' },
    accountHolder: { type: String, default: '' }
  },
  rating: { type: Number, default: 0 }, // Legacy: now use communityStats.receivedRatingsAvg
  verified: { type: Boolean, default: false },
  phoneVerified: { type: Boolean, default: false },
  profileImage: { type: String, default: '' },
  isOnline: { type: Boolean, default: true },
  lastActive: { type: Date, default: Date.now },
  showOnlineStatus: { type: Boolean, default: true },
  primaryCategory: { type: String, default: '' },
  freeServiceUsed: { type: Boolean, default: false },
  paidProfileViews: [{
    serviceId: { type: String },
    providerId: { type: String },
    amount: { type: Number },
    paidAt: { type: Date, default: Date.now }
  }],
  portfolioImages: [{
    url: { type: String },
    caption: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now }
  }],
  skills: [{ type: String }],  // Skills array for workers
  services: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Service' }],

  // Community-first rating system
  communityStats: {
    reliabilityScore: { type: Number, default: 100, min: 0, max: 100 },
    givenRatingsAvg: { type: Number, default: 0 },
    receivedRatingsAvg: { type: Number, default: 0 },
    totalGivenReviews: { type: Number, default: 0 },
    totalReceivedReviews: { type: Number, default: 0 },
    complainerScore: { type: Number, default: 0, min: 0, max: 100 },
    completionRate: { type: Number, default: 100 },
    cancellationRate: { type: Number, default: 0 },
    disputeRate: { type: Number, default: 0 },
    jobsCompleted: { type: Number, default: 0 },
    jobsRequested: { type: Number, default: 0 },
    timeWasterFlags: { type: Number, default: 0 },
    providerLateFlags: { type: Number, default: 0 },
    impatientFlags: { type: Number, default: 0 }
  },

  flags: [{
    type: { type: String, enum: ['low_reliability', 'high_complainer', 'suspicious_activity', 'multiple_disputes', 'poor_performance'] },
    reason: { type: String },
    createdAt: { type: Date, default: Date.now },
    resolved: { type: Boolean, default: false },
    resolvedAt: { type: Date }
  }],

  // Saved services / business cards
  savedServices: [{
    serviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true },
    savedAt: { type: Date, default: Date.now },
    notes: { type: String, default: '' }
  }],

  // Recommendations sent (for tracking clientele building)
  recommendationsSent: [{
    serviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Service' },
    recipientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    message: { type: String, default: '' },
    sentAt: { type: Date, default: Date.now }
  }],

  // Referral system
  referralCode: { type: String, unique: true, sparse: true, index: true },
  referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  referralCount: { type: Number, default: 0 },

  // Email verification
  emailVerified: { type: Boolean, default: false },
  emailVerificationToken: { type: String },
  emailVerificationExpires: { type: Date },

  // Session management
  lastLoginAt: { type: Date },
  loginAttempts: { type: Number, default: 0 },
  lockUntil: { type: Date },

  // Professional service terms & conditions
  professionalServiceTCAccepted: { type: Boolean, default: false },
  professionalServiceTCAcceptedAt: { type: Date },

  // Account type: individual user, small team, or professional business
  accountType: { type: String, enum: ['individual', 'team', 'business'], default: 'individual' },
  businessName: { type: String, default: '' },   // team or business display name
  teamSize: { type: Number, default: 1 },

  // Identity trust stars (0–5) — computed by utils/trustScore from the
  // verifications/documents below. SEPARATE from review performance. Cached
  // here so job cards / map pins / profiles can show them without recomputing.
  trustStars: { type: Number, default: 0.5, min: 0, max: 5 },
  trustScore: { type: Number, default: 10, min: 0, max: 100 },
  trustLevel: { type: String, default: 'New Neighbour' },

  // Trust documents — each upload raises the user's identity trust score
  trustDocs: [{
    docType: { type: String, enum: ['address', 'id', 'drivers_license', 'qualification', 'experience'], required: true },
    title: { type: String, default: '' },
    fileUrl: { type: String, default: '' },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    uploadedAt: { type: Date, default: Date.now }
  }],

  // Community recommendations ("I vouch for this person"). One per endorser.
  endorsedBy: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    at: { type: Date, default: Date.now }
  }],

  // Work experience entries (no document required)
  workExperience: [{
    title: { type: String, required: true },
    place: { type: String, default: '' },
    years: { type: String, default: '' },
    addedAt: { type: Date, default: Date.now }
  }],

  createdAt: { type: Date, default: Date.now }
});

// Geospatial index for location-based queries
userSchema.index({ location: '2dsphere' });
userSchema.index({ email: 1 });
userSchema.index({ role: 1, primaryCategory: 1 });
userSchema.index({ 'communityStats.jobsCompleted': -1 });
userSchema.index({ isOnline: 1, lastActive: -1 });

userSchema.methods.validPassword = function(password) {
  return password.length >= 6;
};

module.exports = mongoose.model('User', userSchema);