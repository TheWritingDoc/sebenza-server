import React, { useState } from 'react';
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || '';

const REASONS = [
  { value: 'scam', label: '🚨 Scam or fraud', hint: 'Asked for money outside the app, fake job, phishing' },
  { value: 'harassment', label: '😠 Harassment or abuse', hint: 'Threats, insults, inappropriate messages' },
  { value: 'no_show', label: '👻 No-show', hint: 'Agreed to a job and never arrived / disappeared' },
  { value: 'poor_work', label: '🔧 Dishonest about work', hint: 'Claimed work was done when it was not' },
  { value: 'spam', label: '📢 Spam', hint: 'Fake listings, repeated unwanted contact' },
  { value: 'other', label: '❓ Something else', hint: 'Tell us below' },
];

/**
 * Report-a-user modal. Reports go to the admin review queue — flags that
 * affect community stars are only ever set by an admin decision.
 */
export default function ReportUserModal({ userId, userName, jobId, onClose }) {
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!reason) { setError('Please pick a reason'); return; }
    setBusy(true); setError('');
    try {
      await axios.post(`${API_URL}/api/users/${userId}/report`, { reason, details, jobId });
      setDone(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not submit the report. Please try again.');
    }
    setBusy(false);
  };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 10000,
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: 'white', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 520,
        maxHeight: '85vh', overflowY: 'auto', padding: '20px 20px 28px',
      }}>
        {done ? (
          <div style={{ textAlign: 'center', padding: '24px 8px' }}>
            <div style={{ fontSize: 40 }}>✅</div>
            <h3 style={{ margin: '10px 0 6px', fontSize: 18 }}>Report submitted</h3>
            <p style={{ color: '#64748b', fontSize: 14, margin: 0 }}>
              Thank you for helping keep Sebenza safe. Our team will review this report.
              {userName ? ` ${userName.split(' ')[0]} will not be told who reported them.` : ''}
            </p>
            <button onClick={onClose} style={{
              marginTop: 18, minHeight: 44, padding: '10px 28px', borderRadius: 999, border: 'none',
              background: '#0ea5e9', color: 'white', fontWeight: 700, fontSize: 14, cursor: 'pointer',
            }}>Done</button>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <h3 style={{ margin: 0, fontSize: 18 }}>Report {userName || 'this user'}</h3>
              <button onClick={onClose} aria-label="Close" style={{
                minWidth: 44, minHeight: 44, border: 'none', background: 'transparent',
                fontSize: 20, cursor: 'pointer', color: '#64748b',
              }}>✕</button>
            </div>
            <p style={{ color: '#64748b', fontSize: 13, margin: '0 0 14px' }}>
              Reports are private and reviewed by our team. False reports count against your own community rating.
            </p>
            <div style={{ display: 'grid', gap: 8 }}>
              {REASONS.map((r) => (
                <button key={r.value} onClick={() => { setReason(r.value); setError(''); }} style={{
                  textAlign: 'left', padding: '12px 14px', borderRadius: 14, cursor: 'pointer', minHeight: 44,
                  border: reason === r.value ? '2px solid #0ea5e9' : '2px solid #e2e8f0',
                  background: reason === r.value ? '#f0f9ff' : 'white',
                }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: '#1e293b' }}>{r.label}</div>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{r.hint}</div>
                </button>
              ))}
            </div>
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value.slice(0, 1000))}
              placeholder="What happened? (optional, but details help our review)"
              rows={3}
              style={{
                width: '100%', marginTop: 12, padding: '10px 12px', borderRadius: 12,
                border: '2px solid #e2e8f0', fontSize: 14, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box',
              }}
            />
            {error && <div style={{ color: '#dc2626', fontSize: 13, marginTop: 8, fontWeight: 600 }}>{error}</div>}
            <button onClick={submit} disabled={busy} style={{
              width: '100%', marginTop: 14, minHeight: 48, borderRadius: 14, border: 'none',
              background: busy ? '#94a3b8' : 'linear-gradient(135deg,#ef4444,#dc2626)', color: 'white',
              fontWeight: 800, fontSize: 15, cursor: busy ? 'default' : 'pointer',
            }}>{busy ? 'Submitting…' : 'Submit report'}</button>
          </>
        )}
      </div>
    </div>
  );
}
