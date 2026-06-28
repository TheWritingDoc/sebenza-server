// Sebenza E2E Test — simplified placeholder
// Full version requires Playwright + live server
// Usage: BASE_URL=https://sebenza-server.onrender.com node tests/e2e/sebenza-e2e.js

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

async function run() {
  console.log(`🧪 Sebenza E2E Test against ${BASE_URL}`);
  console.log('Note: Full E2E requires Playwright. This is a smoke test placeholder.');
  
  // Smoke test: API is reachable
  const resp = await fetch(`${BASE_URL}/api/jobs`);
  if (!resp.ok) throw new Error(`API unreachable: ${resp.status}`);
  const jobs = await resp.json();
  console.log(`✅ API reachable. ${jobs.length} jobs found.`);
  
  // Verify myApplication field is present on public jobs when authenticated
  // (Requires actual login flow — placeholder for full Playwright test)
  console.log('✅ Smoke test passed');
}

run().catch(e => {
  console.error('❌ E2E test failed:', e.message);
  process.exit(1);
});
