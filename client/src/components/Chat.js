import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';

const API_URL = process.env.REACT_APP_API_URL || '';

function Chat({ transactionId, otherUser, onClose }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [offerAmount, setOfferAmount] = useState('');
  const [showOffer, setShowOffer] = useState(false);
  const [socket, setSocket] = useState(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef(null);
  const token = localStorage.getItem('token');
  const currentUser = JSON.parse(localStorage.getItem('sebenza_user') || localStorage.getItem('gshop_user') || '{}');
  const currentUserId = String(currentUser.id || currentUser._id || '');

  useEffect(() => {
    fetchMessages();

    const newSocket = io(API_URL || window.location.origin, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      auth: { token: localStorage.getItem('token') || sessionStorage.getItem('token') || '' }
    });

    newSocket.on('connect', () => {
      setSocketConnected(true);
      // Register user as online for notifications
      if (currentUserId) {
        newSocket.emit('user_online', currentUserId);
      }
    });

    newSocket.on('disconnect', () => {
      setSocketConnected(false);
    });

    newSocket.on('connect_error', (err) => {
      console.error('Socket connect error:', err.message);
      setSocketConnected(false);
    });

    newSocket.emit('join_chat', transactionId);

    newSocket.on('new_message', (msg) => {
      setMessages(prev => {
        // Prevent duplicates by checking _id
        if (msg._id && prev.some(m => String(m._id) === String(msg._id))) return prev;
        return [...prev, msg];
      });
    });

    setSocket(newSocket);

    return () => {
      newSocket.off('new_message');
      newSocket.off('connect');
      newSocket.off('disconnect');
      newSocket.off('connect_error');
      newSocket.close();
    };
  }, [transactionId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fetchMessages = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/messages/${transactionId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      // Normalize senderId to string for consistent comparison
      const normalized = res.data.map(m => ({
        ...m,
        senderId: m.senderId?._id ? String(m.senderId._id) : String(m.senderId)
      }));
      setMessages(normalized);
    } catch (err) {
      console.error('Fetch messages error:', err);
    }
  };

  const sendMessage = async (type = 'text', amount = null) => {
    const msgText = type === 'price_offer' ? `Price offer: R${amount}` : text;
    if (!msgText.trim()) return;
    if (sending) return;

    setSending(true);
    const otherUserId = String(otherUser?.id || otherUser?._id || '');

    const payload = {
      transactionId,
      senderId: currentUserId,
      receiverId: otherUserId,
      text: msgText,
      type,
      offerAmount: amount
    };

    // Optimistically add to UI
    const optimisticMsg = {
      _id: `temp-${Date.now()}`,
      transactionId,
      senderId: currentUserId,
      receiverId: otherUserId,
      text: msgText,
      type: type || 'text',
      offerAmount: amount,
      createdAt: new Date().toISOString()
    };
    setMessages(prev => [...prev, optimisticMsg]);

    try {
      if (socket && socketConnected) {
        // Real-time path: socket handles persistence + broadcast
        socket.emit('send_message', payload);
      } else {
        // Fallback: REST API only
        const res = await axios.post(`${API_URL}/api/messages/${transactionId}`, {
          text: msgText,
          type,
          offerAmount: amount
        }, { headers: { Authorization: `Bearer ${token}` } });
        // Replace optimistic message with server-confirmed one
        setMessages(prev => prev.map(m =>
          m._id === optimisticMsg._id ? { ...res.data.data, senderId: String(res.data.data.senderId) } : m
        ));
      }
    } catch (err) {
      console.error('Send message error:', err);
      // Mark optimistic message as failed
      setMessages(prev => prev.map(m =>
        m._id === optimisticMsg._id ? { ...m, _failed: true } : m
      ));
    }

    setText('');
    setOfferAmount('');
    setShowOffer(false);
    setSending(false);
  };

  const respondToOffer = async (accepted, amount) => {
    try {
      await axios.post(`${API_URL}/api/messages/${transactionId}/negotiate/respond`, {
        accepted,
        amount
      }, { headers: { Authorization: `Bearer ${token}` } });
      fetchMessages();
    } catch (err) {
      console.error('Respond error:', err);
    }
  };

  const otherUserName = otherUser?.name || 'User';
  const otherUserInitial = otherUserName.charAt(0).toUpperCase();

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      zIndex: 9999, display: 'flex', alignItems: 'flex-end', justifyContent: 'center'
    }}>
      <div style={{
        background: 'white', width: '100%', maxWidth: '500px', height: '85vh',
        borderRadius: '20px 20px 0 0', display: 'flex', flexDirection: 'column',
        overflow: 'hidden'
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid #e5e7eb',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '40px', height: '40px', borderRadius: '50%',
              background: otherUser?.profileImage
                ? `url(${otherUser.profileImage.startsWith('http') ? otherUser.profileImage : API_URL + otherUser.profileImage}) center/cover`
                : 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'white', fontWeight: 600
            }}>{!otherUser?.profileImage && otherUserInitial}</div>
            <div>
              <div style={{ fontWeight: 600, fontSize: '16px' }}>{otherUserName}</div>
              <div style={{ fontSize: '12px', color: '#9ca3af', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{
                  width: '8px', height: '8px', borderRadius: '50%',
                  background: socketConnected ? '#22c55e' : '#ef4444',
                  display: 'inline-block'
                }} />
                {socketConnected ? 'Connected' : 'Reconnecting...'}
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer', color: '#666'
          }}>✕</button>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {messages.length === 0 && (
            <div style={{ textAlign: 'center', color: '#9ca3af', marginTop: '40px' }}>
              <div style={{ fontSize: '40px', marginBottom: '8px' }}>💬</div>
              <p>Start negotiating prices or chat about the job.</p>
            </div>
          )}
          {messages.map((msg, idx) => {
            const msgSenderId = String(msg.senderId?._id || msg.senderId);
            const isMine = msgSenderId === currentUserId;
            const isOffer = msg.type === 'price_offer';
            const isAccept = msg.type === 'price_accept';
            const isReject = msg.type === 'price_reject';
            const isFailed = msg._failed;

            return (
              <div key={msg._id || idx} style={{
                alignSelf: isMine ? 'flex-end' : 'flex-start',
                maxWidth: '80%',
                background: isFailed ? '#fee2e2' : isOffer ? '#fef3c7' : isAccept ? '#d1fae5' : isReject ? '#fee2e2' : isMine ? '#6366f1' : '#f3f4f6',
                color: isMine && !isOffer && !isAccept && !isReject && !isFailed ? 'white' : '#1f2937',
                padding: '10px 14px', borderRadius: '14px', fontSize: '14px',
                opacity: isFailed ? 0.7 : 1
              }}>
                {isOffer && <div style={{ fontSize: '11px', fontWeight: 600, color: '#92400e', marginBottom: '4px' }}>💰 PRICE OFFER</div>}
                {isFailed && <div style={{ fontSize: '11px', fontWeight: 600, color: '#991b1b', marginBottom: '4px' }}>⚠️ Failed to send</div>}
                {msg.text}
                {isOffer && !isMine && (
                  <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                    <button onClick={() => respondToOffer(true, msg.offerAmount)}
                      style={{ flex: 1, padding: '6px', background: '#10b981', color: 'white', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>
                      Accept
                    </button>
                    <button onClick={() => respondToOffer(false, msg.offerAmount)}
                      style={{ flex: 1, padding: '6px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>
                      Reject
                    </button>
                  </div>
                )}
                <div style={{ fontSize: '10px', opacity: 0.6, marginTop: '4px', textAlign: 'right' }}>
                  {msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid #e5e7eb', background: '#fafafa' }}>
          {showOffer && (
            <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
              <input
                type="number"
                placeholder="Offer amount (Rands)..."
                value={offerAmount}
                onChange={(e) => setOfferAmount(e.target.value)}
                style={{ flex: 1, padding: '10px', borderRadius: '8px', border: '1px solid #d1d5db', fontSize: '14px' }}
              />
              <button onClick={() => sendMessage('price_offer', parseFloat(offerAmount))}
                disabled={sending}
                style={{ padding: '10px 16px', background: '#f59e0b', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', opacity: sending ? 0.6 : 1 }}>
                Send Offer
              </button>
            </div>
          )}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => setShowOffer(!showOffer)}
              style={{ padding: '10px', background: '#f3f4f6', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '16px' }}>
              💰
            </button>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
              placeholder="Type a message..."
              style={{ flex: 1, padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', fontSize: '14px' }}
            />
            <button onClick={() => sendMessage()}
              disabled={sending || !text.trim()}
              style={{ padding: '10px 16px', background: '#6366f1', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', opacity: sending || !text.trim() ? 0.6 : 1 }}>
              {sending ? '...' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Chat;
