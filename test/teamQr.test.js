// Team QR check-in tests — pure functions, no DB. Run: node test/teamQr.test.js
const assert = require('assert');
const { genTeamCode, buildQrPayload, parseQrPayload, isCodeValid, CODE_TTL_MS } = require('../utils/teamQr');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n     ${e.message}`); failed++; }
}

console.log('\n🧪  team QR check-in tests\n');

test('generated codes are 6 chars from the unambiguous alphabet', () => {
  for (let i = 0; i < 50; i++) {
    const c = genTeamCode();
    assert.strictEqual(c.length, 6);
    assert.ok(/^[A-HJ-NP-Z2-9]+$/.test(c), `no 0/O/1/I allowed, got ${c}`);
  }
});

test('payload round-trips through parse', () => {
  const teamId = '64b7f3a1c2d4e5f6a7b8c9d0';
  const payload = buildQrPayload(teamId, 'ABC234');
  const parsed = parseQrPayload(payload);
  assert.strictEqual(parsed.teamId, teamId);
  assert.strictEqual(parsed.code, 'ABC234');
});

test('bare typed code parses with null teamId, uppercased', () => {
  const parsed = parseQrPayload('abc234');
  assert.strictEqual(parsed.teamId, null);
  assert.strictEqual(parsed.code, 'ABC234');
});

test('garbage, foreign QRs and malformed payloads are rejected', () => {
  assert.strictEqual(parseQrPayload(''), null);
  assert.strictEqual(parseQrPayload(null), null);
  assert.strictEqual(parseQrPayload('https://evil.example/phish'), null);
  assert.strictEqual(parseQrPayload('SEBENZA-TEAM:notahexid:ABC234'), null);
  assert.strictEqual(parseQrPayload('SEBENZA-TEAM:64b7f3a1c2d4e5f6a7b8c9d0'), null);
  assert.strictEqual(parseQrPayload('SEBENZA-TEAM:64b7f3a1c2d4e5f6a7b8c9d0:A:B'), null);
});

test('isCodeValid: matches active unexpired session only', () => {
  const future = new Date(Date.now() + CODE_TTL_MS);
  const team = { qrSession: { code: 'ABC234', expiresAt: future } };
  assert.strictEqual(isCodeValid(team, 'ABC234'), true);
  assert.strictEqual(isCodeValid(team, 'abc234'), true, 'case-insensitive');
  assert.strictEqual(isCodeValid(team, 'WRONG9'), false);
});

test('isCodeValid: expired or missing session fails', () => {
  const past = new Date(Date.now() - 1000);
  assert.strictEqual(isCodeValid({ qrSession: { code: 'ABC234', expiresAt: past } }, 'ABC234'), false);
  assert.strictEqual(isCodeValid({ qrSession: { code: 'ABC234' } }, 'ABC234'), false, 'no expiry = invalid');
  assert.strictEqual(isCodeValid({}, 'ABC234'), false);
  assert.strictEqual(isCodeValid(null, 'ABC234'), false);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
