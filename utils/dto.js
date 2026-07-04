const { Prisma } = require('@prisma/client');

/**
 * Convert Prisma rows into the JSON shapes the React client was built
 * against (Mongo era): every object with an `id` also carries `_id`, and
 * Decimal columns become plain numbers. Applied recursively so included
 * relations and JSONB payloads come out right too.
 */
function toDTO(value) {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value;
  if (value instanceof Prisma.Decimal) return Number(value);
  if (Array.isArray(value)) return value.map(toDTO);
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = toDTO(v);
    if (out.id !== undefined && out._id === undefined) out._id = out.id;
    return out;
  }
  return value;
}

/** Strip fields that must never leave the server. */
function sanitizeUser(user, extraOmit = []) {
  if (!user) return user;
  const omit = new Set(['password', 'emailVerificationToken', 'loginAttempts', 'lockUntil', ...extraOmit]);
  const out = {};
  for (const [k, v] of Object.entries(user)) {
    if (!omit.has(k)) out[k] = v;
  }
  return toDTO(out);
}

/** True if the string looks like one of our UUID primary keys. */
function isId(str) {
  return typeof str === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

module.exports = { toDTO, sanitizeUser, isId };
