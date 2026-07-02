const test = require('node:test');
const assert = require('node:assert');
const { whitelistSelf, getPublicIP } = require('../lib/atlas-whitelist');

test('getPublicIP returns a valid IPv4 address', async () => {
  const ip = await getPublicIP();
  assert.match(ip, /^\d+\.\d+\.\d+\.\d+$/);
});

test('whitelistSelf adds new IP when not in access list', async () => {
  const mockAtlas = {
    listAccessList: async () => ({ results: [] }),
    addAccessListEntry: async (ip, comment) => ({ ipAddress: ip, cidrBlock: `${ip}/32`, comment })
  };
  const result = await whitelistSelf({ comment: 'Test', atlasClient: mockAtlas });
  assert.ok(result.ip);
  assert.match(result.ip, /^\d+\.\d+\.\d+\.\d+$/);
  assert.strictEqual(result.alreadyWhitelisted, false);
  assert.ok(result.created);
});

test('whitelistSelf returns alreadyWhitelisted when IP exists', async () => {
  const ip = await getPublicIP();
  const mockAtlas = {
    listAccessList: async () => ({ results: [{ cidrBlock: `${ip}/32`, ipAddress: ip }] }),
    addAccessListEntry: async () => { throw new Error('Should not be called'); }
  };
  const result = await whitelistSelf({ atlasClient: mockAtlas });
  assert.strictEqual(result.ip, ip);
  assert.strictEqual(result.alreadyWhitelisted, true);
});

console.log('\n✅ Atlas whitelist unit tests passed');
