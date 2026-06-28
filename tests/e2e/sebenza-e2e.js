// Sebenza E2E Test — API-level regression for myApplication fix
// This tests the actual HTTP API without fragile UI selectors.
// Usage: BASE_URL=https://sebenza-server.onrender.com node tests/e2e/sebenza-e2e.js

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const ACTION_TIMEOUT = parseInt(process.env.ACTION_TIMEOUT || '15000', 10);

const poster = {
  name: `E2E Poster ${Date.now()}`,
  email: `poster-${Date.now()}@e2e.test`,
  password: 'TestPass123!',
  phone: `+27${Math.floor(Math.random() * 1000000000).toString().padStart(9, '0')}`,
};
const helper = {
  name: `E2E Helper ${Date.now()}`,
  email: `helper-${Date.now()}@e2e.test`,
  password: 'TestPass123!',
  phone: `+27${Math.floor(Math.random() * 1000000000).toString().padStart(9, '0')}`,
};

const ok = (msg) => console.log(`  ✅ ${msg}`);
const fail = (msg) => { console.error(`  ✗ ${msg}`); throw new Error(msg); };
const phase = (name) => console.log(`\n📌 ${name}`);

const http = require('http');
const https = require('https');

let csrfToken = null;
let cookies = [];

function request(urlStr, opts = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const client = url.protocol === 'https:' ? https : http;
    const headers = {
      'Content-Type': 'application/json',
      ...opts.headers,
    };
    if (csrfToken && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(opts.method || 'GET')) {
      headers['X-CSRF-Token'] = csrfToken;
    }
    if (cookies.length > 0) {
      headers['Cookie'] = cookies.join('; ');
    }

    const req = client.request(url, {
      method: opts.method || 'GET',
      headers,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        // Capture Set-Cookie headers
        const setCookies = res.headers['set-cookie'] || [];
        setCookies.forEach(c => {
          const cookiePart = c.split(';')[0].trim();
          if (cookiePart) {
            // Remove any existing cookie with same name
            const [name] = cookiePart.split('=');
            cookies = cookies.filter(c2 => !c2.startsWith(`${name}=`));
            cookies.push(cookiePart);
          }
        });

        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, data: parsed, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function api(path, opts = {}) {
  const url = `${BASE_URL}/api${path}`;
  return request(url, opts);
}

async function fetchCsrfToken() {
  const { status, data } = await api('/csrf-token');
  if (status !== 200 || !data.csrfToken) fail(`CSRF token fetch failed: ${status}`);
  csrfToken = data.csrfToken;
  ok('CSRF token fetched');
}

async function register(user) {
  const { status, data } = await api('/register', {
    method: 'POST',
    body: JSON.stringify(user),
  });
  if (status !== 200 && status !== 201) fail(`register failed: ${status} ${JSON.stringify(data)}`);
  return data;
}

async function login(user) {
  const { status, data } = await api('/login', {
    method: 'POST',
    body: JSON.stringify({ email: user.email, password: user.password }),
  });
  if (status !== 200 || !data.token) fail(`login failed: ${status} ${JSON.stringify(data)}`);
  return data.token;
}

async function postJob(token, title) {
  const job = {
    title,
    description: 'E2E test job for myApplication fix verification',
    category: 'Plumbing',
    budget: 250,
    budgetMin: 200,
    budgetMax: 300,
    isUrgent: false,
    paymentMethod: 'cash',
    proposedTime: new Date().toISOString(),
    timeIsNegotiable: false,
    location: { lat: -33.9, lng: 18.4 },
  };
  const { status, data } = await api('/jobs', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(job),
  });
  if (status !== 200 && status !== 201) fail(`postJob failed: ${status} ${JSON.stringify(data)}`);
  return data._id || data.job?._id;
}

async function applyToJob(token, jobId) {
  const { status, data } = await api(`/jobs/${jobId}/apply`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      proposedAmount: 250,
      proposedTime: new Date().toISOString(),
      message: 'I can help with this!',
    }),
  });
  if (status !== 200 && status !== 201) fail(`apply failed: ${status} ${JSON.stringify(data)}`);
  return data;
}

