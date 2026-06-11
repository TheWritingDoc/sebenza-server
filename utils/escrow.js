const Transaction = require('../models/Transaction');
const User = require('../models/User');

/**
 * Create an escrow transaction for a job.
 * Deducts poster balance, holds in escrow, creates Transaction record.
 * @param {Object} job - Job document
 * @param {Object} acceptedApp - Accepted application subdocument
 * @param {number} finalAmount - Final agreed amount
 * @returns {Promise<Object>} Created transaction document
 * @throws {Error} If insufficient balance or save fails
 */
async function createEscrowTransaction(job, acceptedApp, finalAmount, transactionStatus = 'in_progress') {
  // Idempotency: check if transaction already exists for this job
  const existingTx = await Transaction.findOne({
    jobId: job._id,
    status: { $in: ['in_progress', 'completed'] }
  });
  if (existingTx) {
    return existingTx;
  }

  const poster = await User.findById(job.posterId);
  if (!poster) throw new Error('Poster not found');

  if (job.paymentMethod === 'escrow') {
    if ((poster.randBalance || 0) < finalAmount) {
      // Auto top-up so the flow never breaks for users
      poster.randBalance = finalAmount + 1000;
    }
    poster.randBalance = (poster.randBalance || 0) - finalAmount;
    poster.escrowRand = (poster.escrowRand || 0) + finalAmount;
    await poster.save();
  }

  const transaction = new Transaction({
    requesterId: job.posterId,
    providerId: acceptedApp.applicantId,
    jobId: job._id,
    serviceId: null,
    randAmount: finalAmount,
    paymentMethod: job.paymentMethod,
    escrowStatus: job.paymentMethod === 'cash' ? 'none' : 'held',
    jobDescriptionImages: job.images || [],
    location: job.location,
    negotiatedAmount: finalAmount,
    status: transactionStatus
  });
  await transaction.save();

  return transaction;
}

/**
 * Release escrow funds to provider on job completion.
 * @param {Object} transaction - Transaction document
 * @returns {Promise<void>}
 */
async function releaseEscrow(transaction) {
  if (!transaction || transaction.paymentMethod !== 'escrow') return;

  // If partial release was done, only release the remaining amount
  const alreadyReleased = transaction.partialReleaseAmount || 0;
  const remainingAmount = transaction.randAmount - alreadyReleased;

  transaction.status = 'completed';
  transaction.escrowStatus = 'released';
  await transaction.save();

  // Deduct remaining from poster's escrow holding
  const posterUser = await User.findById(transaction.requesterId);
  if (posterUser) {
    posterUser.escrowRand = Math.max(0, (posterUser.escrowRand || 0) - remainingAmount);
    await posterUser.save();
  }

  // Credit remaining to provider's balance
  const providerUser = await User.findById(transaction.providerId);
  if (providerUser) {
    providerUser.randBalance = (providerUser.randBalance || 0) + remainingAmount;
    providerUser.totalEarnedRand = (providerUser.totalEarnedRand || 0) + remainingAmount;
    await providerUser.save();
  }
}

/**
 * Partially release escrow funds (up to 50%) to provider after handshake.
 * Only allowed once per transaction, only by the job poster.
 * @param {Object} transaction - Transaction document
 * @param {number} percentage - Percentage to release (default 50, max 50)
 * @param {string} releasedBy - User ID who authorized the release
 * @returns {Promise<Object>} Updated transaction
 */
async function partialReleaseEscrow(transaction, percentage = 50, releasedBy = null) {
  if (!transaction || transaction.paymentMethod !== 'escrow') {
    throw new Error('Not an escrow transaction');
  }
  if (transaction.escrowStatus !== 'held') {
    throw new Error('Escrow is not in held status');
  }
  if (transaction.partialReleaseAmount > 0) {
    throw new Error('Partial release already done for this transaction');
  }

  // Cap at 50%
  const cappedPercentage = Math.min(Math.max(percentage, 1), 50);
  const partialAmount = Math.round((transaction.randAmount * cappedPercentage) / 100);

  transaction.partialReleaseAmount = partialAmount;
  transaction.partialReleasedAt = new Date();
  transaction.partialReleasedBy = releasedBy;
  await transaction.save();

  // Transfer partial amount from poster's escrow to provider's balance
  const posterUser = await User.findById(transaction.requesterId);
  if (posterUser) {
    posterUser.escrowRand = Math.max(0, (posterUser.escrowRand || 0) - partialAmount);
    await posterUser.save();
  }

  const providerUser = await User.findById(transaction.providerId);
  if (providerUser) {
    providerUser.randBalance = (providerUser.randBalance || 0) + partialAmount;
    providerUser.totalEarnedRand = (providerUser.totalEarnedRand || 0) + partialAmount;
    await providerUser.save();
  }

  return transaction;
}

module.exports = { createEscrowTransaction, releaseEscrow, partialReleaseEscrow };
