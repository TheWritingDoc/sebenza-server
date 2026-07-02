const atlas = require('./atlas');

/**
 * Fetch the current public IP address.
 */
async function getPublicIP() {
  const services = [
    { url: 'https://api.ipify.org?format=json', json: true },
    { url: 'https://checkip.amazonaws.com', json: false },
    { url: 'https://icanhazip.com', json: false },
    { url: 'https://api64.ipify.org?format=json', json: true }
  ];
  for (const { url, json } of services) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      const text = await res.text();
      const ip = json ? JSON.parse(text).ip : text.trim();
      if (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) return ip;
    } catch (err) {
      console.warn(`IP lookup failed for ${url}:`, err.message);
    }
  }
  throw new Error('Could not determine public IP');
}

/**
 * Ensure the current public IP is whitelisted in MongoDB Atlas.
 * Returns { ip, created, comment } if added or already exists.
 * An optional `atlas` dependency can be injected for testing.
 */
async function whitelistSelf({ comment = 'Auto-whitelisted by Sebenza server', atlasClient = atlas } = {}) {
  const ip = await getPublicIP();
  const cidr = `${ip}/32`;
  const entries = await atlasClient.listAccessList();
  const exists = entries.results?.some(e => e.cidrBlock === cidr || e.ipAddress === ip);
  if (exists) {
    return { ip, alreadyWhitelisted: true };
  }
  const result = await atlasClient.addAccessListEntry(ip, comment);
  return { ip, alreadyWhitelisted: false, created: result, comment };
}

module.exports = { getPublicIP, whitelistSelf };
