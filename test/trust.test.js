// Identity trust-star tests — pure function, no DB. Run: node test/trust.test.js
const assert = require('assert');
const { computeTrust, computeCommunityStars, totalStars } = require('../utils/trustScore');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n     ${e.message}`); failed++; }
}

console.log('\n🧪  identity trust-star tests\n');

test('fresh signup: account only = visible minimum on the 5-star identity ladder', () => {
  const t = computeTrust({});
  assert.strictEqual(t.stars, 0.5, 'account alone = 0.5 of 5 identity stars');
  assert.strictEqual(t.maxStars, 5);
  assert.strictEqual(t.level, 'New Neighbour');
  assert.strictEqual(t.checklist.find(c => c.key === 'account').done, true);
});

test('completing the profile (bio + skills + category) is a trust item', () => {
  assert.strictEqual(computeTrust({}).checklist.find(c => c.key === 'profile').done, false);
  assert.strictEqual(computeTrust({ bio: 'x', skills: [], primaryCategory: 'Painting' }).checklist.find(c => c.key === 'profile').done, false, 'needs skills too');
  const done = computeTrust({ bio: 'Painter from PE', skills: ['Painting'], primaryCategory: 'Painting' });
  assert.strictEqual(done.checklist.find(c => c.key === 'profile').done, true);
  assert.ok(done.stars > computeTrust({}).stars, 'profile completion raises stars');
});

test('email verification is an identity item worth points', () => {
  const base = computeTrust({}).score;
  const withEmail = computeTrust({ emailVerified: true }).score;
  assert.ok(withEmail > base, 'verifying email should raise the score');
  assert.strictEqual(computeTrust({ emailVerified: true }).checklist.find(c => c.key === 'email').done, true);
});

test('KYC ID is the single biggest boost item', () => {
  const idItem = computeTrust({}).checklist.find(c => c.key === 'id');
  const maxOther = Math.max(...computeTrust({}).checklist.filter(c => c.key !== 'id').map(c => c.points));
  assert.ok(idItem.points > maxOther, 'ID must be the biggest single item');
  assert.strictEqual(computeTrust({ verified: true }).checklist.find(c => c.key === 'id').done, true);
});

test('profile photo counts via profileImage or avatar', () => {
  assert.strictEqual(computeTrust({ profileImage: '/x.jpg' }).checklist.find(c=>c.key==='photo').done, true);
  assert.strictEqual(computeTrust({ avatar: '/y.jpg' }).checklist.find(c=>c.key==='photo').done, true);
});

test('trust docs count when pending or approved, not when rejected', () => {
  assert.strictEqual(computeTrust({ trustDocs: [{ docType:'address', status:'pending' }] }).checklist.find(c=>c.key==='address').done, true);
  assert.strictEqual(computeTrust({ trustDocs: [{ docType:'address', status:'approved' }] }).checklist.find(c=>c.key==='address').done, true);
  assert.strictEqual(computeTrust({ trustDocs: [{ docType:'address', status:'rejected' }] }).checklist.find(c=>c.key==='address').done, false);
});

test('experience satisfied by workExperience entry OR experience doc', () => {
  assert.strictEqual(computeTrust({ workExperience: [{ title:'Plumber 5yrs' }] }).checklist.find(c=>c.key==='experience').done, true);
  assert.strictEqual(computeTrust({ trustDocs: [{ docType:'experience', status:'pending' }] }).checklist.find(c=>c.key==='experience').done, true);
});

test('firstJob satisfied by communityStats.jobsCompleted >= 1', () => {
  assert.strictEqual(computeTrust({ communityStats: { jobsCompleted: 0 } }).checklist.find(c=>c.key==='firstJob').done, false);
  assert.strictEqual(computeTrust({ communityStats: { jobsCompleted: 3 } }).checklist.find(c=>c.key==='firstJob').done, true);
});

test('fully verified profile = 100 score, 5 identity stars, Fully Verified', () => {
  const t = computeTrust({
    emailVerified: true, profileImage: '/me.jpg', phoneVerified: true, verified: true,
    bio: 'Plumber', skills: ['Plumbing'], primaryCategory: 'Plumbing',
    trustDocs: [
      { docType: 'address', status: 'approved' },
      { docType: 'drivers_license', status: 'approved' },
      { docType: 'qualification', status: 'approved' },
    ],
    workExperience: [{ title: 'Plumbing, 5 years' }],
    communityStats: { jobsCompleted: 2 },
  });
  assert.strictEqual(t.score, 100);
  assert.strictEqual(t.stars, 5);
  assert.strictEqual(t.level, 'Fully Verified');
});

test('stars are identity-only: perfect reviews with no ID stay low', () => {
  // Great reviews but nothing verified -> still just the account star.
  const t = computeTrust({ communityStats: { receivedRatingsAvg: 5, jobsCompleted: 0 } });
  assert.strictEqual(t.stars, 0.5);
});

test('community stars: null until first review, then follow ratings', () => {
  assert.strictEqual(computeCommunityStars({ totalReceivedReviews: 0 }).stars, null);
  const good = computeCommunityStars({ totalReceivedReviews: 8, receivedRatingsAvg: 4.8, reliabilityScore: 100, complainerScore: 0 });
  assert.strictEqual(good.stars, 5);
  assert.strictEqual(good.flags.frequentComplainer, false);
});

test('community stars: chronic complainers and unreliable users lose stars + get flagged', () => {
  const complainer = computeCommunityStars({ totalReceivedReviews: 5, receivedRatingsAvg: 4.5, complainerScore: 80, reliabilityScore: 100 });
  assert.ok(complainer.stars < 4.5, 'complainer penalty applies');
  assert.strictEqual(complainer.flags.frequentComplainer, true);
  const unreliable = computeCommunityStars({ totalReceivedReviews: 5, receivedRatingsAvg: 4.5, reliabilityScore: 30, complainerScore: 0 });
  assert.ok(unreliable.stars < 4.5, 'reliability penalty applies');
  assert.strictEqual(unreliable.flags.lowReliability, true);
});

test('community stars: unresolved scam/dispute flags cost a full star and mark FLAGGED', () => {
  const stats = { totalReceivedReviews: 5, receivedRatingsAvg: 4, reliabilityScore: 100, complainerScore: 0 };
  const clean = computeCommunityStars(stats, []);
  const flagged = computeCommunityStars(stats, [{ type: 'suspicious_activity', resolved: false }]);
  assert.strictEqual(flagged.flags.flagged, true);
  assert.ok(flagged.stars <= clean.stars - 1);
  const resolved = computeCommunityStars(stats, [{ type: 'suspicious_activity', resolved: true }]);
  assert.strictEqual(resolved.flags.flagged, false);
});

test('total = identity (0.5–5) + community (0–5), capped shape of the 10-star ladder', () => {
  assert.strictEqual(totalStars(4.5, { stars: 3.5 }), 8);
  assert.strictEqual(totalStars(0.5, { stars: null }), 0.5, 'no reviews = identity only');
  assert.strictEqual(totalStars(5, { stars: 5 }), 10);
});

console.log(`\n${passed}/${passed + failed} tests passed\n`);
process.exit(failed ? 1 : 0);
