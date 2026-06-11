/**
 * Comprehensive Notification Flow Test for Gshop
 * Tests the complete job lifecycle with notifications
 */

const axios = require('axios');
const io = require('socket.io-client');

const BASE_URL = 'http://localhost:3001';
const API_URL = `${BASE_URL}/api`;

// Test users
const TEST_USERS = {
  poster: { email: 'test_poster@gshop.com', password: 'test123', name: 'Test Poster' },
  helper: { email: 'test_helper@gshop.com', password: 'test123', name: 'Test Helper' }
};

let tokens = {};
let userIds = {};
let jobId = null;
let applicationId = null;
let sockets = {};
let notificationsReceived = { poster: [], helper: [] };

// Helper: Login
async function login(email, password) {
  const res = await axios.post(`${API_URL}/login`, { email, password });
  return res.data;
}

// Helper: Register
async function register(user) {
  try {
    const res = await axios.post(`${API_URL}/register`, {
      ...user,
      phone: '+27123456789',
      location: { lat: -33.9249, lng: 18.4241 }
    });
    return res.data;
  } catch (err) {
    if (err.response?.data?.error?.includes('already registered')) {
      console.log(`  User ${user.email} already exists, logging in...`);
      return login(user.email, user.password);
    }
    throw err;
  }
}

// Helper: Create socket connection
function createSocket(token, userType) {
  return new Promise((resolve) => {
    const socket = io(BASE_URL, {
      auth: { token },
      transports: ['websocket']
    });

    socket.on('connect', () => {
      console.log(`  ${userType} socket connected: ${socket.id}`);
      socket.emit('register', userIds[userType]);
      socket.emit('user_online', userIds[userType]);
      resolve(socket);
    });

    socket.on('notification', (notif) => {
      console.log(`  📨 ${userType} received notification:`, {
        type: notif.type,
        title: notif.title,
        data: notif.data
      });
      notificationsReceived[userType].push(notif);
    });

    socket.on('connect_error', (err) => {
      console.error(`  ${userType} socket error:`, err.message);
    });
  });
}

