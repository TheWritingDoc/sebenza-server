import React, { useState } from 'react';

function Verification({ embedded, onStatusChange }) {
  const [loading, setLoading] = useState(false);
  const [verified, setVerified] = useState(false);

  const handleVerify = async () => {
    setLoading(true);
    // Simulate verification
    setTimeout(() => {
      setVerified(true);
      setLoading(false);
      if (onStatusChange) onStatusChange();
    }, 1500);
  };

  if (verified) {
    return (
      <div style={{ textAlign: 'center', padding: 24 }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
        <h3 style={{ fontSize: 18, fontWeight: 800, color: '#1e293b' }}>Verified!</h3>
        <p style={{ fontSize: 14, color: '#64748b' }}>Your identity has been verified.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: 20 }}>
      <h3 style={{ fontSize: 18, fontWeight: 800, marginBottom: 16, color: '#1e293b' }}>
        Identity Verification
      </h3>
      <p style={{ fontSize: 14, color: '#64748b', marginBottom: 20 }}>
        Verify your identity to build trust with the community.
      </p>
      
      <button
        onClick={handleVerify}
        disabled={loading}
        style={{
          width: '100%', padding: 14, borderRadius: 14, border: 'none',
          background: 'linear-gradient(135deg, #6366f1, #4f46e5)', color: 'white',
          fontSize: 14, fontWeight: 700, cursor: 'pointer'
        }}
      >
        {loading ? 'Verifying...' : 'Verify Identity'}
      </button>
    </div>
  );
}

export default Verification;
