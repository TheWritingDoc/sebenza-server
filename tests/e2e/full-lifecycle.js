// Sebenza full-lifecycle E2E: post → apply → negotiate → approve → confirm
// (T&Cs/escrow) → QR handshake → workhub (proof photos, issue reports) →
// complete → poster inspection → payment handshake → mutual reviews.
// Runs the whole flow twice: paymentMethod=cash and paymentMethod=escrow.
//
// Usage: node tests/e2e/full-lifecycle.js   (server must be running locally)
// Test users/jobs are created fresh and deleted from the DB afterwards.

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';
const { prisma } = require('../../db');

const JOB_LAT = -26.2041;
const JOB_LNG = 28.0473;

// 1x1 transparent PNG
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

let passed = 0, failed = 0;
const failures = [];
function ok(msg) { passed++; console.log(`  ✅ ${msg}`); }
function bad(msg, detail) {
  failed++;
  failures.push({ msg, detail });
  console.error(`  ❌ ${msg}${detail ? ` — ${detail}` : ''}`);
}
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
    body: {
      name: `E2E ${name}`, email, password: 'TestPass123!',
      location: { lat: JOB_LAT, lng: JOB_LNG }
    }
  });
  if (r.status !== 200 || !r.data?.token) throw new Error(`register ${name} failed: ${r.status} ${JSON.stringify(r.data)}`);
  return { token: r.data.token, id: r.data.user.id || r.data.user._id, email };
}

const createdUserIds = [];
const createdJobIds = [];

