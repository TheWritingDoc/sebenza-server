const test = require('node:test');
const assert = require('node:assert');

// Save original env vars
const originalEnv = { ...process.env };

function cleanEnv() {
  delete process.env.MONGODB_ATLAS_PUBLIC_KEY;
  delete process.env.MONGODB_ATLAS_PRIVATE_KEY;
  delete process.env.MONGODB_ATLAS_PROJECT_ID;
  delete process.env.MONGODB_ATLAS_CLUSTER_NAME;
}

function restoreEnv() {
  process.env = { ...originalEnv };
}

function reloadAtlas() {
  delete require.cache[require.resolve('../lib/atlas')];
  return require('../lib/atlas');
}

test('throws when Atlas API keys are missing', async () => {
  cleanEnv();
  const atlas = reloadAtlas();
  await assert.rejects(
    () => atlas.getClusterStatus(),
    /MongoDB Atlas API keys not configured/
  );
  restoreEnv();
});

test('throws when project ID is missing', async () => {
  cleanEnv();
  process.env.MONGODB_ATLAS_PUBLIC_KEY = 'test-public';
  process.env.MONGODB_ATLAS_PRIVATE_KEY = 'test-private';
  const atlas = reloadAtlas();
  await assert.rejects(
    () => atlas.getClusterStatus(),
    /MONGODB_ATLAS_PROJECT_ID not set/
  );
  restoreEnv();
});

test('throws when cluster name is missing', async () => {
  cleanEnv();
  process.env.MONGODB_ATLAS_PUBLIC_KEY = 'test-public';
  process.env.MONGODB_ATLAS_PRIVATE_KEY = 'test-private';
  process.env.MONGODB_ATLAS_PROJECT_ID = 'test-project';
  const atlas = reloadAtlas();
  await assert.rejects(
    () => atlas.getClusterStatus(),
    /MONGODB_ATLAS_CLUSTER_NAME not set/
  );
  restoreEnv();
});
