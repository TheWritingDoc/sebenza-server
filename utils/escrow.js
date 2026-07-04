const { prisma } = require('../db');

/**
 * Escrow engine on Postgres. Every money movement runs inside a single
 * ACID transaction; idempotency guards are conditional updateMany calls whose
 * affected-row count decides whether the caller proceeds (only one concurrent
 * caller can win the guard update).
 */

const num = (v) => Number(v || 0);
const idOf = (obj) => obj?.id || obj?._id;

/**
 * Create an escrow transaction for a job. Deducts poster balance into escrow
 * and creates the Transaction row. Idempotent per job.
 */
async function createEscrowTransaction(job, acceptedApp, finalAmount, transactionStatus = 'in_progress') {
  return prisma.$transaction(async (tx) => {
    const existingTx = await tx.transaction.findFirst({
      where: { jobId: idOf(job), status: { in: ['in_progress', 'completed'] } }
    });
    if (existingTx) return existingTx;

    if (job.paymentMethod === 'escrow') {
      // Atomic funds check + move: only succeeds if the poster can cover it.
      const funded = await tx.user.updateMany({
        where: { id: job.posterId, randBalance: { gte: finalAmount } },
        data: {
          randBalance: { decrement: finalAmount },
          escrowRand: { increment: finalAmount }
        }
      });
      if (funded.count === 0) {
        const poster = await tx.user.findUnique({ where: { id: job.posterId }, select: { randBalance: true } });
        const err = new Error(`Insufficient balance: R${finalAmount} needed to fund escrow, poster has R${num(poster?.randBalance)}`);
        err.code = 'INSUFFICIENT_BALANCE';
        throw err;
      }
    }

    return tx.transaction.create({
      data: {
        requesterId: job.posterId,
        providerId: acceptedApp.applicantId,
        jobId: idOf(job),
        serviceId: null,
        randAmount: finalAmount,
        paymentMethod: job.paymentMethod,
        escrowStatus: job.paymentMethod === 'cash' ? 'none' : 'held',
        jobDescriptionImages: job.images || [],
        lat: job.lat ?? job.location?.lat ?? null,
        lng: job.lng ?? job.location?.lng ?? null,
        negotiatedAmount: finalAmount,
        status: transactionStatus
      }
    });
  });
}

/**
 * Release remaining escrow funds to the provider on completion. Idempotent:
 * the guard update only matches while escrow is still held.
 */
async function releaseEscrow(transaction) {
  if (!transaction || transaction.paymentMethod !== 'escrow') return;

  await prisma.$transaction(async (tx) => {
    const guard = await tx.transaction.updateMany({
      where: { id: idOf(transaction), paymentMethod: 'escrow', escrowStatus: 'held' },
      data: { status: 'completed', escrowStatus: 'released', completedAt: new Date() }
    });
    if (guard.count === 0) return; // already released/refunded — nothing to move

    const t = await tx.transaction.findUnique({ where: { id: idOf(transaction) } });
    // Any partial amount already paid stays with the provider; clamp so a
    // corrupted partialReleaseAmount can never double-pay.
    const alreadyReleased = Math.min(Math.max(num(t.partialReleaseAmount), 0), num(t.randAmount));
    const remainingAmount = Math.max(0, num(t.randAmount) - alreadyReleased);
    if (remainingAmount === 0) return;

    await tx.user.update({
      where: { id: t.requesterId },
      data: { escrowRand: { decrement: remainingAmount } }
    });
    await tx.user.update({
      where: { id: t.providerId },
      data: {
        randBalance: { increment: remainingAmount },
        totalEarnedRand: { increment: remainingAmount }
      }
    });
    // Never let a rounding edge push escrow negative.
    await tx.user.updateMany({
      where: { id: t.requesterId, escrowRand: { lt: 0 } },
      data: { escrowRand: 0 }
    });
  });
}

/**
 * Partially release escrow funds (max 50%) to the provider after handshake.
 * Only once per transaction.
 */
async function partialReleaseEscrow(transaction, percentage = 50, releasedBy = null) {
  if (!transaction || transaction.paymentMethod !== 'escrow') {
    throw new Error('Not an escrow transaction');
  }

  const cappedPercentage = Math.min(Math.max(percentage, 1), 50);
  const partialAmount = Math.round((num(transaction.randAmount) * cappedPercentage) / 100);

  return prisma.$transaction(async (tx) => {
    const guard = await tx.transaction.updateMany({
      where: {
        id: idOf(transaction),
        paymentMethod: 'escrow',
        escrowStatus: 'held',
        partialReleaseAmount: 0
      },
      data: {
        partialReleaseAmount: partialAmount,
        partialReleasedAt: new Date(),
        partialReleasedBy: releasedBy
      }
    });
    if (guard.count === 0) {
      const t = await tx.transaction.findUnique({ where: { id: idOf(transaction) }, select: { escrowStatus: true, partialReleaseAmount: true } });
      if (t && num(t.partialReleaseAmount) > 0) throw new Error('Partial release already done for this transaction');
      throw new Error('Escrow is not in held status');
    }

    await tx.user.update({
      where: { id: transaction.requesterId },
      data: { escrowRand: { decrement: partialAmount } }
    });
    await tx.user.update({
      where: { id: transaction.providerId },
      data: {
        randBalance: { increment: partialAmount },
        totalEarnedRand: { increment: partialAmount }
      }
    });
    await tx.user.updateMany({
      where: { id: transaction.requesterId, escrowRand: { lt: 0 } },
      data: { escrowRand: 0 }
    });

    return tx.transaction.findUnique({ where: { id: idOf(transaction) } });
  });
}

/**
 * Refund held escrow back to the poster (job cancelled/stopped). Idempotent.
 * Any partial amount already released to the provider stays with them.
 */
async function refundEscrow(transaction) {
  if (!transaction || transaction.paymentMethod !== 'escrow') return;

  await prisma.$transaction(async (tx) => {
    const guard = await tx.transaction.updateMany({
      where: { id: idOf(transaction), paymentMethod: 'escrow', escrowStatus: 'held' },
      data: { status: 'cancelled', escrowStatus: 'refunded' }
    });
    if (guard.count === 0) return;

    const t = await tx.transaction.findUnique({ where: { id: idOf(transaction) } });
    const alreadyReleased = Math.min(Math.max(num(t.partialReleaseAmount), 0), num(t.randAmount));
    const remainingAmount = Math.max(0, num(t.randAmount) - alreadyReleased);
    if (remainingAmount === 0) return;

    await tx.user.update({
      where: { id: t.requesterId },
      data: {
        escrowRand: { decrement: remainingAmount },
        randBalance: { increment: remainingAmount }
      }
    });
    await tx.user.updateMany({
      where: { id: t.requesterId, escrowRand: { lt: 0 } },
      data: { escrowRand: 0 }
    });
  });
}

module.exports = { createEscrowTransaction, releaseEscrow, partialReleaseEscrow, refundEscrow };