// Helper: Create job
async function createJob(token) {
  const res = await axios.post(`${API_URL}/jobs`, {
    title: 'Test Job - Notification Flow',
    description: 'Testing the complete notification flow',
    category: 'Testing',
    budget: 500,
    location: { lat: -33.9249, lng: 18.4241 },
    isUrgent: false
  }, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return res.data;
}

// Helper: Apply for job
async function applyForJob(token, jobId, amount) {
  const res = await axios.post(`${API_URL}/jobs/${jobId}/apply`, {
    proposedAmount: amount,
    message: 'I can help with this test job'
  }, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return res.data;
}

// Helper: Approve application
async function approveApplication(token, jobId, appId, amount) {
  const res = await axios.post(`${API_URL}/jobs/${jobId}/applications/${appId}/approve`, {
    approvedAmount: amount,
    approvedTime: new Date().toISOString()
  }, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return res.data;
}

// Helper: Confirm offer (helper accepts)
async function confirmOffer(token, jobId, appId) {
  const res = await axios.post(`${API_URL}/jobs/${jobId}/applications/${appId}/confirm`, {}, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return res.data;
}

// Helper: Start job
async function startJob(token, jobId) {
  const res = await axios.post(`${API_URL}/jobs/${jobId}/start`, {}, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return res.data;
}

// Helper: Request completion
async function requestCompletion(token, jobId) {
  const res = await axios.post(`${API_URL}/jobs/${jobId}/request-completion`, {}, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return res.data;
}

// Helper: Confirm completion
async function confirmCompletion(token, jobId) {
  const res = await axios.post(`${API_URL}/jobs/${jobId}/confirm-completion`, {}, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return res.data;
}

// Helper: Get job details
async function getJob(token, jobId) {
  const res = await axios.get(`${API_URL}/jobs/${jobId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return res.data;
}

// Helper: Get notifications
async function getNotifications(token) {
  const res = await axios.get(`${API_URL}/notifications`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return res.data;
}

// Test Step 1: Setup users
async function step1_setup() {
  console.log('\n🔧 STEP 1: Setting up test users...');
  
  for (const [role, user] of Object.entries(TEST_USERS)) {
    const data = await register(user);
    tokens[role] = data.token;
    userIds[role] = data.user.id;
    console.log(`  ✅ ${role}: ${user.email} (ID: ${data.user.id})`);
  }
}

// Test Step 2: Connect sockets
async function step2_connectSockets() {
  console.log('\n🔌 STEP 2: Connecting WebSocket clients...');
  
  sockets.poster = await createSocket(tokens.poster, 'poster');
  sockets.helper = await createSocket(tokens.helper, 'helper');
  
  // Wait for registration
  await new Promise(r => setTimeout(r, 1000));
  console.log('  ✅ Both sockets connected and registered');
}

// Test Step 3: Create job
async function step3_createJob() {
  console.log('\n📋 STEP 3: Creating test job...');
  const job = await createJob(tokens.poster);
  jobId = job._id || job.id;
  console.log(`  ✅ Job created: ${jobId}`);
  console.log(`     Title: ${job.title}`);
  console.log(`     Status: ${job.status}`);
}

// Test Step 4: Helper applies
async function step4_apply() {
  console.log('\n📝 STEP 4: Helper applying for job...');
  const app = await applyForJob(tokens.helper, jobId, 450);
  applicationId = app._id || app.id;
  console.log(`  ✅ Application submitted: ${applicationId}`);
  console.log(`     Proposed amount: R${app.proposedAmount}`);
  
  // Wait for notification
  await new Promise(r => setTimeout(r, 1500));
  
  console.log(`  📊 Notifications received by poster: ${notificationsReceived.poster.length}`);
  const appNotif = notificationsReceived.poster.find(n => n.type === 'application_received');
  if (appNotif) {
    console.log(`     ✅ Poster received 'application_received' notification`);
    console.log(`        Data:`, JSON.stringify(appNotif.data, null, 2));
  } else {
    console.log(`     ❌ Poster did NOT receive application notification!`);
    console.log(`     Received types:`, notificationsReceived.poster.map(n => n.type));
  }
}

// Test Step 5: Poster approves
async function step5_approve() {
  console.log('\n✅ STEP 5: Poster approving application...');
  await approveApplication(tokens.poster, jobId, applicationId, 450);
  console.log(`  ✅ Application approved`);
  
  // Wait for notification
  await new Promise(r => setTimeout(r, 1500));
  
  console.log(`  📊 Notifications received by helper: ${notificationsReceived.helper.length}`);
  const approveNotif = notificationsReceived.helper.find(n => n.type === 'application_approved');
  if (approveNotif) {
    console.log(`     ✅ Helper received 'application_approved' notification`);
    console.log(`        Data:`, JSON.stringify(approveNotif.data, null, 2));
    
    // Check if data has required fields for frontend routing
    const checks = [
      ['screen', approveNotif.data?.screen],
      ['route', approveNotif.data?.route],
      ['tab', approveNotif.data?.tab],
      ['action', approveNotif.data?.action],
      ['autoRoute', approveNotif.data?.autoRoute]
    ];
    
    console.log(`     🔍 Routing data check:`);
    for (const [field, value] of checks) {
      console.log(`        ${value ? '✅' : '❌'} ${field}: ${value}`);
    }
  } else {
    console.log(`     ❌ Helper did NOT receive approval notification!`);
    console.log(`     Received types:`, notificationsReceived.helper.map(n => n.type));
  }
}

// Test Step 6: Helper confirms
async function step6_confirm() {
  console.log('\n🤝 STEP 6: Helper confirming offer...');
  try {
    const result = await confirmOffer(tokens.helper, jobId, applicationId);
    console.log(`  ✅ Offer confirmed`);
    console.log(`     Job status: ${result.job?.status}`);
    
    // Wait for notification
    await new Promise(r => setTimeout(r, 1500));
    
    console.log(`  📊 Notifications received by poster: ${notificationsReceived.poster.length}`);
    const confirmNotif = notificationsReceived.poster.find(n => n.type === 'offer_accepted');
    if (confirmNotif) {
      console.log(`     ✅ Poster received 'offer_accepted' notification`);
      console.log(`        Data:`, JSON.stringify(confirmNotif.data, null, 2));
    } else {
      console.log(`     ❌ Poster did NOT receive confirmation notification!`);
    }
  } catch (err) {
    console.log(`  ❌ Error confirming offer:`, err.response?.data || err.message);
  }
}

// Test Step 7: Start job
async function step7_startJob() {
  console.log('\n🚀 STEP 7: Starting job...');
  try {
    await startJob(tokens.poster, jobId);
    console.log(`  ✅ Job started`);
    
    // Wait for notification
    await new Promise(r => setTimeout(r, 1500));
    
    console.log(`  📊 Notifications received by helper: ${notificationsReceived.helper.length}`);
    const startNotif = notificationsReceived.helper.find(n => n.type === 'job_started');
    if (startNotif) {
      console.log(`     ✅ Helper received 'job_started' notification`);
      console.log(`        Data:`, JSON.stringify(startNotif.data, null, 2));
    } else {
      console.log(`     ❌ Helper did NOT receive job started notification!`);
    }
  } catch (err) {
    console.log(`  ❌ Error starting job:`, err.response?.data || err.message);
  }
}

// Test Step 8: Request completion
async function step8_requestCompletion() {
  console.log('\n🏁 STEP 8: Requesting completion...');
  try {
    await requestCompletion(tokens.helper, jobId);
    console.log(`  ✅ Completion requested`);
    
    // Wait for notification
    await new Promise(r => setTimeout(r, 1500));
    
    console.log(`  📊 Notifications received by poster: ${notificationsReceived.poster.length}`);
    const completeNotif = notificationsReceived.poster.find(n => n.type === 'completion_requested');
    if (completeNotif) {
      console.log(`     ✅ Poster received 'completion_requested' notification`);
      console.log(`        Data:`, JSON.stringify(completeNotif.data, null, 2));
    } else {
      console.log(`     ❌ Poster did NOT receive completion request notification!`);
    }
  } catch (err) {
    console.log(`  ❌ Error requesting completion:`, err.response?.data || err.message);
  }
}

// Test Step 9: Confirm completion
async function step9_confirmCompletion() {
  console.log('\n🎉 STEP 9: Confirming completion...');
  try {
    await confirmCompletion(tokens.poster, jobId);
    console.log(`  ✅ Completion confirmed`);
    
    // Wait for notification
    await new Promise(r => setTimeout(r, 1500));
    
    console.log(`  📊 Notifications received by helper: ${notificationsReceived.helper.length}`);
    const paymentNotif = notificationsReceived.helper.find(n => n.type === 'job_pending_payment');
    if (paymentNotif) {
      console.log(`     ✅ Helper received 'job_pending_payment' notification`);
      console.log(`        Data:`, JSON.stringify(paymentNotif.data, null, 2));
    } else {
      console.log(`     ❌ Helper did NOT receive payment notification!`);
    }
  } catch (err) {
    console.log(`  ❌ Error confirming completion:`, err.response?.data || err.message);
  }
}

// Test Step 10: Final state check
async function step10_finalCheck() {
  console.log('\n📊 STEP 10: Final state check...');
  
  const job = await getJob(tokens.poster, jobId);
  console.log(`  Job status: ${job.status}`);
  console.log(`  Applications: ${job.applications?.length}`);
  
  if (job.applications?.[0]) {
    console.log(`  Application status: ${job.applications[0].status}`);
  }
  
  // Check persisted notifications
  const posterNotifs = await getNotifications(tokens.poster);
  const helperNotifs = await getNotifications(tokens.helper);
  
  console.log(`\n  📬 Persisted notifications:`);
  console.log(`     Poster: ${posterNotifs.notifications?.length || 0} total`);
  console.log(`     Helper: ${helperNotifs.notifications?.length || 0} total`);
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📋 NOTIFICATION FLOW SUMMARY');
  console.log('='.repeat(60));
  
  const expectedFlow = [
    { step: 'Apply', type: 'application_received', recipient: 'poster' },
    { step: 'Approve', type: 'application_approved', recipient: 'helper' },
    { step: 'Confirm', type: 'offer_accepted', recipient: 'poster' },
    { step: 'Start', type: 'job_started', recipient: 'helper' },
    { step: 'Request Complete', type: 'completion_requested', recipient: 'poster' },
    { step: 'Confirm Complete', type: 'job_pending_payment', recipient: 'helper' }
  ];
  
  for (const expected of expectedFlow) {
    const received = notificationsReceived[expected.recipient].find(n => n.type === expected.type);
    const status = received ? '✅' : '❌';
    console.log(`  ${status} ${expected.step} → ${expected.type} → ${expected.recipient}`);
    if (received) {
      const hasRouting = received.data?.screen && received.data?.route && received.data?.action;
      console.log(`     ${hasRouting ? '✅' : '⚠️'}  Has routing data: ${hasRouting ? 'Yes' : 'No'}`);
    }
  }
}

// Cleanup
async function cleanup() {
  console.log('\n🧹 Cleaning up...');
  for (const socket of Object.values(sockets)) {
    socket.disconnect();
  }
  console.log('  ✅ Sockets disconnected');
}

// Main test runner
async function runTest() {
  console.log('='.repeat(60));
  console.log('🔍 GSHOP NOTIFICATION FLOW TEST');
  console.log('='.repeat(60));
  console.log(`Testing against: ${BASE_URL}`);
  console.log('This test traces the complete job lifecycle with notifications');
  
  try {
    await step1_setup();
    await step2_connectSockets();
    await step3_createJob();
    await step4_apply();
    await step5_approve();
    await step6_confirm();
    await step7_startJob();
    await step8_requestCompletion();
    await step9_confirmCompletion();
    await step10_finalCheck();
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ TEST COMPLETED');
    console.log('='.repeat(60));
  } catch (err) {
    console.error('\n❌ TEST FAILED:', err.message);
    console.error(err.stack);
  } finally {
    await cleanup();
    process.exit(0);
  }
}

runTest();
