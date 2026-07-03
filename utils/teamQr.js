const crypto = require('crypto');

/**
 * Team QR check-in: the supervisor generates a short-lived code, rendered as a
 * QR on their phone. A member scans it (or types the code) to confirm they are
 * physically working together — and optionally what their role is that day.
 * The QR payload is plain text so any scanner app can read it too.
 */

const QR_PREFIX = 'SEBENZA-TEAM';
const CODE_TTL_MS = 15 * 60 * 1000; // 15 minutes
// No 0/O/1/I — the code doubles as a type-it-in fallback.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function genTeamCode(len = 6) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

function buildQrPayload(teamId, code) {
  return `${QR_PREFIX}:${teamId}:${code}`;
}

/** Accepts a full scanned payload or a bare code. Returns {teamId, code} or null. */
function parseQrPayload(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const str = raw.trim();
  if (str.startsWith(QR_PREFIX + ':')) {
    const parts = str.split(':');
    if (parts.length !== 3) return null;
    const [, teamId, code] = parts;
    if (!/^[a-f0-9]{24}$/i.test(teamId) || !code) return null;
    return { teamId, code: code.toUpperCase() };
  }
  // Bare code typed by hand (team resolved from the member's own team)
  if (/^[A-Za-z0-9]{4,10}$/.test(str)) return { teamId: null, code: str.toUpperCase() };
  return null;
}

/** Validates a code against the team's active QR session. */
function isCodeValid(team, code) {
  if (!team || !team.qrSession || !team.qrSession.code) return false;
  if (!code || team.qrSession.code !== String(code).toUpperCase()) return false;
  if (!team.qrSession.expiresAt || new Date(team.qrSession.expiresAt) < new Date()) return false;
  return true;
}

module.exports = { QR_PREFIX, CODE_TTL_MS, genTeamCode, buildQrPayload, parseQrPayload, isCodeValid };
