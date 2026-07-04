// Escrow lifecycle regression test — runs without a database.
// Injects an in-memory fake Prisma client (via require-cache priming of ../db)
// so we can verify the actual money arithmetic in utils/escrow.js:
// fund → (partial release) → release/refund.
// Usage: node test/escrow.test.js

const assert = require('assert');

const POSTER = '11111111-1111-4111-8111-111111111111';
const PROVIDER = '22222222-2222-4222-8222-222222222222';
const JOB = '33333333-3333-4333-8333-333333333333';

// ── In-memory fake Prisma ──────────────────────────────────────────────────
const db = { users: [], transactions: [], txSeq: 0 };

function applyData(row, data) {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && !(v instanceof Date) && ('increment' in v || 'decrement' in v)) {
      row[k] = (Number(row[k]) || 0) + (v.increment !== undefined ? v.increment : -v.decrement);
    } else {
      row[k] = v;
    }
  }
}

function matches(row, where) {
  for (const [k, v] of Object.entries(where)) {
    if (v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v)) {
      if ('in' in v && !v.in.includes(row[k])) return false;
      if ('gte' in v && !(Number(row[k]) >= Number(v.gte))) return false;
      if ('lt' in v && !(Number(row[k]) < Number(v.lt))) return false;
    } else if (String(row[k]) !== String(v) && !(Number.isFinite(Number(v)) && Number(row[k] || 0) === Number(v))) {
      return false;
    }
  }
  return true;
}

function collection(rows) {
  return {
    findFirst: async ({ where }) => rows.find(r => matches(r, where)) || null,
    findUnique: async ({ where, select }) => {
      const r = rows.find(x => String(x.id) === String(where.id) || (where.email && x.email === where.email));
      return r || null;
    },
    updateMany: async ({ where, data }) => {
      const hit = rows.filter(r => matches(r, where));
      hit.forEach(r => applyData(r, data));
      return { count: hit.length };
    },
    update: async ({ where, data }) => {
      const r = rows.find(x => String(x.id) === String(where.id));
      if (!r) { const e = new Error('Record not found'); e.code = 'P2025'; throw e; }
      applyData(r, data);
      return r;
    },
    create: async ({ data }) => {
      const row = { id: `tx-${++db.txSeq}`, partialReleaseAmount: 0, ...data };
      rows.push(row);
      return row;
    },
  };
}

const fakePrisma = {
  get user() { return collection(db.users); },
  get transaction() { return collection(db.transactions); },
  $transaction: async (fn) => fn(fakePrisma),
};

// Prime the require cache so utils/escrow.js gets the fake client.
const dbModulePath = require.resolve('../db');
require.cache[dbModulePath] = {
  id: dbModulePath, filename: dbModulePath, loaded: true,
  exports: { prisma: fakePrisma, Prisma: {} },
};

const { createEscrowTransaction, releaseEscrow, partialReleaseEscrow, refundEscrow } = require('../utils/escrow');

