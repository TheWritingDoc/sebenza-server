const express = require('express');
const router = express.Router();
const { prisma } = require('../db');
const { toDTO, sanitizeUser, isId } = require('../utils/dto');
const jwt = require('jsonwebtoken');

const { auth } = require('../middleware/authToken');

// Mongo-era clients expect transaction.location = { lat, lng }
const txOut = (t) => {
  if (!t) return t;
  return {
    ...t,
    location: (t.lat != null || t.lng != null) ? { lat: t.lat, lng: t.lng } : undefined
  };
};

// Get messages for a transaction
router.get('/:transactionId', auth, async (req, res) => {
  try {
    const transaction = isId(req.params.transactionId)
      ? await prisma.transaction.findUnique({ where: { id: req.params.transactionId } })
      : null;
    if (!transaction) return res.status(404).json({ error: 'Transaction not found' });

    // Verify user is part of this transaction
    const userId = req.user.userId || req.user.id;
    if (String(transaction.requesterId) !== userId && String(transaction.providerId) !== userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const messages = await prisma.message.findMany({
      where: { transactionId: req.params.transactionId },
      orderBy: { createdAt: 'asc' }
    });

    res.json(toDTO(messages));
  } catch (err) {
    console.error('Get messages error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Send a message
router.post('/:transactionId', auth, async (req, res) => {
  try {
    const { text, type, offerAmount } = req.body;
    const transaction = isId(req.params.transactionId)
      ? await prisma.transaction.findUnique({ where: { id: req.params.transactionId } })
      : null;
    if (!transaction) return res.status(404).json({ error: 'Transaction not found' });

    const userId = req.user.userId || req.user.id;
    if (String(transaction.requesterId) !== userId && String(transaction.providerId) !== userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const receiverId = String(transaction.requesterId) === userId
      ? transaction.providerId
      : transaction.requesterId;

    const message = await prisma.message.create({
      data: {
        transactionId: req.params.transactionId,
        senderId: userId,
        receiverId,
        text,
        type: type || 'text',
        offerAmount: offerAmount !== undefined && offerAmount !== null && offerAmount !== ''
          ? parseFloat(offerAmount)
          : null
      }
    });

    res.json({ message: 'Message sent', data: toDTO(message) });
  } catch (err) {
    console.error('Send message error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Mark messages as read
router.put('/:transactionId/read', auth, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    if (isId(req.params.transactionId) && isId(userId)) {
      await prisma.message.updateMany({
        where: { transactionId: req.params.transactionId, receiverId: userId, read: false },
        data: { read: true }
      });
    }
    res.json({ message: 'Messages marked as read' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Negotiate price
router.post('/:transactionId/negotiate', auth, async (req, res) => {
  try {
    const { amount } = req.body;
    const transaction = isId(req.params.transactionId)
      ? await prisma.transaction.findUnique({ where: { id: req.params.transactionId } })
      : null;
    if (!transaction) return res.status(404).json({ error: 'Transaction not found' });

    const userId = req.user.userId || req.user.id;
    if (String(transaction.requesterId) !== userId && String(transaction.providerId) !== userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const negotiationHistory = Array.isArray(transaction.negotiationHistory) ? transaction.negotiationHistory : [];
    negotiationHistory.push({
      proposedBy: userId,
      amount,
      status: 'pending',
      createdAt: new Date()
    });

    const updatedTransaction = await prisma.transaction.update({
      where: { id: transaction.id },
      data: { negotiationHistory }
    });

    const receiverId = String(transaction.requesterId) === userId
      ? transaction.providerId
      : transaction.requesterId;

    // Also create a message for this offer
    const message = await prisma.message.create({
      data: {
        transactionId: req.params.transactionId,
        senderId: userId,
        receiverId,
        text: `Price offer: R${amount}`,
        type: 'price_offer',
        offerAmount: parseFloat(amount) || null
      }
    });

    res.json({ message: 'Price offer sent', data: { transaction: toDTO(txOut(updatedTransaction)), message: toDTO(message) } });
  } catch (err) {
    console.error('Negotiate error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Accept or reject price offer
router.post('/:transactionId/negotiate/respond', auth, async (req, res) => {
  try {
    const { accepted, amount } = req.body;
    const transaction = isId(req.params.transactionId)
      ? await prisma.transaction.findUnique({ where: { id: req.params.transactionId } })
      : null;
    if (!transaction) return res.status(404).json({ error: 'Transaction not found' });

    const userId = req.user.userId || req.user.id;

    // Update the last pending negotiation
    const negotiationHistory = Array.isArray(transaction.negotiationHistory) ? transaction.negotiationHistory : [];
    const lastOffer = [...negotiationHistory].reverse().find(n => n.status === 'pending');
    if (lastOffer) {
      lastOffer.status = accepted ? 'accepted' : 'rejected';
    }

    const data = { negotiationHistory };
    if (accepted) {
      data.negotiatedAmount = amount;
    }
    const updatedTransaction = await prisma.transaction.update({
      where: { id: transaction.id },
      data
    });

    const receiverId = String(transaction.requesterId) === userId
      ? transaction.providerId
      : transaction.requesterId;

    const message = await prisma.message.create({
      data: {
        transactionId: req.params.transactionId,
        senderId: userId,
        receiverId,
        text: accepted ? `Accepted price: R${amount}` : `Rejected price: R${amount}`,
        type: accepted ? 'price_accept' : 'price_reject',
        offerAmount: parseFloat(amount) || null
      }
    });
    // message intentionally not returned — original responded with the transaction only

    res.json({ message: accepted ? 'Price accepted' : 'Price rejected', data: toDTO(txOut(updatedTransaction)) });
  } catch (err) {
    console.error('Negotiate respond error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
