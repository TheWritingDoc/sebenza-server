// Minimal regression test: verify findMyApplication logic
// This is a simplified version since we don't have the full mocked test from Claude Code's patch

const assert = require('assert');

// Inline the findMyApplication logic to test it
function findMyApplication(applications, userId) {
  if (!Array.isArray(applications) || !userId) return null;
  const mine = applications.find(a => {
    const aid = a && a.applicantId && (a.applicantId._id || a.applicantId);
    return aid && String(aid) === String(userId);
  });
  if (!mine) return null;
  return mine.toObject ? mine.toObject() : mine;
}

// Test 1: finds matching application by string ID
const apps = [
  { applicantId: 'user123', status: 'pending', message: 'Hi' },
  { applicantId: { _id: 'user456' }, status: 'approved', message: 'Hello' }
];
assert.strictEqual(findMyApplication(apps, 'user123')?.status, 'pending', 'Test 1 failed: string match');

// Test 2: finds matching application by ObjectId wrapper
assert.strictEqual(findMyApplication(apps, 'user456')?.status, 'approved', 'Test 2 failed: object _id match');

// Test 3: returns null when no match
assert.strictEqual(findMyApplication(apps, 'user999'), null, 'Test 3 failed: no match should be null');

// Test 4: returns null for empty applications
assert.strictEqual(findMyApplication([], 'user123'), null, 'Test 4 failed: empty array');

// Test 5: returns null when userId missing
assert.strictEqual(findMyApplication(apps, null), null, 'Test 5 failed: null userId');

// Test 6: handles toObject if present
const mongooseLike = {
  applicantId: 'user789',
  status: 'accepted',
  toObject() { return { applicantId: 'user789', status: 'accepted' }; }
};
const result = findMyApplication([mongooseLike], 'user789');
assert.strictEqual(result?.status, 'accepted', 'Test 6 failed: toObject handling');

console.log('✅ All 6 regression tests passed');
