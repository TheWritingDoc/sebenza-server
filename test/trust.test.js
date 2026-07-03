// Identity trust-star tests — pure function, no DB. Run: node test/trust.test.js
const assert = require('assert');
const { computeTrust } = require('../utils/trustScore');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n     ${e.message}`); failed++; }
}

console.log('\n🧪  identity trust-star tests\n');

test('fresh signup: account only = 0.5 star minimum floor', () => {
  const t = computeTrust({});
  assert.strictEqual(t.stars, 0.5);
  assert.strictEqual(t.level, 'New Neighbour');
  assert.strictEqual(t.checklist.find(c => c.key === 'account').done, true);
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

test('fully verified profile = 100 score, 5 stars, Fully Verified', () => {
  const t = computeTrust({
    emailVerified: true, profileImage: '/me.jpg', phoneVerified: true, verified: true,
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

console.log(`\n${passed}/${passed + failed} tests passed\n`);
process.exit(failed ? 1 : 0);