function makeUser(id, randBalance, escrowRand = 0, totalEarnedRand = 0) {
  const u = { id, randBalance, escrowRand, totalEarnedRand };
  db.users.push(u);
  return u;
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try {
    db.users = []; db.transactions = [];
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}\n     ${err.message}`);
    failed++;
  }
}

const jobBase = { id: JOB, posterId: POSTER, paymentMethod: 'escrow', images: [] };
const app = { applicantId: PROVIDER };

(async () => {
  console.log('\n🧪  escrow lifecycle tests (Prisma)\n');

  await test('fund escrow: moves poster balance into escrowRand and holds it', async () => {
    const poster = makeUser(POSTER, 1000);
    const tx = await createEscrowTransaction(jobBase, app, 300);
    assert.strictEqual(poster.randBalance, 700);
    assert.strictEqual(poster.escrowRand, 300);
    assert.strictEqual(tx.escrowStatus, 'held');
    assert.strictEqual(Number(tx.randAmount), 300);
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

  await test('fund is idempotent per job: second call returns the existing tx', async () => {
    const poster = makeUser(POSTER, 1000);
    const tx1 = await createEscrowTransaction(jobBase, app, 300);
    const tx2 = await createEscrowTransaction(jobBase, app, 300);
    assert.strictEqual(tx1.id, tx2.id);
    assert.strictEqual(poster.randBalance, 700, 'must not double-deduct');
    assert.strictEqual(db.transactions.length, 1);
  });

  await test('release: pays provider, clears poster escrow, marks completed', async () => {
    const poster = makeUser(POSTER, 700, 300);
    const provider = makeUser(PROVIDER, 50, 0, 0);
    db.transactions.push({ id: 't1', requesterId: POSTER, providerId: PROVIDER, jobId: JOB, randAmount: 300, paymentMethod: 'escrow', escrowStatus: 'held', status: 'in_progress', partialReleaseAmount: 0 });
    await releaseEscrow(db.transactions[0]);
    assert.strictEqual(poster.escrowRand, 0);
    assert.strictEqual(provider.randBalance, 350);
    assert.strictEqual(provider.totalEarnedRand, 300);
    assert.strictEqual(db.transactions[0].escrowStatus, 'released');
    assert.strictEqual(db.transactions[0].status, 'completed');
  });

  await test('release is idempotent: double release cannot double-pay', async () => {
    const poster = makeUser(POSTER, 700, 300);
    const provider = makeUser(PROVIDER, 0);
    db.transactions.push({ id: 't1', requesterId: POSTER, providerId: PROVIDER, jobId: JOB, randAmount: 300, paymentMethod: 'escrow', escrowStatus: 'held', status: 'in_progress', partialReleaseAmount: 0 });
    await releaseEscrow(db.transactions[0]);
    await releaseEscrow(db.transactions[0]);
    assert.strictEqual(provider.randBalance, 300);
    assert.strictEqual(poster.escrowRand, 0);
  });

  await test('partial release: caps at 50% and moves the money once', async () => {
    const poster = makeUser(POSTER, 700, 300);
    const provider = makeUser(PROVIDER, 0);
    db.transactions.push({ id: 't1', requesterId: POSTER, providerId: PROVIDER, jobId: JOB, randAmount: 300, paymentMethod: 'escrow', escrowStatus: 'held', status: 'in_progress', partialReleaseAmount: 0 });
    await partialReleaseEscrow(db.transactions[0], 80, POSTER); // asks 80%, capped to 50%
    assert.strictEqual(Number(db.transactions[0].partialReleaseAmount), 150);
    assert.strictEqual(provider.randBalance, 150);
    assert.strictEqual(poster.escrowRand, 150);
  });

  await test('partial release: second attempt is rejected', async () => {
    makeUser(POSTER, 700, 300);
    makeUser(PROVIDER, 0);
    db.transactions.push({ id: 't1', requesterId: POSTER, providerId: PROVIDER, jobId: JOB, randAmount: 300, paymentMethod: 'escrow', escrowStatus: 'held', status: 'in_progress', partialReleaseAmount: 0 });
    await partialReleaseEscrow(db.transactions[0], 50, POSTER);
    await assert.rejects(
      () => partialReleaseEscrow(db.transactions[0], 10, POSTER),
      /already done/
    );
  });

  await test('release after partial: only the remainder moves', async () => {
    const poster = makeUser(POSTER, 700, 300);
    const provider = makeUser(PROVIDER, 0);
    db.transactions.push({ id: 't1', requesterId: POSTER, providerId: PROVIDER, jobId: JOB, randAmount: 300, paymentMethod: 'escrow', escrowStatus: 'held', status: 'in_progress', partialReleaseAmount: 0 });
    await partialReleaseEscrow(db.transactions[0], 50, POSTER); // 150 out
    await releaseEscrow(db.transactions[0]);                    // remaining 150
    assert.strictEqual(provider.randBalance, 300);
    assert.strictEqual(provider.totalEarnedRand, 300);
    assert.strictEqual(poster.escrowRand, 0);
  });

  await test('refund: returns held funds to poster and marks refunded', async () => {
    const poster = makeUser(POSTER, 700, 300);
    makeUser(PROVIDER, 0);
    db.transactions.push({ id: 't1', requesterId: POSTER, providerId: PROVIDER, jobId: JOB, randAmount: 300, paymentMethod: 'escrow', escrowStatus: 'held', status: 'in_progress', partialReleaseAmount: 0 });
    await refundEscrow(db.transactions[0]);
    assert.strictEqual(poster.randBalance, 1000);
    assert.strictEqual(poster.escrowRand, 0);
    assert.strictEqual(db.transactions[0].escrowStatus, 'refunded');
    assert.strictEqual(db.transactions[0].status, 'cancelled');
  });

  await test('refund after partial: provider keeps the advance, poster gets the rest', async () => {
    const poster = makeUser(POSTER, 700, 300);
    const provider = makeUser(PROVIDER, 0);
    db.transactions.push({ id: 't1', requesterId: POSTER, providerId: PROVIDER, jobId: JOB, randAmount: 300, paymentMethod: 'escrow', escrowStatus: 'held', status: 'in_progress', partialReleaseAmount: 0 });
    await partialReleaseEscrow(db.transactions[0], 50, POSTER); // provider gets 150
    await refundEscrow(db.transactions[0]);                     // poster refunded 150
    assert.strictEqual(provider.randBalance, 150);
    assert.strictEqual(poster.randBalance, 850);
    assert.strictEqual(poster.escrowRand, 0);
    assert.strictEqual(db.transactions[0].escrowStatus, 'refunded');
  });

  console.log(`\n${passed}/${passed + failed} tests passed\n`);
  process.exit(failed ? 1 : 0);
})();