async function approveApplicant(token, jobId, applicationId) {
  const { status, data } = await api(`/jobs/${jobId}/applications/${applicationId}/approve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      approvedAmount: 250,
      approvedTime: new Date().toISOString(),
    }),
  });
  if (status !== 200 && status !== 201) fail(`approve failed: ${status} ${JSON.stringify(data)}`);
  return data;
}

async function confirmJob(token, jobId, applicationId) {
  const { status, data } = await api(`/jobs/${jobId}/applications/${applicationId}/confirm`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (status !== 200 && status !== 201) fail(`confirm failed: ${status} ${JSON.stringify(data)}`);
  return data;
}

async function getJob(token, jobId) {
  const { status, data } = await api(`/jobs/${jobId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (status !== 200) fail(`getJob failed: ${status}`);
  return data;
}

async function getMyApplications(token) {
  const { status, data } = await api('/jobs/my-applications', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (status !== 200) fail(`getMyApplications failed: ${status}`);
  return data;
}

// ── Runner ──────────────────────────────────────────────────────────────────
(async () => {
  console.log(`\nSebenza API E2E → ${BASE_URL}`);
  console.log(`Poster: ${poster.email}\nHelper: ${helper.email}`);

  try {
    phase('0/7 Fetch CSRF token');
    await fetchCsrfToken();

    phase('1/7 Register poster');
    await register(poster);
    ok('poster registered');

    phase('2/7 Register helper');
    await register(helper);
    ok('helper registered');

    phase('3/7 Login both users');
    const posterToken = await login(poster);
    const helperToken = await login(helper);
    ok('both logged in');

    phase('4/7 Poster posts job');
    const jobTitle = `E2E Test Job ${Date.now()}`;
    const jobId = await postJob(posterToken, jobTitle);
    ok(`job posted: ${jobId}`);

    phase('5/7 Helper applies to job');
    const appResult = await applyToJob(helperToken, jobId);
    ok('helper applied');

    // Fetch application ID from the job
    const jobAfterApply = await getJob(helperToken, jobId);
    const myApp = jobAfterApply.applications?.find(a => String(a.applicantId) === String(jobAfterApply.myApplication?.applicantId?._id || jobAfterApply.myApplication?.applicantId));
    const applicationId = jobAfterApply.myApplication?._id || myApp?._id;
    if (!applicationId) fail('Could not find application ID after applying');
    ok(`application ID: ${applicationId}`);

    // ── THE REGRESSION CHECK ──
    const myAppsBeforeApprove = await getMyApplications(helperToken);
    const myJobBefore = myAppsBeforeApprove.find(j => String(j._id) === String(jobId));
    if (!myJobBefore) fail('job not found in my-applications');
    ok('job found in my-applications');

    phase('6/7 Poster approves helper');
    await approveApplicant(posterToken, jobId, applicationId);
    ok('poster approved helper');

    // ── THE KEY REGRESSION CHECK ──
    phase('7/7 Verify myApplication present after approval');

    const myAppsAfter = await getMyApplications(helperToken);
    const myJobAfter = myAppsAfter.find(j => String(j._id) === String(jobId));
    if (!myJobAfter) fail('job not found in my-applications after approve');

    if (!myJobAfter.myApplication) {
      fail('REGRESSION: myApplication is MISSING — Confirm button will not render!');
    }
    ok('myApplication is present');

    if (myJobAfter.myApplication.status !== 'approved') {
      fail(`REGRESSION: myApplication.status = ${myJobAfter.myApplication.status}, expected 'approved'`);
    }
    ok(`myApplication.status = 'approved'`);

    // Verify the job detail endpoint also returns myApplication
    const jobDetail = await getJob(helperToken, jobId);
    if (!jobDetail.myApplication) {
      fail('REGRESSION: job detail missing myApplication');
    }
    ok('job detail includes myApplication');

    // Try to confirm the job (the previously-stuck step)
    await confirmJob(helperToken, jobId, applicationId);
    ok('helper confirmed the job — deadlock BROKEN');

    phase('RESULT');
    console.log('\n\x1b[1m\x1b[32m✅ ALL PHASES PASSED — myApplication fix verified end-to-end\x1b[0m\n');
  } catch (err) {
    phase('FAILURE');
    console.error(`\n\x1b[1m\x1b[31m✗ ${err.message}\x1b[0m\n`);
    process.exit(1);
  }
})();
