const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { prisma } = require('../db');
const { toDTO, sanitizeUser, isId } = require('../utils/dto');
const { sendNotification } = require('../utils/notifications');
const { CODE_TTL_MS, genTeamCode, buildQrPayload, parseQrPayload, isCodeValid } = require('../utils/teamQr');

const { auth } = require('../middleware/authToken');

function notify(req, userId, payload) {
  const io = req.app.get('io');
  const onlineUsers = req.app.get('onlineUsers');
  return sendNotification(io, onlineUsers, userId, payload).catch(() => {});
}

// Shim so isCodeValid (still expecting the Mongo qrSession subdoc) can read
// the qrCode/qrExpiresAt columns without editing utils/teamQr.js.
function qrShim(team) {
  return { qrSession: { code: team.qrCode, expiresAt: team.qrExpiresAt } };
}

// Rebuild the Mongo-era team shape the frozen client expects:
// - members[] rows from team_members, each with `userId` = populated user
//   object when the query included it (populate-style), plain id otherwise
// - `supervisorId` = populated supervisor object when included
// - `location: {lat,lng}` instead of flat lat/lng columns
// - activeMemberCount, and NO qr fields leaked (the active check-in code is
//   only returned by POST /:id/qr to the supervisor)
function teamDTO(team) {
  if (!team) return team;
  const { members, supervisor, qrCode, qrExpiresAt, lat, lng, ...rest } = team;
  const t = { ...rest };
  if (supervisor) t.supervisorId = supervisor;
  t.location = { lat: lat ?? null, lng: lng ?? null };
  t.members = (members || []).map(m => {
    const { user, teamId, ...member } = m;
    if (user) member.userId = user;
    return member;
  });
  t.activeMemberCount = t.members.filter(m => m.status === 'active').length;
  return toDTO(t);
}

const memberUserSelect = {
  id: true, name: true, profileImage: true, avatar: true,
  trustStars: true, trustLevel: true, verified: true, communityStats: true,
};

