// Shared JWT auth with token-version revocation.
//
// Tokens carry a `tv` claim (the user's token_version at sign time). On each
// authenticated request the claim is compared to the current DB value — bump
// the version and every outstanding 30-day token dies within CACHE_TTL_MS.
// The DB read is cached per user for 60s so this adds ~zero steady-state load.
const jwt = require('jsonwebtoken');
const { prisma } = require('../db');

const SECRET = process.env.JWT_SECRET || 'your-secret-key';
const CACHE_TTL_MS = 60 * 1000;
const versionCache = new Map(); // userId -> { v, at }

async function currentTokenVersion(userId) {
  const hit = versionCache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.v;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { tokenVersion: true } });
  const v = user ? user.tokenVersion : null; // null = user deleted
  versionCache.set(userId, { v, at: Date.now() });
  return v;
}

/** Call after bumping token_version in the DB so revocation is immediate here. */
function invalidateVersionCache(userId) {
  versionCache.delete(userId);
}

/** Revoke all outstanding tokens for a user. */
async function revokeUserSessions(userId) {
  await prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
  invalidateVersionCache(userId);
}

function sendAuthError(res, err) {
  if (err && err.name === 'TokenExpiredError') {
    return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
  }
  return res.status(401).json({ error: 'Invalid token', code: 'TOKEN_INVALID' });
}

const auth = async (req, res, next) => {
  const token = (req.headers.authorization || '').split(' ')[1];
  if (!token || token === 'null' || token === 'undefined') {
    return res.status(401).json({ error: 'No token provided' });
  }
  let decoded;
  try {
    decoded = jwt.verify(token, SECRET);
  } catch (err) {
    return sendAuthError(res, err);
  }
  try {
    const v = await currentTokenVersion(decoded.userId);
    if (v === null || (decoded.tv || 0) !== v) {
      return res.status(401).json({ error: 'Session revoked', code: 'TOKEN_INVALID' });
    }
  } catch (e) {
    // DB hiccup: fail open on the version check (signature already verified)
    // rather than 401-ing the whole app.
  }
  req.userId = decoded.userId;
  req.user = decoded;
  next();
};

module.exports = { auth, revokeUserSessions, invalidateVersionCache, currentTokenVersion };
