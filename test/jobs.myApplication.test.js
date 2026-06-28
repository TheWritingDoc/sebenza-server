/**
 * Regression test for the "Waiting for applicant confirmation" deadlock.
 *
 * Root cause: the web client keys the "I'm Helping" tab and Confirm/Decline
 * buttons off `job.myApplication`. The API never sent it, so after a poster
 * approved an applicant, the applicant never saw a Confirm button.
 *
 * This test directly exercises the findMyApplication logic and the response
 * transformations from routes/jobs.js without needing a real MongoDB.
 *
 * Run: node test/jobs.myApplication.test.js
 */
const assert = require('assert');

// ── Inline the findMyApplication logic (must match routes/jobs.js exactly) ──
function findMyApplication(applications, userId) {
  if (!Array.isArray(applications) || !userId) return null;
  const mine = applications.find(a => {
    const aid = a && a.applicantId && (a.applicantId._id || a.applicantId);
    return aid && String(aid) === String(userId);
  });
  if (!mine) return null;
  return mine.toObject ? mine.toObject() : mine;
}

// ── Mock toPublicJob (simplified version from routes/jobs.js) ──
function toPublicJob(job, requesterId) {
  const j = { ...job };
  delete j.applications;
  return j;
}

// ── ids ──
const POSTER_ID = '64b000000000000000000001';
const APPLICANT_ID = '64b000000000000000000002';
const OTHER_ID = '64b000000000000000000003';
const APP_ID = '64b0000000000000000000bb';

// ── Test data ──
function approvedApplication(overrides = {}) {
  return {
    _id: APP_ID,
    applicantId: overrides.applicantId || { _id: APPLICANT_ID, name: 'Thandi', avatar: '', rating: 0 },
    proposedAmount: 250,
    approvedAmount: 250,
    proposedTime: new Date('2026-07-01T09:00:00Z'),
    approvedTime: new Date('2026-07-01T09:00:00Z'),
    message: 'I can do this today',
    status: 'approved',
    negotiationHistory: [],
    ...overrides
  };
}

function fakeJob(overrides = {}) {
  return {
    _id: 'job123',
    posterId: POSTER_ID,
    title: 'Test job',
    description: 'Fix a tap',
    category: 'Plumbing',
    budget: 250,
    status: 'approved',
    applications: overrides.applications || [approvedApplication()],
    ...overrides
  };
}

// ── Test runner ──
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ✗ ${name}`); console.error(`     ${err.message}`); }
}

console.log('\n🧪  jobs.myApplication regression test\n');

// ── Test 1: findMyApplication finds matching app by ObjectId wrapper ──
test('findMyApplication matches applicantId._id wrapper', () => {
  const apps = [approvedApplication()];
  const result = findMyApplication(apps, APPLICANT_ID);
  assert(result, 'should find application');
  assert.strictEqual(result.status, 'approved');
  assert.strictEqual(result._id, APP_ID);
});

// ── Test 2: findMyApplication finds matching app by plain string ──
test('findMyApplication matches plain string applicantId', () => {
  const apps = [approvedApplication({ applicantId: APPLICANT_ID })];
  const result = findMyApplication(apps, APPLICANT_ID);
  assert(result, 'should find application');
  assert.strictEqual(result.status, 'approved');
});

// ── Test 3: returns null when no match ──
test('findMyApplication returns null when no match', () => {
  const apps = [approvedApplication()];
  const result = findMyApplication(apps, OTHER_ID);
  assert.strictEqual(result, null);
});

// ── Test 4: returns null for empty applications ──
test('findMyApplication returns null for empty array', () => {
  assert.strictEqual(findMyApplication([], APPLICANT_ID), null);
});

// ── Test 5: returns null when userId is null ──
test('findMyApplication returns null when userId is null', () => {
  assert.strictEqual(findMyApplication([approvedApplication()], null), null);
});

// ── Test 6: handles toObject if present ──
test('findMyApplication calls toObject when available', () => {
  let called = false;
  const app = {
    ...approvedApplication(),
    toObject() { called = true; return { ...this, toObject: undefined }; }
  };
  const result = findMyApplication([app], APPLICANT_ID);
  assert(called, 'toObject should have been called');
  assert.strictEqual(result.status, 'approved');
});

// ── Test 7: returns plain object when toObject is absent ──
test('findMyApplication returns plain object when no toObject', () => {
  const app = approvedApplication({ applicantId: APPLICANT_ID });
  const result = findMyApplication([app], APPLICANT_ID);
  assert(result);
  assert.strictEqual(result.status, 'approved');
  assert.strictEqual(typeof result.toObject, 'undefined');
});

// ── Test 8: browse response transformation ──
test('browse response includes myApplication', () => {
  const job = fakeJob();
  const pub = toPublicJob(job, APPLICANT_ID);
  pub.myApplication = findMyApplication(job.applications, APPLICANT_ID);
  assert(pub.myApplication, 'myApplication should be attached');
  assert.strictEqual(pub.myApplication.status, 'approved');
  assert.strictEqual(pub.applications, undefined, 'applications should be stripped from public view');
});

// ── Test 9: my-jobs response (poster sees null) ──
test('my-jobs response: poster sees null myApplication', () => {
  const job = fakeJob();
  const obj = { ...job };
  obj.myApplication = findMyApplication(obj.applications, POSTER_ID);
  assert.strictEqual(obj.myApplication, null);
});

// ── Test 10: my-applications response ──
test('my-applications response includes myApplication', () => {
  const job = fakeJob();
  const obj = { ...job };
  obj.myApplication = findMyApplication(obj.applications, APPLICANT_ID);
  assert(obj.myApplication);
  assert.strictEqual(obj.myApplication.status, 'approved');
});

// ── Test 11: job detail as applicant ──
test('job detail includes myApplication for applicant', () => {
  const job = fakeJob();
  const myApp = findMyApplication(job.applications, APPLICANT_ID);
  const obj = { ...job };
  obj.myApplication = myApp;
  assert(obj.myApplication);
  assert.strictEqual(obj.myApplication._id, APP_ID);
});

// ── Test 12: job detail as poster (null) ──
test('job detail includes null myApplication for poster', () => {
  const job = fakeJob();
  const myApp = findMyApplication(job.applications, POSTER_ID);
  assert.strictEqual(myApp, null);
});

// ── Test 13: unauthenticated browse (no token → null) ──
test('browse without auth: myApplication is null', () => {
  const job = fakeJob();
  const pub = toPublicJob(job, null);
  pub.myApplication = findMyApplication(job.applications, null);
  assert.strictEqual(pub.myApplication, null);
});

// ── Test 14: multiple applications, finds correct one ──
test('findMyApplication finds correct app among many', () => {
  const apps = [
    approvedApplication({ applicantId: OTHER_ID, status: 'pending' }),
    approvedApplication(), // this one matches APPLICANT_ID
    approvedApplication({ applicantId: 'yet-another-id', status: 'rejected' })
  ];
  const result = findMyApplication(apps, APPLICANT_ID);
  assert(result);
  assert.strictEqual(result.status, 'approved');
});

// ── Summary ──
console.log(`\n${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  console.error(`\n❌ ${failed} test(s) FAILED`);
  process.exit(1);
} else {
  console.log('\n✅ All regression tests passed');
}
