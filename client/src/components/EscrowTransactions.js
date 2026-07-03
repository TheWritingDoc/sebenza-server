import React from 'react';
import { useNavigate } from 'react-router-dom';

function EscrowTransactions({ onOpenChat }) {
  const navigate = useNavigate();

  return (
    <div style={{ padding: '20px', maxWidth: 900, margin: '0 auto' }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 16, color: '#1e293b' }}>
        My Work & Transactions
      </h1>
      <p style={{ fontSize: 14, color: '#64748b', marginBottom: 24 }}>
        Track your jobs, payments, and escrow transactions.
      </p>
      
      <div style={{ 
        background: 'white', borderRadius: 20, padding: 40, 
        border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        textAlign: 'center'
      }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>💼</div>
        <h3 style={{ fontSize: 18, fontWeight: 700, color: '#1e293b', marginBottom: 8 }}>
          Work Hub
        </h3>
        <p style={{ fontSize: 14, color: '#64748b', marginBottom: 20, maxWidth: 400, margin: '0 auto 20px' }}>
          View your active jobs, completed work, and transaction history. 
          Go to the Job Board to find new opportunities!
        </p>
        <button 
          onClick={() => navigate('/jobs')}
          style={{
            padding: '14px 28px', borderRadius: 14, border: 'none',
            background: 'linear-gradient(135deg, #6366f1, #4f46e5)', color: 'white',
            fontSize: 14, fontWeight: 700, cursor: 'pointer'
          }}
        >
          Go to Job Board
        </button>
      </div>
    </div>
  );
}

export default EscrowTransactions;
