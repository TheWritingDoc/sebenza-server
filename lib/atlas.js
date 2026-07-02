const DigestClient = require('digest-fetch').DigestClient;

const {
  MONGODB_ATLAS_PUBLIC_KEY,
  MONGODB_ATLAS_PRIVATE_KEY,
  MONGODB_ATLAS_PROJECT_ID,
  MONGODB_ATLAS_CLUSTER_NAME
} = process.env;

const ATLAS_API_BASE = 'https://cloud.mongodb.com/api/atlas/v1.0';

function getClient() {
  if (!MONGODB_ATLAS_PUBLIC_KEY || !MONGODB_ATLAS_PRIVATE_KEY) {
    throw new Error('MongoDB Atlas API keys not configured');
  }
  return new DigestClient(MONGODB_ATLAS_PUBLIC_KEY, MONGODB_ATLAS_PRIVATE_KEY);
}

async function atlasRequest(method, path, data) {
  const client = getClient();
  const url = `${ATLAS_API_BASE}${path}`;
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (data !== undefined) {
    options.body = JSON.stringify(data);
  }
  const response = await client.fetch(url, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Atlas API ${method} ${path} failed: ${response.status} ${text}`);
  }
  return response.json();
}

// Projects / Groups
async function listProjects() {
  return atlasRequest('GET', '/groups');
}

async function getProject() {
  if (!MONGODB_ATLAS_PROJECT_ID) throw new Error('MONGODB_ATLAS_PROJECT_ID not set');
  return atlasRequest('GET', `/groups/${MONGODB_ATLAS_PROJECT_ID}`);
}

// Clusters
async function listClusters() {
  const client = getClient();
  if (!MONGODB_ATLAS_PROJECT_ID) throw new Error('MONGODB_ATLAS_PROJECT_ID not set');
  const url = `${ATLAS_API_BASE}/groups/${MONGODB_ATLAS_PROJECT_ID}/clusters`;
  const response = await client.fetch(url, { method: 'GET' });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Atlas API GET /clusters failed: ${response.status} ${text}`);
  }
  return response.json();
}

async function getCluster(name = MONGODB_ATLAS_CLUSTER_NAME) {
  const client = getClient();
  if (!MONGODB_ATLAS_PROJECT_ID) throw new Error('MONGODB_ATLAS_PROJECT_ID not set');
  if (!name) throw new Error('MONGODB_ATLAS_CLUSTER_NAME not set');
  const url = `${ATLAS_API_BASE}/groups/${MONGODB_ATLAS_PROJECT_ID}/clusters/${name}`;
  const response = await client.fetch(url, { method: 'GET' });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Atlas API GET /clusters/${name} failed: ${response.status} ${text}`);
  }
  return response.json();
}

async function pauseCluster(name = MONGODB_ATLAS_CLUSTER_NAME) {
  return atlasRequest('PATCH', `/groups/${MONGODB_ATLAS_PROJECT_ID}/clusters/${name}`, {
    paused: true
  });
}

async function resumeCluster(name = MONGODB_ATLAS_CLUSTER_NAME) {
  return atlasRequest('PATCH', `/groups/${MONGODB_ATLAS_PROJECT_ID}/clusters/${name}`, {
    paused: false
  });
}

// Database users
async function listDatabaseUsers() {
  return atlasRequest('GET', `/groups/${MONGODB_ATLAS_PROJECT_ID}/databaseUsers`);
}

async function createDatabaseUser(username, password, roles = [{ roleName: 'readWriteAnyDatabase', databaseName: 'admin' }]) {
  return atlasRequest('POST', `/groups/${MONGODB_ATLAS_PROJECT_ID}/databaseUsers`, {
    username,
    password,
    roles
  });
}

async function deleteDatabaseUser(username) {
  return atlasRequest('DELETE', `/groups/${MONGODB_ATLAS_PROJECT_ID}/databaseUsers/admin/${username}`);
}

// IP Access List
async function listAccessList() {
  return atlasRequest('GET', `/groups/${MONGODB_ATLAS_PROJECT_ID}/accessList`);
}

async function addAccessListEntry(ip, comment = 'Added by Hermes automation') {
  return atlasRequest('POST', `/groups/${MONGODB_ATLAS_PROJECT_ID}/accessList`, {
    ipAddress: ip,
    comment
  });
}

async function deleteAccessListEntry(ip) {
  return atlasRequest('DELETE', `/groups/${MONGODB_ATLAS_PROJECT_ID}/accessList/${encodeURIComponent(ip)}`);
}

// Backups / Snapshots
async function listSnapshots(name = MONGODB_ATLAS_CLUSTER_NAME) {
  return atlasRequest('GET', `/groups/${MONGODB_ATLAS_PROJECT_ID}/clusters/${name}/backup/snapshots`);
}

async function createSnapshot(name = MONGODB_ATLAS_CLUSTER_NAME, description = 'Manual snapshot by Hermes') {
  return atlasRequest('POST', `/groups/${MONGODB_ATLAS_PROJECT_ID}/clusters/${name}/backup/snapshots`, {
    description,
    retention: 1
  });
}

// Health check
async function getClusterStatus() {
  const cluster = await getCluster();
  return {
    name: cluster.name,
    state: cluster.stateName,
    paused: cluster.paused,
    mongoDBVersion: cluster.mongoDBVersion,
    connectionString: cluster.connectionStrings?.standardSrv,
    region: cluster.replicationSpec
  };
}

module.exports = {
  listProjects,
  getProject,
  listClusters,
  getCluster,
  pauseCluster,
  resumeCluster,
  listDatabaseUsers,
  createDatabaseUser,
  deleteDatabaseUser,
  listAccessList,
  addAccessListEntry,
  deleteAccessListEntry,
  listSnapshots,
  createSnapshot,
  getClusterStatus
};