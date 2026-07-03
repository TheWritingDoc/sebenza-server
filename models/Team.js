const mongoose = require('mongoose');

/**
 * A Team/Business is a group of workers operating under one supervisor.
 * The supervisor is the account that created it (accountType team|business).
 * Members are individual User accounts linked in — invited by email/phone, then
 * accepted. This is how "multiple users work under one supervision" is modelled.
 */
const teamSchema = new mongoose.Schema({
  supervisorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, maxlength: 120, trim: true },
  type: { type: String, enum: ['team', 'business'], default: 'team' },
  description: { type: String, default: '', maxlength: 500, trim: true },

  members: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // null while invite is pending on an unknown email
    inviteEmail: { type: String, default: '' },
    invitePhone: { type: String, default: '' },
    name: { type: String, default: '' },
    role: { type: String, enum: ['member', 'lead'], default: 'member' },
    status: { type: String, enum: ['invited', 'active', 'declined', 'removed'], default: 'invited' },
    invitedAt: { type: Date, default: Date.now },
    joinedAt: { type: Date }
  }],

  // Business location for the always-on map pin (Phase 6)
  location: { lat: Number, lng: Number },
  mapVisible: { type: Boolean, default: true },

  createdAt: { type: Date, default: Date.now }
});

teamSchema.index({ 'members.userId': 1 });

// Convenience: count of active members (excludes supervisor).
teamSchema.virtual('activeMemberCount').get(function () {
  return (this.members || []).filter(m => m.status === 'active').length;
});

module.exports = mongoose.model('Team', teamSchema);