// Create the team I supervise (one per supervisor). Marks me as supervisor.
router.post('/', auth, async (req, res) => {
  try {
    const { name, type, description } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Team name is required' });

    const existing = await prisma.team.findFirst({
      where: { supervisorId: req.userId },
      include: { members: true },
    });
    if (existing) return res.status(400).json({ error: 'You already have a team', team: teamDTO(existing) });

    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { lat: true, lng: true, businessName: true },
    });
    const team = await prisma.team.create({
      data: {
        supervisorId: req.userId,
        name: name.trim().slice(0, 120),
        type: type === 'business' ? 'business' : 'team',
        description: (description || '').slice(0, 500),
        lat: user ? user.lat : null,
        lng: user ? user.lng : null,
      },
      include: { members: true },
    });

    await prisma.user.update({
      where: { id: req.userId },
      data: {
        teamId: team.id,
        teamRole: 'supervisor',
        accountType: team.type,
        businessName: name.trim().slice(0, 120),
      },
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
    let team = await prisma.team.findFirst({
      where: { supervisorId: req.userId },
      include: { members: { include: { user: { select: memberUserSelect } } } },
    });
    let role = 'supervisor';
    if (!team) {
      team = await prisma.team.findFirst({
        where: { members: { some: { userId: req.userId, status: 'active' } } },
        include: {
          supervisor: {
            select: {
              id: true, name: true, profileImage: true, avatar: true,
              trustStars: true, verified: true, businessName: true,
            },
          },
          members: {
            include: {
              user: {
                select: {
                  id: true, name: true, profileImage: true, avatar: true,
                  trustStars: true, verified: true,
                },
              },
            },
          },
        },
      });
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
    const team = await prisma.team.findFirst({
      where: { supervisorId: req.userId },
      include: { members: true },
    });
    if (!team) return res.status(400).json({ error: 'Create your team first' });
    const contact = (email || '').toLowerCase().trim();
    if (!contact && !phone) return res.status(400).json({ error: 'An email or phone is required to invite' });

    const invitee = contact
      ? await prisma.user.findFirst({ where: { email: contact }, select: { id: true, name: true, teamId: true } })
      : await prisma.user.findFirst({ where: { phone }, select: { id: true, name: true, teamId: true } });

    if (invitee && String(invitee.id) === String(req.userId)) {
      return res.status(400).json({ error: "You're the supervisor — you can't invite yourself" });
    }
    if (invitee && invitee.teamId) {
      return res.status(400).json({ error: 'That person is already in a team' });
    }
    // Prevent duplicate pending invites
    const dup = team.members.find(m =>
      (invitee && String(m.userId) === String(invitee.id)) ||
      (contact && m.inviteEmail === contact)
    );
    if (dup && dup.status === 'invited') return res.status(400).json({ error: 'Already invited' });

    await prisma.teamMember.create({
      data: {
        teamId: team.id,
        userId: invitee?.id || null,
        inviteEmail: contact,
        invitePhone: phone || '',
        name: invitee?.name || '',
        status: 'invited',
        invitedAt: new Date(),
      },
    });
    const fresh = await prisma.team.findUnique({ where: { id: team.id }, include: { members: true } });

    if (invitee) {
      notify(req, invitee.id, {
        type: 'team_invite',
        title: 'Team Invitation 🤝',
        message: `You've been invited to join "${team.name}". Open Your Team to accept.`,
      });
    }
    res.json({ message: invitee ? 'Invitation sent' : 'Invitation saved — they will see it when they register', team: teamDTO(fresh) });
  } catch (err) {
    console.error('Invite error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Invites addressed to me (by linked account or my email)
router.get('/invites', auth, async (req, res) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.userId }, select: { email: true } });
    const memberConditions = [{ userId: req.userId, status: 'invited' }];
    if (me?.email) memberConditions.push({ inviteEmail: me.email, status: 'invited' });
    const teams = await prisma.team.findMany({
      where: { OR: memberConditions.map(c => ({ members: { some: c } })) },
      include: {
        supervisor: {
          select: { id: true, name: true, businessName: true, profileImage: true, trustStars: true, verified: true },
        },
      },
    });
    const invites = teams.map(t => ({ teamId: t.id, name: t.name, type: t.type, supervisor: t.supervisor }));
    res.json(toDTO({ invites }));
  } catch (err) {
    console.error('Get invites error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Accept / decline an invitation
router.post('/:id/respond', auth, async (req, res) => {
  try {
    const { accept } = req.body;
    if (!isId(req.params.id)) return res.status(404).json({ error: 'Team not found' });
    const team = await prisma.team.findUnique({
      where: { id: req.params.id },
      include: { members: true },
    });
    if (!team) return res.status(404).json({ error: 'Team not found' });

    const me = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { email: true, name: true, teamId: true },
    });
    if (me.teamId && accept) return res.status(400).json({ error: 'You are already in a team' });

    const member = team.members.find(m =>
      (m.userId && String(m.userId) === String(req.userId)) ||
      (m.inviteEmail && m.inviteEmail === me.email)
    );
    if (!member || member.status !== 'invited') return res.status(400).json({ error: 'No pending invite for you' });

    if (accept) {
      await prisma.teamMember.update({
        where: { id: member.id },
        data: {
          userId: req.userId,
          name: me.name,
          status: 'active',
          joinedAt: new Date(),
        },
      });
      await prisma.user.update({
        where: { id: req.userId },
        data: { teamId: team.id, teamRole: 'member' },
      });
      const fresh = await prisma.team.findUnique({ where: { id: team.id }, include: { members: true } });
      notify(req, team.supervisorId, {
        type: 'team_joined',
        title: 'New Team Member ✅',
        message: `${me.name} joined "${team.name}".`,
      });
      return res.json({ message: `You joined ${team.name}`, team: teamDTO(fresh) });
    } else {
      await prisma.teamMember.update({
        where: { id: member.id },
        data: { status: 'declined' },
      });
      return res.json({ message: 'Invitation declined' });
    }
  } catch (err) {
    console.error('Respond invite error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Supervisor generates a short-lived QR check-in code for on-site confirmation.
router.post('/:id/qr', auth, async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(404).json({ error: 'Team not found or not yours' });
    const team = await prisma.team.findFirst({
      where: { id: req.params.id, supervisorId: req.userId },
    });
    if (!team) return res.status(404).json({ error: 'Team not found or not yours' });

    const code = genTeamCode();
    const expiresAt = new Date(Date.now() + CODE_TTL_MS);
    await prisma.team.update({
      where: { id: team.id },
      data: { qrCode: code, qrExpiresAt: expiresAt },
    });

    res.json({
      code,
      expiresAt,
      payload: buildQrPayload(team.id, code),
      ttlMinutes: Math.round(CODE_TTL_MS / 60000),
    });
  } catch (err) {
    console.error('QR generate error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Member confirms the on-site QR handshake (scanned payload or typed code).
// Optional `role` is a free-text label for what they're doing that day.
router.post('/confirm-qr', auth, async (req, res) => {
  try {
    const parsed = parseQrPayload(req.body.payload || req.body.code || '');
    if (!parsed) return res.status(400).json({ error: 'That QR code is not a Sebenza team code' });

    // Bare typed codes resolve against the team the member belongs to.
    let team = null;
    if (parsed.teamId) {
      if (!isId(String(parsed.teamId))) return res.status(404).json({ error: 'Team not found' });
      team = await prisma.team.findUnique({ where: { id: parsed.teamId } });
    } else {
      const membership = await prisma.teamMember.findFirst({
        where: { userId: req.userId, status: 'active' },
        include: { team: true },
      });
      team = membership?.team || null;
    }
    if (!team) return res.status(404).json({ error: 'Team not found' });

    if (!isCodeValid(qrShim(team), parsed.code)) {
      return res.status(400).json({ error: 'Code is wrong or has expired — ask your supervisor to show a fresh QR' });
    }
    if (String(team.supervisorId) === String(req.userId)) {
      return res.status(400).json({ error: "You're the supervisor — members scan this to confirm they work with you" });
    }

    const member = await prisma.teamMember.findFirst({
      where: { teamId: team.id, userId: req.userId, status: 'active' },
    });
    if (!member) return res.status(403).json({ error: 'Only active team members can confirm. Accept the invite first.' });

    const data = { qrConfirmedAt: new Date() };
    let confirmedRole = member.confirmedRole;
    if (typeof req.body.role === 'string' && req.body.role.trim()) {
      confirmedRole = req.body.role.trim().slice(0, 60);
      data.confirmedRole = confirmedRole;
    }
    await prisma.teamMember.update({ where: { id: member.id }, data });

    const me = await prisma.user.findUnique({ where: { id: req.userId }, select: { name: true } });
    notify(req, team.supervisorId, {
      type: 'team_qr_confirmed',
      title: 'On-Site Confirmed ✅',
      message: `${me?.name || 'A member'} scanned your QR${confirmedRole ? ` as ${confirmedRole}` : ''} — you're confirmed working together.`,
    });
    const fresh = await prisma.team.findUnique({ where: { id: team.id }, include: { members: true } });
    res.json({ message: `Confirmed — you're working with ${team.name}`, team: teamDTO(fresh) });
  } catch (err) {
    console.error('QR confirm error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Supervisor removes a member
router.post('/:id/remove-member', auth, async (req, res) => {
  try {
    const { memberUserId } = req.body;
    if (!isId(req.params.id)) return res.status(404).json({ error: 'Team not found or not yours' });
    const team = await prisma.team.findFirst({
      where: { id: req.params.id, supervisorId: req.userId },
    });
    if (!team) return res.status(404).json({ error: 'Team not found or not yours' });
    const member = memberUserId && isId(String(memberUserId))
      ? await prisma.teamMember.findFirst({ where: { teamId: team.id, userId: String(memberUserId) } })
      : null;
    if (!member) return res.status(404).json({ error: 'Member not found' });
    await prisma.teamMember.update({ where: { id: member.id }, data: { status: 'removed' } });
    await prisma.user.updateMany({
      where: { id: String(memberUserId) },
      data: { teamId: null, teamRole: null },
    });
    notify(req, memberUserId, { type: 'team_removed', title: 'Team Update', message: `You were removed from "${team.name}".` });
    const fresh = await prisma.team.findUnique({ where: { id: team.id }, include: { members: true } });
    res.json({ message: 'Member removed', team: teamDTO(fresh) });
  } catch (err) {
    console.error('Remove member error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Member leaves the team
router.post('/:id/leave', auth, async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(404).json({ error: 'Team not found' });
    const team = await prisma.team.findUnique({ where: { id: req.params.id } });
    if (!team) return res.status(404).json({ error: 'Team not found' });
    const member = await prisma.teamMember.findFirst({
      where: { teamId: team.id, userId: req.userId, status: 'active' },
    });
    if (!member) return res.status(400).json({ error: 'You are not an active member' });
    await prisma.teamMember.update({ where: { id: member.id }, data: { status: 'removed' } });
    await prisma.user.update({
      where: { id: req.userId },
      data: { teamId: null, teamRole: null },
    });
    notify(req, team.supervisorId, { type: 'team_left', title: 'Team Update', message: `A member left "${team.name}".` });
    res.json({ message: 'You left the team' });
  } catch (err) {
    console.error('Leave team error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
