import React, { useState } from 'react';
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || '';

function SMSVerify({ phone, onVerified }) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const sendCode = async () => {
    setLoading(true);
    setError('');
    try {
      await axios.post(`${API_URL}/api/sms/send-code`, { phone });
      setSent(true);
    } catch (err) {
      setError('Failed to send code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await axios.post(`${API_URL}/api/sms/verify-code`, { phone, code });
      if (onVerified) onVerified();
    } catch (err) {
      setError('Invalid code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 20, maxWidth: 400, margin: '0 auto' }}>
      <h3 style={{ fontSize: 18, fontWeight: 800, marginBottom: 16, color: '#1e293b' }}>
        Verify Phone Number
      </h3>
      <p style={{ fontSize: 14, color: '#64748b', marginBottom: 20 }}>
        {phone}
      </p>

      {!sent ? (
        <button
          onClick={sendCode}
          disabled={loading}
          style={{
            width: '100%', padding: 14, borderRadius: 14, border: 'none',
            background: 'linear-gradient(135deg, #6366f1, #4f46e5)', color: 'white',
            fontSize: 14, fontWeight: 700, cursor: 'pointer'
          }}
        >
          {loading ? 'Sending...' : 'Send Verification Code'}
        </button>
      ) : (
        <form onSubmit={verifyCode} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input
            type="text"
            value={code}
            onChange={e => setCode(e.target.value)}
            placeholder="Enter 6-digit code"
            maxLength={6}
            style={{ width: '100%', padding: 12, borderRadius: 12, border: '2px solid #e2e8f0', fontSize: 16, textAlign: 'center', letterSpacing: 8, outline: 'none' }}
          />
          {error && <p style={{ color: '#ef4444', fontSize: 13, textAlign: 'center' }}>{error}</p>}
          <button
            type="submit"
            disabled={loading || code.length < 6}
            style={{
              width: '100%', padding: 14, borderRadius: 14, border: 'none',
              background: 'linear-gradient(135deg, #6366f1, #4f46e5)', color: 'white',
              fontSize: 14, fontWeight: 700, cursor: 'pointer', opacity: code.length < 6 ? 0.5 : 1
            }}
          >
            {loading ? 'Verifying...' : 'Verify'}
          </button>
          <button
            type="button"
            onClick={sendCode}
            disabled={loading}
            style={{
              width: '100%', padding: 12, borderRadius: 14, border: 'none',
              background: 'transparent', color: '#6366f1', fontSize: 13, fontWeight: 600, cursor: 'pointer'
            }}
          >
            Resend Code
          </button>
        </form>
      )}
    </div>
  );
}

export default SMSVerify;
