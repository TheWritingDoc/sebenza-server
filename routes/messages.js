const express = require('express');
const router = express.Router();
const Message = require('../models/Message');
const Transaction = require('../models/Transaction');
const jwt = require('jsonwebtoken');

const auth = (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.split(' ')[1];
  if (!token || token === 'null' || token === 'undefined') {
    return res.status(401).json({ error: 'No token provided' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token', code: 'TOKEN_INVALID' });
    }
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Get messages for a transaction
router.get('/:transactionId', auth, async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.transactionId);
    if (!transaction) return res.status(404).json({ error: 'Transaction not found' });
    
    // Verify user is part of this transaction
    const userId = req.user.userId || req.user.id;
    if (transaction.requesterId.toString() !== userId && transaction.providerId.toString() !== userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const messages = await Message.find({ transactionId: req.params.transactionId })
      .sort({ createdAt: 1 })
      .lean();

    res.json(messages);
  } catch (err) {
    console.error('Get messages error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Send a message
router.post('/:transactionId', auth, async (req, res) => {
  try {
    const { text, type, offerAmount } = req.body;
    const transaction = await Transaction.findById(req.params.transactionId);
    if (!transaction) return res.status(404).json({ error: 'Transaction not found' });

    const userId = req.user.userId || req.user.id;
    if (transaction.requesterId.toString() !== userId && transaction.providerId.toString() !== userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const receiverId = transaction.requesterId.toString() === userId 
      ? transaction.providerId 
      : transaction.requesterId;

    const message = new Message({
      transactionId: req.params.transactionId,
      senderId: userId,
      receiverId,
      text,
      type: type || 'text',
      offerAmount
    });
    await message.save();

    res.json({ message: 'Message sent', data: message });
  } catch (err) {
    console.error('Send message error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Mark messages as read
router.put('/:transactionId/read', auth, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    await Message.updateMany(
      { transactionId: req.params.transactionId, receiverId: userId, read: false },
      { read: true }
    );
    res.json({ message: 'Messages marked as read' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Negotiate price
router.post('/:transactionId/negotiate', auth, async (req, res) => {
  try {
    const { amount } = req.body;
    const transaction = await Transaction.findById(req.params.transactionId);
    if (!transaction) return res.status(404).json({ error: 'Transaction not found' });

    const userId = req.user.userId || req.user.id;
    if (transaction.requesterId.toString() !== userId && transaction.providerId.toString() !== userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    transaction.negotiationHistory = transaction.negotiationHistory || [];
    transaction.negotiationHistory.push({
      proposedBy: userId,
      amount,
      status: 'pending'
    });
    await transaction.save();

    const receiverId = transaction.requesterId.toString() === userId 
      ? transaction.providerId 
      : transaction.requesterId;

    // Also create a message for this offer
    const message = new Message({
      transactionId: req.params.transactionId,
      senderId: userId,
      receiverId,
      text: `Price offer: R${amount}`,
      type: 'price_offer',
      offerAmount: amount
    });
    await message.save();

    res.json({ message: 'Price offer sent', data: { transaction, message } });
  } catch (err) {
    console.error('Negotiate error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Accept or reject price offer
router.post('/:transactionId/negotiate/respond', auth, async (req, res) => {
  try {
    const { accepted, amount } = req.body;
    const transaction = await Transaction.findById(req.params.transactionId);
    if (!transaction) return res.status(404).json({ error: 'Transaction not found' });

    const userId = req.user.userId || req.user.id;
    
    // Update the last pending negotiation
    const lastOffer = transaction.negotiationHistory?.reverse().find(n => n.status === 'pending');
    if (lastOffer) {
      lastOffer.status = accepted ? 'accepted' : 'rejected';
    }

    if (accepted) {
      transaction.negotiatedAmount = amount;
    }
    await transaction.save();

    const receiverId = transaction.requesterId.toString() === userId 
      ? transaction.providerId 
      : transaction.requesterId;

    const message = new Message({
      transactionId: req.params.transactionId,
      senderId: userId,
      receiverId,
      text: accepted ? `Accepted price: R${amount}` : `Rejected price: R${amount}`,
      type: accepted ? 'price_accept' : 'price_reject',
      offerAmount: amount
    });
    await message.save();

    res.json({ message: accepted ? 'Price accepted' : 'Price rejected', data: transaction });
  } catch (err) {
    console.error('Negotiate respond error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
