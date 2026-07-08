// E2E: (1) when a job is locked in, ALL other applicants are marked rejected
// and get an 'application_unsuccessful' notification; (2) stop-job cancels the
// job, refunds escrow and sends the helper a 'job_cancelled' notification with
// the reason.
//
// Usage: node tests/e2e/cancel-and-applicants.js  (server running locally)

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';
const { prisma } = require('../../db');

const JOB_LAT = -26.2041;
const JOB_LNG = 28.0473;
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

let passed = 0, failed = 0;
const failures = [];
function ok(msg) { passed++; console.log(`  ✅ ${msg}`); }
function bad(msg, detail) { failed++; failures.push({ msg, detail }); console.error(`  ❌ ${msg}${detail ? ` — ${detail}` : ''}`); }
function phase(name) { console.log(`\n📌 ${name}`); }
function expect(cond, msg, detail) { cond ? ok(msg) : bad(msg, detail); return cond; }

async function api(method, path, { token, body, files } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (files) {
    const boundary = '----e2e' + Math.random().toString(16).slice(2);
    headers['Content-Type'] = `multipart/form-data; boundary=${boundary}`;
    const parts = [];
    for (const [k, v] of Object.entries(body || {})) {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
    }
    for (const f of files) {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${f.field}"; filename="${f.name}"\r\nContent-Type: image/png\r\n\r\n`));
      parts.push(f.data, Buffer.from('\r\n'));
    }
    parts.push(Buffer.from(`--${boundary}--\r\n`));
    payload = Buffer.concat(parts);
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE_URL}${path}`, { method, headers, body: payload });
  let data = null;
  try { data = await res.json(); } catch (e) { /* non-JSON */ }
  return { status: res.status, data };
}

async function register(name) {
  const email = `e2e-${name}-${Date.now()}@e2e.test`;
  const r = await api('POST', '/api/register', {
    body: { name: `E2E ${name}`, email, password: 'TestPass123!', location: { lat: JOB_LAT, lng: JOB_LNG } }
  });
  if (r.status !== 200 || !r.data?.token) throw new Error(`register ${name} failed: ${r.status} ${JSON.stringify(r.data)}`);
  return { token: r.data.token, id: r.data.user.id || r.data.user._id, email };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function notificationsFor(userId, type) {
  return prisma.notification.findMany({ where: { userId, type } });
}

// Post-response work (rejections + notifications) hits remote Postgres, so
// poll instead of a fixed sleep.
async function waitFor(checkFn, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await checkFn()) return true;
    await sleep(1000);
  }
  return false;
}

const createdUserIds = [];
const createdJobIds = [];

async function run() {
  phase('1. Register poster + two helpers');
  const poster = await register('cx-poster');
  const helperA = await register('cx-helperA');
  const helperB = await register('cx-helperB');
  createdUserIds.push(poster.id, helperA.id, helperB.id);
  await prisma.user.update({ where: { id: poster.id }, data: { randBalance: 1000 } });
  ok('users registered, poster funded R1000');

  phase('2. Post escrow job, both helpers apply');
  let r = await api('POST', '/api/jobs', {
    token: poster.token,
    body: { title: 'E2E cancel test job', description: 'Cancel/unsuccessful test', category: 'Testing', budget: 300, lat: JOB_LAT, lng: JOB_LNG, paymentMethod: 'escrow' }
  });
  expect(r.status === 201 && r.data?.job?.id, 'job created', JSON.stringify(r.data));
  const jobId = r.data.job.id;
  createdJobIds.push(jobId);

  r = await api('POST', `/api/jobs/${jobId}/apply`, { token: helperA.token, body: { proposedAmount: 300 } });
  expect(r.status === 200, 'helper A applies', JSON.stringify(r.data));
  r = await api('POST', `/api/jobs/${jobId}/apply`, { token: helperB.token, body: { proposedAmount: 280 } });
  expect(r.status === 200, 'helper B applies', JSON.stringify(r.data));

  r = await api('GET', '/api/jobs/my-jobs', { token: poster.token });
  const myJob = (r.data || []).find(j => (j.id || j._id) === jobId);
  const apps = myJob?.applications || [];
  const appA = apps.find(a => String(a.applicantId?._id || a.applicantId?.id || a.applicantId) === String(helperA.id));
  expect(!!appA, 'poster sees helper A application', JSON.stringify(apps.map(a => a.applicantId)));

  phase('3. Approve + confirm helper A → helper B must be told');
  r = await api('POST', `/api/jobs/${jobId}/applications/${appA._id || appA.id}/approve`, { token: poster.token, body: { approvedAmount: 300 } });
  expect(r.status === 200, 'poster approves helper A', JSON.stringify(r.data));
  r = await api('POST', `/api/jobs/${jobId}/applications/${appA._id || appA.id}/confirm`, { token: helperA.token, body: {} });
  expect(r.status === 200, 'helper A confirms (job locked in)', JSON.stringify(r.data));

  await waitFor(async () => {
    const rows = await notificationsFor(helperB.id, 'application_unsuccessful');
    return rows.length > 0;
  });

  const bApps = await prisma.application.findMany({ where: { jobId, applicantId: helperB.id } });
  expect(bApps[0]?.status === 'rejected', 'helper B application auto-rejected', `status=${bApps[0]?.status}`);
  const bNotifs = await notificationsFor(helperB.id, 'application_unsuccessful');
  expect(bNotifs.length === 1, 'helper B got application_unsuccessful notification', `count=${bNotifs.length}`);
  const aNotifs = await notificationsFor(helperA.id, 'application_unsuccessful');
  expect(aNotifs.length === 0, 'winning helper A got NO unsuccessful notification', `count=${aNotifs.length}`);

  phase('4. Poster stops job (unforeseen circumstances) → helper notified + escrow refunded');
  r = await api('POST', `/api/jobs/${jobId}/stop-job`, {
    token: poster.token,
    body: { reason: 'Family emergency — cannot be home today' },
    files: [{ field: 'stopPhotos', name: 'evidence.png', data: TINY_PNG }]
  });
  expect(r.status === 200, 'stop-job succeeds', JSON.stringify(r.data));
  expect(r.data?.refundedAmount === 300, 'escrow R300 refunded', `refunded=${r.data?.refundedAmount}`);

  await waitFor(async () => {
    const rows = await notificationsFor(helperA.id, 'job_cancelled');
    return rows.length > 0;
  });

  const jobRow = await prisma.job.findUnique({ where: { id: jobId }, select: { status: true } });
  expect(jobRow?.status === 'cancelled', 'job status = cancelled', `status=${jobRow?.status}`);
  const cancelNotifs = await notificationsFor(helperA.id, 'job_cancelled');
  expect(cancelNotifs.length === 1, 'helper A got job_cancelled notification', `count=${cancelNotifs.length}`);
  expect((cancelNotifs[0]?.message || '').includes('Family emergency'), 'notification includes the reason', cancelNotifs[0]?.message);
  expect((cancelNotifs[0]?.message || '').toLowerCase().includes('again'), 'notification mentions re-offering when reposted', cancelNotifs[0]?.message);
  const posterBal = await prisma.user.findUnique({ where: { id: poster.id }, select: { randBalance: true } });
  expect(Number(posterBal.randBalance) === 1000, 'poster balance restored to R1000', `balance=${posterBal.randBalance}`);
}

async function cleanup() {
  phase('Cleanup');
  try {
    if (createdJobIds.length) {
      await prisma.transaction.deleteMany({ where: { jobId: { in: createdJobIds } } });
      await prisma.application.deleteMany({ where: { jobId: { in: createdJobIds } } });
      await prisma.job.deleteMany({ where: { id: { in: createdJobIds } } });
    }
    if (createdUserIds.length) {
      await prisma.notification.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.review.deleteMany({ where: { OR: [{ reviewerId: { in: createdUserIds } }, { revieweeId: { in: createdUserIds } }] } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    ok('test data removed');
  } catch (e) {
    bad('cleanup failed', e.message);
  }
}

run()
  .catch(e => bad('unhandled error', e.stack))
  .finally(async () => {
    await cleanup();
    console.log(`\n══════ RESULT: ${passed} passed, ${failed} failed ══════`);
    if (failures.length) failures.forEach(f => console.log(` ❌ ${f.msg} ${f.detail || ''}`));
    await prisma.$disconnect();
    process.exit(failed ? 1 : 0);
  });