async function runLifecycle(paymentMethod) {
  phase(`════════ LIFECYCLE: paymentMethod=${paymentMethod} ════════`);

  phase('1. Register poster + helper');
  const poster = await register(`poster-${paymentMethod}`);
  const helper = await register(`helper-${paymentMethod}`);
  createdUserIds.push(poster.id, helper.id);
  ok(`poster=${poster.id.slice(0, 8)}… helper=${helper.id.slice(0, 8)}…`);

  if (paymentMethod === 'escrow') {
    await prisma.user.update({ where: { id: poster.id }, data: { randBalance: 1000 } });
    ok('poster balance topped up to R1000 for escrow');
  }

  phase('2. Poster posts a job');
  let r = await api('POST', '/api/jobs', {
    token: poster.token,
    body: {
      title: `E2E ${paymentMethod} job`, description: 'Full lifecycle test job',
      category: 'Testing', budget: 300, lat: JOB_LAT, lng: JOB_LNG,
      paymentMethod
    }
  });
  expect(r.status === 201 && r.data?.job?.id, 'POST /api/jobs creates job', JSON.stringify(r.data));
  const jobId = r.data.job.id;
  createdJobIds.push(jobId);

  r = await api('GET', `/api/jobs/${jobId}`, { token: helper.token });
  expect(r.status === 200 && r.data.status === 'open', 'job visible + open', `status=${r.data?.status}`);

  phase('3. Helper applies');
  r = await api('POST', `/api/jobs/${jobId}/apply`, {
    token: helper.token, body: { proposedAmount: 350, message: 'I can do this' }
  });
  expect(r.status === 200, 'helper applies', JSON.stringify(r.data));

  r = await api('GET', '/api/jobs/my-jobs', { token: poster.token });
  const myJob = (r.data || []).find(j => (j.id || j._id) === jobId);
  const appId = myJob?.applications?.[0]?.id || myJob?.applications?.[0]?._id;
  expect(!!appId, 'poster sees the application', JSON.stringify(myJob?.applications));

  phase('4. Negotiation (both directions)');
  r = await api('POST', `/api/jobs/${jobId}/applications/${appId}/negotiate`, {
    token: poster.token, body: { amount: 280, message: 'Can you do it for 280?' }
  });
  expect(r.status === 200, 'poster counters R280', JSON.stringify(r.data));
  r = await api('POST', `/api/jobs/${jobId}/applications/${appId}/negotiate`, {
    token: helper.token, body: { amount: 300, message: 'Meet me at 300' }
  });
  expect(r.status === 200, 'helper counters R300', JSON.stringify(r.data));

  phase('5. Poster approves at agreed amount (accepting negotiation)');
  r = await api('POST', `/api/jobs/${jobId}/applications/${appId}/approve`, {
    token: poster.token, body: { approvedAmount: 300 }
  });
  expect(r.status === 200, 'poster approves application', JSON.stringify(r.data));

  phase('6. Helper confirms (T&Cs / escrow funding point)');
  r = await api('POST', `/api/jobs/${jobId}/applications/${appId}/confirm`, { token: helper.token, body: {} });
  expect(r.status === 200, 'helper confirms offer', JSON.stringify(r.data));
  if (paymentMethod === 'escrow') {
    expect(r.data?.escrowFunded === true && r.data?.amount === 300, 'escrow funded for R300', JSON.stringify(r.data));
    const p = await prisma.user.findUnique({ where: { id: poster.id }, select: { randBalance: true } });
    expect(Number(p.randBalance) === 700, 'poster balance debited to R700', `balance=${p.randBalance}`);
  }
  r = await api('GET', `/api/jobs/${jobId}`, { token: poster.token });
  expect(r.data?.status === 'accepted', 'job status = accepted', `status=${r.data?.status}`);

  phase('7. QR handshake / on-site induction (single scan starts the job)');
  r = await api('POST', `/api/jobs/${jobId}/qr-handshake`, {
    token: helper.token, body: { scannedUserId: poster.id, lat: JOB_LAT, lng: JOB_LNG }
  });
  expect(r.status === 200 && r.data?.jobStarted === true, 'ONE scan starts the job', JSON.stringify(r.data));
  r = await api('POST', `/api/jobs/${jobId}/qr-handshake`, {
    token: poster.token, body: { scannedUserId: helper.id, lat: JOB_LAT, lng: JOB_LNG }
  });
  expect(r.status === 200 && r.data?.jobStarted === true, 'second scan is idempotent (already started)', JSON.stringify(r.data));

  r = await api('GET', `/api/jobs/${jobId}`, { token: poster.token });
  expect(r.data?.status === 'in_progress', 'job status = in_progress', `status=${r.data?.status}`);

  phase('8. Workhub: proof photos + notes + issue report');
  r = await api('POST', `/api/jobs/${jobId}/upload-proof`, {
    token: helper.token,
    body: { stage: 'before', note: 'Before starting', lat: JOB_LAT, lng: JOB_LNG },
    files: [{ field: 'photos', name: 'before.png', data: TINY_PNG }]
  });
  expect(r.status === 200, 'helper uploads BEFORE proof photo', JSON.stringify(r.data));

  r = await api('POST', `/api/jobs/${jobId}/upload-proof`, {
    token: helper.token,
    body: { stage: 'during', note: 'Halfway done', lat: JOB_LAT, lng: JOB_LNG },
    files: [{ field: 'photos', name: 'during.png', data: TINY_PNG }]
  });
  expect(r.status === 200, 'helper uploads DURING proof photo', JSON.stringify(r.data));

  r = await api('POST', `/api/jobs/${jobId}/report-issue`, {
    token: poster.token,
    body: { note: 'Please also fix the hinge', lat: JOB_LAT, lng: JOB_LNG },
    files: [{ field: 'photos', name: 'issue.png', data: TINY_PNG }]
  });
  expect(r.status === 200, 'poster reports an issue/note with photo', JSON.stringify(r.data));

  let helperBalanceBefore = 0;
  if (paymentMethod === 'escrow') {
    helperBalanceBefore = Number((await prisma.user.findUnique({ where: { id: helper.id }, select: { randBalance: true } })).randBalance);
    phase('8b. Partial escrow release (advance payment)');
    r = await api('POST', `/api/jobs/${jobId}/partial-release`, {
      token: poster.token, body: { amount: 100 }
    });
    expect(r.status === 200 && r.data?.releasedAmount === 100, 'poster releases R100 advance', JSON.stringify(r.data));
    const h = await prisma.user.findUnique({ where: { id: helper.id }, select: { randBalance: true } });
    expect(Number(h.randBalance) === helperBalanceBefore + 100, 'helper balance +R100 after advance', `balance=${h.randBalance}`);
  }

  phase('9. Helper marks complete with AFTER proof photos');
  r = await api('POST', `/api/jobs/${jobId}/complete`, {
    token: helper.token,
    body: { lat: JOB_LAT, lng: JOB_LNG },
    files: [{ field: 'photos', name: 'after.png', data: TINY_PNG }]
  });
  expect(r.status === 200, 'helper submits completion', JSON.stringify(r.data));
  r = await api('GET', `/api/jobs/${jobId}`, { token: poster.token });
  expect(r.data?.status === 'pending_review', 'job status = pending_review', `status=${r.data?.status}`);

  phase('10. Poster inspects + confirms with rating & photos');
  if (paymentMethod === 'cash') {
    // Client app sequence: submit review first, then confirm without inline rating.
    r = await api('POST', `/api/jobs/${jobId}/review`, {
      token: poster.token, body: { overallRating: 5, comment: 'Great work!' }
    });
    expect(r.status === 200, 'poster submits review first (client sequence)', JSON.stringify(r.data));
    r = await api('POST', `/api/jobs/${jobId}/confirm-completion`, {
      token: poster.token,
      body: {},
      files: [{ field: 'photos', name: 'inspection.png', data: TINY_PNG }]
    });
    expect(r.status === 200, 'poster confirms completion (review-first path)', JSON.stringify(r.data));
  } else {
    r = await api('POST', `/api/jobs/${jobId}/confirm-completion`, {
      token: poster.token,
      body: { rating: 5, comment: 'Great work!' },
      files: [{ field: 'photos', name: 'inspection.png', data: TINY_PNG }]
    });
    expect(r.status === 200, 'poster confirms completion (inline-rating path)', JSON.stringify(r.data));
  }
  r = await api('GET', `/api/jobs/${jobId}`, { token: poster.token });
  expect(r.data?.status === 'pending_payment', 'job status = pending_payment', `status=${r.data?.status}`);

  // Double-blind: before payment, the helper knows THAT the poster rated
  // (posterReviewed flag) but cannot see the stars/comment.
  expect(r.data?.posterReviewed === true && !!r.data?.posterReview, 'poster sees own review before payment', JSON.stringify({ reviewed: r.data?.posterReviewed, hasReview: !!r.data?.posterReview }));
  r = await api('GET', `/api/jobs/${jobId}`, { token: helper.token });
  expect(r.data?.posterReviewed === true && r.data?.posterReview === undefined, 'helper CANNOT see poster review before payment (double-blind)', JSON.stringify({ reviewed: r.data?.posterReviewed, review: r.data?.posterReview }));

  phase('11. Payment handshake via QR (single scan finalizes)');
  r = await api('POST', `/api/jobs/${jobId}/payment-handshake`, {
    token: helper.token, body: { lat: JOB_LAT, lng: JOB_LNG }
  });
  expect(r.status === 200 && r.data?.paymentConfirmed === true, 'ONE scan confirms payment and completes the job', JSON.stringify(r.data));
  r = await api('POST', `/api/jobs/${jobId}/payment-handshake`, {
    token: poster.token, body: { lat: JOB_LAT, lng: JOB_LNG }
  });
  expect(r.status === 200 && r.data?.paymentConfirmed === true, 'second confirm is idempotent (already completed)', JSON.stringify(r.data));

  r = await api('GET', `/api/jobs/${jobId}`, { token: poster.token });
  expect(r.data?.status === 'completed', 'job status = completed', `status=${r.data?.status}`);

  // Double-blind lifted: after payment both parties see each other's ratings.
  r = await api('GET', `/api/jobs/${jobId}`, { token: helper.token });
  expect(!!r.data?.posterReview?.overallRating, 'helper sees poster review AFTER payment confirmed', JSON.stringify(r.data?.posterReview));

  if (paymentMethod === 'escrow') {
    const h = await prisma.user.findUnique({ where: { id: helper.id }, select: { randBalance: true } });
    expect(Number(h.randBalance) === helperBalanceBefore + 300, 'helper received full R300 (100 advance + 200 release)', `balance=${h.randBalance}`);
  }

  phase('12. Helper rates the poster');
  r = await api('POST', `/api/jobs/${jobId}/review`, {
    token: helper.token, body: { rating: 4, comment: 'Good client', target: 'poster' }
  });
  expect(r.status === 200, 'helper reviews poster (4★)', JSON.stringify(r.data));

  const posterAfter = await prisma.user.findUnique({ where: { id: poster.id }, select: { communityStats: true } });
  const helperAfter = await prisma.user.findUnique({ where: { id: helper.id }, select: { communityStats: true } });
  expect(posterAfter.communityStats?.receivedRatingsAvg === 4, 'poster community avg = 4', JSON.stringify(posterAfter.communityStats));
  expect(helperAfter.communityStats?.receivedRatingsAvg === 5, 'helper community avg = 5', JSON.stringify(helperAfter.communityStats));
  expect(helperAfter.communityStats?.jobsCompleted === 1, 'helper jobsCompleted = 1', JSON.stringify(helperAfter.communityStats));

  phase('13. Guard-rail spot checks');
  r = await api('POST', `/api/jobs/${jobId}/payment-handshake`, { token: poster.token, body: {} });
  expect(r.status === 200 && r.data?.paymentConfirmed === true, 'payment-handshake idempotent after completion', `status=${r.status} ${JSON.stringify(r.data)}`);
  r = await api('POST', `/api/jobs/${jobId}/apply`, { token: helper.token, body: { proposedAmount: 100 } });
  expect(r.status === 400, 'cannot apply to a completed job', `status=${r.status}`);
  r = await api('POST', `/api/jobs/${jobId}/review`, { token: helper.token, body: { rating: 1, target: 'poster' } });
  expect(r.status === 400, 'duplicate review rejected', `status=${r.status}`);
}

