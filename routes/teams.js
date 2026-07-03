const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Team = require('../models/Team');
const User = require('../models/User');
const { sendNotification } = require('../utils/notifications');

const auth = (req, res, next) => {
  const token = (req.headers.authorization || '').split(' ')[1];
  if (!token || token === 'null' || token === 'undefined') {
    return res.status(401).json({ error: 'No token provided' });
  }
  try {
    req.userId = jwt.verify(token, process.env.JWT_SECRET).userId;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    return res.status(401).json({ error: 'Invalid token', code: 'TOKEN_INVALID' });
  }
};

function notify(req, userId, payload) {
  const io = req.app.get('io');
  const onlineUsers = req.app.get('onlineUsers');
  return sendNotification(io, onlineUsers, userId, payload).catch(() => {});
}

function teamDTO(team) {
  const t = team.toObject ? team.toObject() : team;
  t.activeMemberCount = (t.members || []).filter(m => m.status === 'active').length;
  return t;
}

// Create the team I supervise (one per supervisor). Marks me as supervisor.
router.post('/', auth, async (req, res) => {
  try {
    const { name, type, description } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Team name is required' });

    const existing = await Team.findOne({ supervisorId: req.userId });
    if (existing) return res.status(400).json({ error: 'You already have a team', team: teamDTO(existing) });

    const user = await User.findById(req.userId).select('location businessName');
    const team = await Team.create({
      supervisorId: req.userId,
      name: name.trim().slice(0, 120),
      type: type === 'business' ? 'business' : 'team',
      description: (description || '').slice(0, 500),
      location: user?.location ? { lat: user.location.lat, lng: user.location.lng } : undefined,
    });

    await User.findByIdAndUpdate(req.userId, {
      teamId: team._id,
      teamRole: 'supervisor',
      accountType: team.type,
      businessName: name.trim().slice(0, 120),
    });

    res.status(201).json({ message: 'Team created', team: teamDTO(team) });
  } catch (err) {
    console.error('Create team error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// The team I supervise OR belong to, with member profiles resolved.
router.get('/mine', auth, async (req, res) => {
  try {
    let team = await Team.findOne({ supervisorId: req.userId })
      .populate('members.userId', 'name profileImage avatar trustStars trustLevel verified communityStats');
    let role = 'supervisor';
    if (!team) {
      team = await Team.findOne({ 'members.userId': req.userId, 'members.status': 'active' })
        .populate('supervisorId', 'name profileImage avatar trustStars verified businessName')
        .populate('members.userId', 'name profileImage avatar trustStars verified');
      role = 'member';
    }
    if (!team) return res.json({ team: null });
    res.json({ team: teamDTO(team), role });
  } catch (err) {
    console.error('Get team error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Supervisor invites a worker by email (links an existing user, or holds a
// pending invite on the email until they register).
router.post('/invite', auth, async (req, res) => {
  try {
    const { email, phone } = req.body;
    const team = await Team.findOne({ supervisorId: req.userId });
    if (!team) return res.status(400).json({ error: 'Create your team first' });
    const contact = (email || '').toLowerCase().trim();
    if (!contact && !phone) return res.status(400).json({ error: 'An email or phone is required to invite' });

    const invitee = contact
      ? await User.findOne({ email: contact }).select('_id name teamId')
      : await User.findOne({ phone }).select('_id name teamId');

    if (invitee && String(invitee._id) === String(req.userId)) {
      return res.status(400).json({ error: "You're the supervisor — you can't invite yourself" });
    }
    if (invitee && invitee.teamId) {
      return res.status(400).json({ error: 'That person is already in a team' });
    }
    // Prevent duplicate pending invites
    const dup = team.members.find(m =>
      (invitee && String(m.userId) === String(invitee._id)) ||
      (contact && m.inviteEmail === contact)
    );
    if (dup && dup.status === 'invited') return res.status(400).json({ error: 'Already invited' });

    team.members.push({
      userId: invitee?._id || undefined,
      inviteEmail: contact,
      invitePhone: phone || '',
      name: invitee?.name || '',
      status: 'invited',
      invitedAt: new Date(),
    });
    await team.save();

    if (invitee) {
      notify(req, invitee._id, {
        type: 'team_invite',
        title: 'Team Invitation 🤝',
        message: `You've been invited to join "${team.name}". Open Your Team to accept.`,
      });
    }
    res.json({ message: invitee ? 'Invitation sent' : 'Invitation saved — they will see it when they register', team: teamDTO(team) });
  } catch (err) {
    console.error('Invite error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Invites addressed to me (by linked account or my email)
router.get('/invites', auth, async (req, res) => {
  try {
    const me = await User.findById(req.userId).select('email');
    const teams = await Team.find({
      $or: [
        { members: { $elemMatch: { userId: req.userId, status: 'invited' } } },
        { members: { $elemMatch: { inviteEmail: me?.email, status: 'invited' } } },
      ],
    }).populate('supervisorId', 'name businessName profileImage trustStars verified').select('name type supervisorId members');
    const invites = teams.map(t => ({ teamId: t._id, name: t.name, type: t.type, supervisor: t.supervisorId }));
    res.json({ invites });
  } catch (err) {
    console.error('Get invites error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Accept / decline an invitation
router.post('/:id/respond', auth, async (req, res) => {
  try {
    const { accept } = req.body;
    const team = await Team.findById(req.params.id);
    if (!team) return res.status(404).json({ error: 'Team not found' });

    const me = await User.findById(req.userId).select('email name teamId');
    if (me.teamId && accept) return res.status(400).json({ error: 'You are already in a team' });

    const member = team.members.find(m =>
      (m.userId && String(m.userId) === String(req.userId)) ||
      (m.inviteEmail && m.inviteEmail === me.email)
    );
    if (!member || member.status !== 'invited') return res.status(400).json({ error: 'No pending invite for you' });

    if (accept) {
      member.userId = req.userId;
      member.name = me.name;
      member.status = 'active';
      member.joinedAt = new Date();
      await team.save();
      await User.findByIdAndUpdate(req.userId, { teamId: team._id, teamRole: 'member' });
      notify(req, team.supervisorId, {
        type: 'team_joined',
        title: 'New Team Member ✅',
        message: `${me.name} joined "${team.name}".`,
      });
      return res.json({ message: `You joined ${team.name}`, team: teamDTO(team) });
    } else {
      member.status = 'declined';
      await team.save();
      return res.json({ message: 'Invitation declined' });
    }
  } catch (err) {
    console.error('Respond invite error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Supervisor removes a member
router.post('/:id/remove-member', auth, async (req, res) => {
  try {
    const { memberUserId } = req.body;
    const team = await Team.findOne({ _id: req.params.id, supervisorId: req.userId });
    if (!team) return res.status(404).json({ error: 'Team not found or not yours' });
    const member = team.members.find(m => String(m.userId) === String(memberUserId));
    if (!member) return res.status(404).json({ error: 'Member not found' });
    member.status = 'removed';
    await team.save();
    await User.findByIdAndUpdate(memberUserId, { teamId: null, teamRole: null });
    notify(req, memberUserId, { type: 'team_removed', title: 'Team Update', message: `You were removed from "${team.name}".` });
    res.json({ message: 'Member removed', team: teamDTO(team) });
  } catch (err) {
    console.error('Remove member error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Member leaves the team
router.post('/:id/leave', auth, async (req, res) => {
  try {
    const team = await Team.findById(req.params.id);
    if (!team) return res.status(404).json({ error: 'Team not found' });
    const member = team.members.find(m => String(m.userId) === String(req.userId) && m.status === 'active');
    if (!member) return res.status(400).json({ error: 'You are not an active member' });
    member.status = 'removed';
    await team.save();
    await User.findByIdAndUpdate(req.userId, { teamId: null, teamRole: null });
    notify(req, team.supervisorId, { type: 'team_left', title: 'Team Update', message: `A member left "${team.name}".` });
    res.json({ message: 'You left the team' });
  } catch (err) {
    console.error('Leave team error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
