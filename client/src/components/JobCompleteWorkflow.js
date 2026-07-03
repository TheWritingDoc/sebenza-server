import React from 'react';

function JobCompleteWorkflow({ job, onClose, onComplete }) {
  const handleComplete = () => {
    if (onComplete) onComplete();
    if (onClose) onClose();
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000, padding: 20 }}>
      <div style={{ background: 'white', borderRadius: 20, padding: 24, maxWidth: 400, width: '100%' }}>
        <h3 style={{ fontSize: 18, fontWeight: 800, marginBottom: 12, color: '#1e293b' }}>Complete Job</h3>
        <p style={{ fontSize: 14, color: '#64748b', marginBottom: 20 }}>
          Are you sure you want to mark this job as complete?
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button 
            onClick={handleComplete}
            style={{ flex: 1, padding: 12, borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, #22c55e, #16a34a)', color: 'white', fontWeight: 700, cursor: 'pointer' }}
          >
            Yes, Complete
          </button>
          <button 
            onClick={onClose}
            style={{ padding: '12px 20px', borderRadius: 12, border: 'none', background: '#f1f5f9', color: '#475569', fontWeight: 700, cursor: 'pointer' }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export default JobCompleteWorkflow;