async function proximityGuardCheck() {
  phase('════════ PROXIMITY GUARD ════════');
  const poster = await register('prox-poster');
  const helper = await register('prox-helper');
  createdUserIds.push(poster.id, helper.id);

  let r = await api('POST', '/api/jobs', {
    token: poster.token,
    body: { title: 'E2E proximity job', description: 'x', category: 'Testing', budget: 100, lat: JOB_LAT, lng: JOB_LNG, paymentMethod: 'cash' }
  });
  const jobId = r.data.job.id;
  createdJobIds.push(jobId);
  await api('POST', `/api/jobs/${jobId}/apply`, { token: helper.token, body: { proposedAmount: 100 } });
  r = await api('GET', '/api/jobs/my-jobs', { token: poster.token });
  const appId = (r.data || []).find(j => (j.id || j._id) === jobId)?.applications?.[0]?.id;
  await api('POST', `/api/jobs/${jobId}/applications/${appId}/approve`, { token: poster.token, body: {} });
  await api('POST', `/api/jobs/${jobId}/applications/${appId}/confirm`, { token: helper.token, body: {} });

  // 5km away → must be rejected
  r = await api('POST', `/api/jobs/${jobId}/qr-handshake`, {
    token: helper.token, body: { lat: JOB_LAT + 0.05, lng: JOB_LNG }
  });
  expect(r.status === 400, 'QR handshake rejected when >500m away', JSON.stringify(r.data));

  // unauthorized third party
  const stranger = await register('prox-stranger');
  createdUserIds.push(stranger.id);
  r = await api('POST', `/api/jobs/${jobId}/qr-handshake`, {
    token: stranger.token, body: { lat: JOB_LAT, lng: JOB_LNG }
  });
  expect(r.status === 403, 'stranger cannot QR-handshake', `status=${r.status}`);
  r = await api('POST', `/api/jobs/${jobId}/upload-proof`, {
    token: stranger.token, body: { stage: 'during' },
    files: [{ field: 'photos', name: 'x.png', data: TINY_PNG }]
  });
  expect(r.status === 403, 'stranger cannot upload proof', `status=${r.status}`);

  // manual fallback: starts the job even when the camera/GPS can't be used
  r = await api('POST', `/api/jobs/${jobId}/qr-handshake`, {
    token: helper.token, body: { manual: true, lat: JOB_LAT + 0.05, lng: JOB_LNG }
  });
  expect(r.status === 200 && r.data?.jobStarted === true, 'manual start works without proximity', JSON.stringify(r.data));

  // manual payment fallback on the same job
  await api('POST', `/api/jobs/${jobId}/complete`, {
    token: helper.token, body: {},
    files: [{ field: 'photos', name: 'after.png', data: TINY_PNG }]
  });
  await api('POST', `/api/jobs/${jobId}/confirm-completion`, {
    token: poster.token, body: { rating: 5 },
    files: [{ field: 'photos', name: 'insp.png', data: TINY_PNG }]
  });
  r = await api('POST', `/api/jobs/${jobId}/payment-handshake`, {
    token: helper.token, body: { manual: true }
  });
  expect(r.status === 200 && r.data?.paymentConfirmed === true, 'manual payment confirm works (helper)', JSON.stringify(r.data));
}

