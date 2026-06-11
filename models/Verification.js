const mongoose = require('mongoose');

const verificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  idFront: { type: String, required: true },
  idBack: { type: String, required: true },
  selfie: { type: String, required: true },
  idNumber: { type: String },
  verified: { type: Boolean, default: false },
  verifiedAt: { type: Date },
  submittedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Verification', verificationSchema);
