// Escrow lifecycle regression test — runs without a database.
// Stubs the mongoose model statics/save so we can verify the actual money
// arithmetic in utils/escrow.js: fund → (partial release) → release/refund.
// Usage: node test/escrow.test.js

const assert = require('assert');
const User = require('../models/User');
const Transaction = require('../models/Transaction');

// Valid ObjectId hex strings — mongoose silently drops invalid casts,
// which would make every balance lookup miss.
const POSTER = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const PROVIDER = 'bbbbbbbbbbbbbbbbbbbbbbbb';

// ── Stubs ───────────────────────────────────────────────────────────────────
let users = {};
let existingTx = null;

User.findById = async (id) => users[String(id)] || null;
Transaction.findOne = async () => existingTx;
Transaction.prototype.save = async function () { return this; };

function makeUser(id, randBalance, escrowRand = 0, totalEarnedRand = 0) {
  const u = { _id: id, randBalance, escrowRand, totalEarnedRand, saves: 0 };
  u.save = async function () { this.saves++; return this; };
  users[id] = u;
  return u;
}

const { createEscrowTransaction, releaseEscrow, partialReleaseEscrow, refundEscrow } = require('../utils/escrow');

let passed = 0, failed = 0;
async function test(name, fn) {
  try {
    users = {};
    existingTx = null;
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}\n     ${err.message}`);
    failed++;
  }
}

const jobBase = { _id: 'job1', posterId: POSTER, paymentMethod: 'escrow' };
const app = { applicantId: PROVIDER };

(async () => {
  console.log('\n🧪  escrow lifecycle tests\n');

  await test('fund escrow: moves poster balance into escrowRand and holds it', async () => {
    const poster = makeUser(POSTER, 1000);
    const tx = await createEscrowTransaction(jobBase, app, 300);
    assert.strictEqual(poster.randBalance, 700);
    assert.strictEqual(poster.escrowRand, 300);
    assert.strictEqual(tx.escrowStatus, 'held');
    assert.strictEqual(tx.randAmount, 300);
    assert.strictEqual(String(tx.requesterId), POSTER);
    assert.strictEqual(String(tx.providerId), PROVIDER);
  });

  await test('fund escrow: throws INSUFFICIENT_BALANCE and leaves balance untouched', async () => {
    const poster = makeUser(POSTER, 100);
    await assert.rejects(
      () => createEscrowTransaction(jobBase, app, 300),
      (err) => err.code === 'INSUFFICIENT_BALANCE'
    );
    assert.strictEqual(poster.randBalance, 100);
    assert.strictEqual(poster.escrowRand, 0);
  });

  await test('fund cash job: no balance movement, escrowStatus none', async () => {
    const poster = makeUser(POSTER, 1000);
    const tx = await createEscrowTransaction({ ...jobBase, paymentMethod: 'cash' }, app, 300);
    assert.strictEqual(poster.randBalance, 1000);
    assert.strictEqual(poster.escrowRand, 0);
    assert.strictEqual(tx.escrowStatus, 'none');
  });

  await test('fund escrow: idempotent — returns existing transaction, no double deduction', async () => {
    const poster = makeUser(POSTER, 1000);
    existingTx = { _id: 'tx-existing', status: 'in_progress' };
    const tx = await createEscrowTransaction(jobBase, app, 300);
    assert.strictEqual(tx._id, 'tx-existing');
    assert.strictEqual(poster.randBalance, 1000);
  });

  await test('release: full amount moves from poster escrow to provider balance', async () => {
    const poster = makeUser(POSTER, 700, 300);
    const provider = makeUser(PROVIDER, 50, 0, 20);
    const tx = new Transaction({ requesterId: POSTER, providerId: PROVIDER, randAmount: 300, paymentMethod: 'escrow', escrowStatus: 'held', status: 'in_progress' });
    await releaseEscrow(tx);
    assert.strictEqual(poster.escrowRand, 0);
    assert.strictEqual(provider.randBalance, 350);
    assert.strictEqual(provider.totalEarnedRand, 320);
    assert.strictEqual(tx.status, 'completed');
    assert.strictEqual(tx.escrowStatus, 'released');
  });

  await test('release: idempotent — second call moves nothing', async () => {
    const poster = makeUser(POSTER, 700, 300);
    const provider = makeUser(PROVIDER, 0);
    const tx = new Transaction({ requesterId: POSTER, providerId: PROVIDER, randAmount: 300, paymentMethod: 'escrow', escrowStatus: 'held', status: 'in_progress' });
    await releaseEscrow(tx);
    await releaseEscrow(tx);
    assert.strictEqual(provider.randBalance, 300); // not 600
    assert.strictEqual(poster.escrowRand, 0);
  });

  await test('partial release: caps at 50%, moves funds, once-only', async () => {
    const poster = makeUser(POSTER, 700, 300);
    const provider = makeUser(PROVIDER, 0);
    const tx = new Transaction({ requesterId: POSTER, providerId: PROVIDER, randAmount: 300, paymentMethod: 'escrow', escrowStatus: 'held', status: 'in_progress' });
    await partialReleaseEscrow(tx, 80, POSTER); // asks 80%, capped to 50%
    assert.strictEqual(tx.partialReleaseAmount, 150);
    assert.strictEqual(provider.randBalance, 150);
    assert.strictEqual(poster.escrowRand, 150);
    await assert.rejects(() => partialReleaseEscrow(tx, 10, POSTER), /already done/);
  });

  await test('release after partial: only the remainder moves', async () => {
    const poster = makeUser(POSTER, 700, 150);
    const provider = makeUser(PROVIDER, 150, 0, 150);
    const tx = new Transaction({ requesterId: POSTER, providerId: PROVIDER, randAmount: 300, paymentMethod: 'escrow', escrowStatus: 'held', status: 'in_progress', partialReleaseAmount: 150 });
    await releaseEscrow(tx);
    assert.strictEqual(provider.randBalance, 300);      // 150 + remaining 150
    assert.strictEqual(provider.totalEarnedRand, 300);
    assert.strictEqual(poster.escrowRand, 0);
  });

  await test('refund: held funds return to poster balance', async () => {
    const poster = makeUser(POSTER, 700, 300);
    const tx = new Transaction({ requesterId: POSTER, providerId: PROVIDER, randAmount: 300, paymentMethod: 'escrow', escrowStatus: 'held', status: 'in_progress' });
    await refundEscrow(tx);
    assert.strictEqual(poster.randBalance, 1000);
    assert.strictEqual(poster.escrowRand, 0);
    assert.strictEqual(tx.status, 'cancelled');
    assert.strictEqual(tx.escrowStatus, 'refunded');
  });

  await test('refund after partial: provider keeps advance, poster gets remainder', async () => {
    const poster = makeUser(POSTER, 700, 150);
    const tx = new Transaction({ requesterId: POSTER, providerId: PROVIDER, randAmount: 300, paymentMethod: 'escrow', escrowStatus: 'held', status: 'in_progress', partialReleaseAmount: 150 });
    await refundEscrow(tx);
    assert.strictEqual(poster.randBalance, 850);  // 700 + remaining 150
    assert.strictEqual(poster.escrowRand, 0);
  });

  await test('refund: idempotent — no-op when already released or refunded', async () => {
    const poster = makeUser(POSTER, 700, 0);
    const tx = new Transaction({ requesterId: POSTER, providerId: PROVIDER, randAmount: 300, paymentMethod: 'escrow', escrowStatus: 'released', status: 'completed' });
    await refundEscrow(tx);
    assert.strictEqual(poster.randBalance, 700);
    assert.strictEqual(tx.escrowStatus, 'released');
  });

  console.log(`\n${passed}/${passed + failed} tests passed\n`);
  process.exit(failed ? 1 : 0);
})();