async function negotiationAcceptanceCheck() {
  phase('════════ NEGOTIATION ACCEPTANCE (deadlock regression) ════════');
  const poster = await register('nego-poster');
  const helper = await register('nego-helper');
  createdUserIds.push(poster.id, helper.id);

  async function makeNegotiatedJob(counterBy) {
    let r = await api('POST', '/api/jobs', {
      token: poster.token,
      body: { title: `E2E nego ${counterBy} job`, description: 'x', category: 'Testing', budget: 200, lat: JOB_LAT, lng: JOB_LNG, paymentMethod: 'cash' }
    });
    const jobId = r.data.job.id;
    createdJobIds.push(jobId);
    await api('POST', `/api/jobs/${jobId}/apply`, { token: helper.token, body: { proposedAmount: 250 } });
    r = await api('GET', '/api/jobs/my-jobs', { token: poster.token });
    const appId = (r.data || []).find(j => (j.id || j._id) === jobId)?.applications?.[0]?.id;
    return { jobId, appId };
  }

  // Case A: poster counters, HELPER accepts the counter
  let { jobId, appId } = await makeNegotiatedJob('poster');
  let r = await api('POST', `/api/jobs/${jobId}/applications/${appId}/negotiate`, {
    token: poster.token, body: { amount: 220, message: '220 final?' }
  });
  expect(r.status === 200, 'poster sends counter', JSON.stringify(r.data));
  r = await api('POST', `/api/jobs/${jobId}/applications/${appId}/accept-offer`, { token: helper.token, body: {} });
  expect(r.status === 200 && r.data?.nextStep === 'confirm' && r.data?.agreedAmount === 220,
    'helper accepts poster counter (was 400 deadlock)', JSON.stringify(r.data));
  r = await api('POST', `/api/jobs/${jobId}/applications/${appId}/confirm`, { token: helper.token, body: {} });
  expect(r.status === 200, 'helper confirms after accepting counter', JSON.stringify(r.data));
  r = await api('GET', `/api/jobs/${jobId}`, { token: poster.token });
  expect(r.data?.status === 'accepted', 'job accepted at negotiated amount', `status=${r.data?.status}`);

  // Case B: helper counters, POSTER accepts the counter
  ({ jobId, appId } = await makeNegotiatedJob('helper'));
  r = await api('POST', `/api/jobs/${jobId}/applications/${appId}/negotiate`, {
    token: helper.token, body: { amount: 240, message: 'Can do it for 240' }
  });
  expect(r.status === 200, 'helper sends counter', JSON.stringify(r.data));
  r = await api('POST', `/api/jobs/${jobId}/applications/${appId}/accept-offer`, { token: poster.token, body: {} });
  expect(r.status === 200 && r.data?.nextStep === 'confirm' && r.data?.agreedAmount === 240,
    'poster accepts helper counter (was 403/400 deadlock)', JSON.stringify(r.data));
  r = await api('POST', `/api/jobs/${jobId}/applications/${appId}/confirm`, { token: helper.token, body: {} });
  expect(r.status === 200, 'helper confirms after poster accepted', JSON.stringify(r.data));
  r = await api('GET', `/api/jobs/${jobId}`, { token: poster.token });
  expect(r.data?.status === 'accepted', 'job accepted at helper-countered amount', `status=${r.data?.status}`);

  // Case C: poster can reject-offer during negotiation (was 404)
  ({ jobId, appId } = await makeNegotiatedJob('reject'));
  await api('POST', `/api/jobs/${jobId}/applications/${appId}/negotiate`, {
    token: helper.token, body: { amount: 999 }
  });
  r = await api('POST', `/api/jobs/${jobId}/applications/${appId}/reject-offer`, { token: poster.token, body: {} });
  expect(r.status === 200, 'poster rejects helper counter (was 404)', `status=${r.status} ${JSON.stringify(r.data)}`);

  // Guard: accepting your OWN pending counter must fail
  ({ jobId, appId } = await makeNegotiatedJob('own'));
  await api('POST', `/api/jobs/${jobId}/applications/${appId}/negotiate`, {
    token: poster.token, body: { amount: 210 }
  });
  r = await api('POST', `/api/jobs/${jobId}/applications/${appId}/accept-offer`, { token: poster.token, body: {} });
  expect(r.status === 400, 'cannot accept your own counter', `status=${r.status}`);
}

