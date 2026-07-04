/**
 * Identity Trust Score — SEPARATE from job/review performance.
 *
 * These stars answer one question only: "how well has this person proven who
 * they are?" They exist to encourage users to provide identification so both
 * sides feel safe. They are NOT a quality/review rating (that lives in
 * user.communityStats.receivedRatingsAvg and is shown separately).
 *
 * Score is 0–100 identity points; stars are score mapped onto a 0.5–5 scale
 * (nearest half-star, matching the client's half-star renderer). A freshly
 * registered user always has the "account" item done, so they sign in with a
 * visible minimum star and climb as they add verifications/documents.
 */

// Each identity item and the raw points it contributes. The displayed score is
// normalised to 0–100 against the sum of all points, so items can be added
// without fragile rebalancing. Keys match the client checklist.
const TRUST_ITEMS = [
  { key: 'account',       label: 'Join the community',   points: 10, action: null,            auto: true },
  { key: 'email',         label: 'Verify your email',    points: 10, action: 'email' },
  { key: 'photo',         label: 'Add a profile photo',  points: 10, action: 'photo' },
  { key: 'phone',         label: 'Verify your phone',    points: 10, action: 'phone' },
  { key: 'id',            label: 'Verify your ID',       points: 30, action: 'id' },
  { key: 'address',       label: 'Proof of address',     points: 10, action: 'address' },
  { key: 'license',       label: "Driver's licence",     points: 10, action: 'license' },
  { key: 'qualification', label: 'Add a qualification',  points: 10, action: 'qualification' },
  { key: 'experience',    label: 'Add work experience',  points: 10, action: 'experience' },
  { key: 'firstJob',      label: 'Complete a job',       points: 5,  action: null,            auto: true },
];

const TOTAL_POINTS = TRUST_ITEMS.reduce((s, i) => s + i.points, 0);

function hasApprovedOrPendingDoc(user, docType) {
  return Array.isArray(user.trustDocs) &&
    user.trustDocs.some(d => d.docType === docType && d.status !== 'rejected');
}

/** Return whether a given identity item is satisfied for this user. */
function isItemDone(user, key) {
  switch (key) {
    case 'account':       return true; // registered = done
    case 'email':         return !!user.emailVerified;
    case 'photo':         return !!(user.profileImage || user.avatar);
    case 'phone':         return !!user.phoneVerified;
    case 'id':            return !!user.verified; // set true when KYC is approved
    case 'address':       return hasApprovedOrPendingDoc(user, 'address');
    case 'license':       return hasApprovedOrPendingDoc(user, 'drivers_license');
    case 'qualification': return hasApprovedOrPendingDoc(user, 'qualification');
    case 'experience':    return (Array.isArray(user.workExperience) && user.workExperience.length > 0) ||
                                 hasApprovedOrPendingDoc(user, 'experience');
    case 'firstJob':      return (user.communityStats?.jobsCompleted || 0) >= 1;
    default:              return false;
  }
}

function levelForScore(score) {
  if (score >= 100) return 'Fully Verified';
  if (score >= 80)  return 'Highly Trusted';
  if (score >= 60)  return 'Trusted';
  if (score >= 40)  return 'Verified';
  if (score >= 20)  return 'Getting Started';
  return 'New Neighbour';
}

/**
 * Compute the identity trust profile for a user document (or lean object).
 * @returns {{ score:number, stars:number, level:string, checklist:Array }}
 */
function computeTrust(user) {
  if (!user) return { score: 0, stars: 0, level: 'New Neighbour', checklist: [] };

  let earned = 0;
  const checklist = TRUST_ITEMS.map(item => {
    const done = isItemDone(user, item.key);
    if (done) earned += item.points;
    return { key: item.key, label: item.label, points: item.points, action: item.action, done };
  });

  // Normalise earned points to a 0–100 score against the total available,
  // then map to 0–5 stars (nearest half star). Account is always done, so the
  // floor is a visible ~0.5 star at sign-in.
  const score = Math.round((earned / TOTAL_POINTS) * 100);
  const stars = Math.round((earned / TOTAL_POINTS) * 5 * 2) / 2;

  return { score, stars, level: levelForScore(score), checklist };
}

/**
 * Persist the computed identity stars/score onto the user so lists and cards
 * can show them without recomputing. Call after any identity-changing event
 * (doc upload, phone/ID verification, profile photo, first job completion).
 * Takes the Prisma client (so route code and tests can inject their own).
 */
async function refreshTrust(prisma, userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { trustDocs: true, workExperience: true },
  });
  if (!user) return null;
  const trust = computeTrust(user); // Prisma row already carries the fields computeTrust reads
  await prisma.user.update({
    where: { id: userId },
    data: {
      trustStars: trust.stars,
      trustScore: trust.score,
      trustLevel: trust.level,
    },
  });
  return trust;
}

module.exports = { computeTrust, refreshTrust, TRUST_ITEMS, levelForScore };