async function cleanup() {
  phase('Cleanup: removing E2E test data');
  try {
    if (createdJobIds.length) {
      await prisma.transaction.deleteMany({ where: { jobId: { in: createdJobIds } } });
      await prisma.application.deleteMany({ where: { jobId: { in: createdJobIds } } });
      await prisma.job.deleteMany({ where: { id: { in: createdJobIds } } });
    }
    if (createdUserIds.length) {
      await prisma.notification.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.transaction.deleteMany({ where: { OR: [{ requesterId: { in: createdUserIds } }, { providerId: { in: createdUserIds } }] } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    ok(`removed ${createdJobIds.length} jobs, ${createdUserIds.length} users`);
  } catch (e) {
    bad('cleanup failed', e.message);
  }
}

(async () => {
  console.log(`Sebenza full-lifecycle E2E → ${BASE_URL}`);
  const health = await api('GET', '/api/health');
  if (health.status !== 200) { console.error('Server not reachable'); process.exit(1); }
  console.log(`Server OK (mode=${health.data.mode})`);

  try {
    await runLifecycle('cash');
    await runLifecycle('escrow');
    await proximityGuardCheck();
    await negotiationAcceptanceCheck();
  } catch (e) {
    bad('lifecycle aborted', e.message);
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }

  console.log(`\n══════════ RESULT: ${passed} passed, ${failed} failed ══════════`);
  if (failures.length) {
    console.log('\nFailures:');
    failures.forEach(f => console.log(`  ✗ ${f.msg}${f.detail ? ` — ${f.detail}` : ''}`));
  }
  process.exit(failed ? 1 : 0);
})();
