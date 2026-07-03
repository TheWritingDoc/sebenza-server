import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import { categoryEmojis, getImageUrl, PLACEHOLDER_IMG, modalOverlayStyle, modalContentStyle } from '../shared/constants';

const API_URL = process.env.REACT_APP_API_URL || '';

function ApplyJobModal({ job, onClose, onApplied }) {
  const [proposedAmount, setProposedAmount] = useState(job.budget?.toString() || '');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [timeAdjustment, setTimeAdjustment] = useState('');
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const sheetRef = useRef(null);

  const token = localStorage.getItem('token');

  const isValidToken = (t) => t && t !== 'null' && t !== 'undefined' && t.split('.').length === 3;

  useEffect(() => {
    if (error) sheetRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [error]);

  const handleSubmit = async () => {
    const errs = {};
    const amount = parseFloat(proposedAmount);
    if (isNaN(amount) || amount <= 0) errs.proposedAmount = true;
    if (!message.trim()) errs.message = true;

    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      setError('Please fill in all required fields');
      return;
    }
    setFieldErrors({});

    if (!isValidToken(token)) {
      setError('Your session has expired. Please log in again.');
      setTimeout(() => {
        localStorage.removeItem('token');
        localStorage.removeItem('sebenza_user');
        localStorage.removeItem('gshop_user');
        window.location.href = '/login';
      }, 2000);
      return;
    }

    setLoading(true);
    setError('');
    try {
      await axios.post(`${API_URL}/api/jobs/${job._id}/apply`,
        { proposedAmount: amount, timeAdjustment: timeAdjustment ? new Date(timeAdjustment).toISOString() : undefined, message },
        { headers: { Authorization: `Bearer ${token}` }, withCredentials: true }
      );
      onApplied();
    } catch (err) {
      const errMsg = err.response?.data?.error || 'Failed to apply';
      const errCode = err.response?.data?.code;
      if (errCode === 'TOKEN_EXPIRED' || errMsg === 'Token expired' || errCode === 'TOKEN_INVALID' || errMsg === 'Invalid token') {
        setError('Your session has expired. Please log in again.');
        setTimeout(() => {
          localStorage.removeItem('token');
          localStorage.removeItem('sebenza_user');
          localStorage.removeItem('gshop_user');
          window.location.href = '/login';
        }, 2000);
      } else {
        setError(errMsg);
      }
    }
    setLoading(false);
  };

  const emoji = categoryEmojis[job.category] || '✨';

  const inputBase = {
    width: '100%',
    padding: '14px 16px',
    borderRadius: 14,
    border: '1px solid #e2e8f0',
    fontSize: 14,
    outline: 'none',
    boxSizing: 'border-box',
    transition: 'border-color 0.2s, box-shadow 0.2s, background 0.2s',
    minHeight: 48,
  };

  const labelBase = {
    display: 'block',
    fontSize: 13,
    fontWeight: 700,
    color: '#1e293b',
    marginBottom: 6,
  };

  return (
    <div style={modalOverlayStyle} onClick={onClose}>
      <div style={{ ...modalContentStyle(440), maxHeight: '85vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()} ref={sheetRef}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <div style={{ width: 48, height: 48, borderRadius: 16, background: 'linear-gradient(135deg, #10b981, #059669)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>📝</div>
          <div>
            <h3 style={{ margin: 0, fontSize: 'clamp(18px, 4vw, 20px)', fontWeight: 800, color: '#1e293b' }}>Offer to Help</h3>
            <p style={{ margin: '2px 0 0', fontSize: 13, color: '#64748b' }}>{job.title}</p>
          </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              border: '1px solid #e2e8f0',
              background: 'white',
              color: '#64748b',
              fontSize: 20,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>

        {/* Job summary — compact like PostJobModal step 2 */}
        <div style={{ background: '#f8fafc', borderRadius: 16, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10, border: '1px solid #e2e8f0', marginBottom: 20 }}>
          <span style={{ fontSize: 20 }}>{emoji}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{job.title}</div>
            <div style={{ fontSize: 12, color: '#22c55e', fontWeight: 700 }}>R{job.budget}</div>
          </div>
        </div>

        {job.images?.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 8 }}>📷 Job Photos</label>
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
              {job.images.map((img, i) => (
                <img key={i} src={getImageUrl(img)} alt="" onClick={() => setLightboxIndex(i)}
                  onError={(e) => { e.target.onerror = null; e.target.src = PLACEHOLDER_IMG; }}
                  style={{ width: 72, height: 72, borderRadius: 14, objectFit: 'cover', cursor: 'pointer', flexShrink: 0, border: '2px solid transparent', transition: 'border-color 0.2s' }}
                  onMouseEnter={e => e.target.style.borderColor = '#6366f1'}
                  onMouseLeave={e => e.target.style.borderColor = 'transparent'}
                />
              ))}
            </div>
          </div>
        )}

        {/* Poster + payment method row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: '#f8fafc', borderRadius: 16, flex: 1 }}>
            <div style={{
              width: 36, height: 36, borderRadius: '50%',
              background: job.posterId?.avatar ? `url(${getImageUrl(job.posterId.avatar)}) center/cover` : 'linear-gradient(135deg, #6366f1, #4f46e5)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: 'white', fontWeight: 600, flexShrink: 0
            }}>{!job.posterId?.avatar && job.posterId?.name?.charAt(0).toUpperCase()}</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>{job.posterId?.name || 'Unknown'}</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>{job.posterId?.rating > 0 ? `⭐ ${job.posterId.rating.toFixed(1)}` : 'New neighbour'}</div>
            </div>
          </div>
          <div style={{ padding: '10px 14px', borderRadius: 12, background: job.paymentMethod === 'escrow' ? '#eef2ff' : '#f0fdf4', border: `1px solid ${job.paymentMethod === 'escrow' ? '#c7d2fe' : '#bbf7d0'}`, flexShrink: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: job.paymentMethod === 'escrow' ? '#4338ca' : '#166534' }}>
              {job.paymentMethod === 'escrow' ? '🔒 Escrow' : '💵 Cash'}
            </span>
          </div>
        </div>

        {error && (
          <div style={{ background: '#fef2f2', color: '#991b1b', padding: 12, borderRadius: 14, fontSize: 13, fontWeight: 600, marginBottom: 16 }}>{error}</div>
        )}

        {/* Proposed Pay with quick chips */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ ...labelBase, color: fieldErrors.proposedAmount ? '#dc2626' : '#1e293b' }}>
            Your Proposed Pay (R) * {fieldErrors.proposedAmount && <span style={{ color: '#dc2626', fontSize: 12 }}>— required</span>}
          </label>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>Quick pick:</span>
            {(() => {
              const b = job.budget || 0;
              const chips = [
                { label: `Same R${b}`, val: b },
                { label: `R${Math.round(b * 0.9)}`, val: Math.round(b * 0.9) },
                { label: `R${Math.round(b * 1.1)}`, val: Math.round(b * 1.1) },
              ];
              return chips.map((c, i) => (
                <button key={i} type="button" onClick={() => { setProposedAmount(c.val.toString()); setError(''); setFieldErrors(prev => ({ ...prev, proposedAmount: false })); }}
                  style={{
                    padding: '7px 14px', borderRadius: 12, border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                    background: parseFloat(proposedAmount) === c.val ? '#6366f1' : '#eef2ff', color: parseFloat(proposedAmount) === c.val ? 'white' : '#4f46e5',
                    transition: 'all 0.15s',
                  }}>{c.label}</button>
              ));
            })()}
          </div>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', fontSize: 16, fontWeight: 700, color: '#6366f1' }}>R</span>
            <input
              type="number"
              value={proposedAmount}
              onChange={e => { setProposedAmount(e.target.value); setError(''); setFieldErrors(prev => ({ ...prev, proposedAmount: false })); }}
              placeholder={job.budget?.toString() || '250'}
              style={{ ...inputBase, paddingLeft: 36, borderColor: fieldErrors.proposedAmount ? '#ef4444' : '#e2e8f0', background: fieldErrors.proposedAmount ? '#fef2f2' : '#fafbfc' }}
              onFocus={e => { e.target.style.borderColor = fieldErrors.proposedAmount ? '#ef4444' : '#6366f1'; e.target.style.boxShadow = fieldErrors.proposedAmount ? '0 0 0 3px rgba(239,68,68,0.12)' : '0 0 0 3px rgba(99,102,241,0.12)'; e.target.style.background = 'white'; }}
              onBlur={e => { e.target.style.borderColor = fieldErrors.proposedAmount ? '#ef4444' : '#e2e8f0'; e.target.style.boxShadow = 'none'; e.target.style.background = fieldErrors.proposedAmount ? '#fef2f2' : '#fafbfc'; }}
            />
          </div>
        </div>

        {/* Work time info */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelBase}>Work Time</label>
          <div style={{ padding: '12px 16px', background: '#f8fafc', borderRadius: 14, border: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#1e293b' }}>
              {job.proposedTime ? new Date(job.proposedTime).toLocaleString() : 'Not specified'}
            </div>
            <div style={{ fontSize: 12, color: job.timeIsNegotiable ? '#6366f1' : '#94a3b8', fontWeight: job.timeIsNegotiable ? 600 : 400, marginTop: 4 }}>
              {job.timeIsNegotiable ? '⏰ You can suggest a different time below' : '⏰ This time is non-negotiable'}
            </div>
          </div>
        </div>

        {/* Time adjustment */}
        {job.timeIsNegotiable && (
          <div style={{ marginBottom: 16 }}>
            <label style={labelBase}>
              Suggest a different time <span style={{ fontWeight: 500, color: '#94a3b8' }}>(optional)</span>
            </label>
            <input
              type="datetime-local"
              value={timeAdjustment}
              onChange={e => { setTimeAdjustment(e.target.value); setError(''); }}
              style={inputBase}
              onFocus={e => { e.target.style.borderColor = '#6366f1'; e.target.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.12)'; e.target.style.background = 'white'; }}
              onBlur={e => { e.target.style.borderColor = '#e2e8f0'; e.target.style.boxShadow = 'none'; e.target.style.background = '#fafbfc'; }}
            />
          </div>
        )}

        {/* Cover Message */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ ...labelBase, color: fieldErrors.message ? '#dc2626' : '#1e293b' }}>
            Cover Message * {fieldErrors.message && <span style={{ color: '#dc2626', fontSize: 12 }}>— required</span>}
          </label>
          <textarea
            value={message}
            onChange={e => { setMessage(e.target.value); setError(''); setFieldErrors(prev => ({ ...prev, message: false })); }}
            placeholder="Introduce yourself and explain why you'd love to help..."
            rows={4}
            style={{ ...inputBase, resize: 'vertical', minHeight: 80, borderColor: fieldErrors.message ? '#ef4444' : '#e2e8f0', background: fieldErrors.message ? '#fef2f2' : '#fafbfc' }}
            onFocus={e => { e.target.style.borderColor = fieldErrors.message ? '#ef4444' : '#6366f1'; e.target.style.boxShadow = fieldErrors.message ? '0 0 0 3px rgba(239,68,68,0.12)' : '0 0 0 3px rgba(99,102,241,0.12)'; e.target.style.background = 'white'; }}
            onBlur={e => { e.target.style.borderColor = fieldErrors.message ? '#ef4444' : '#e2e8f0'; e.target.style.boxShadow = 'none'; e.target.style.background = fieldErrors.message ? '#fef2f2' : '#fafbfc'; }}
          />
        </div>

        {/* Sticky Bottom Actions */}
        <div style={{ position: 'sticky', bottom: 0, background: 'white', padding: '12px 0', borderTop: '1px solid #e2e8f0', marginTop: 12, display: 'flex', gap: 10, zIndex: 5 }}>
          <button
            onClick={onClose}
            style={{
              padding: '10px 18px', borderRadius: 12, border: 'none', fontSize: 14, fontWeight: 700,
              cursor: 'pointer', background: '#f1f5f9', color: '#475569', minHeight: 48
            }}
          >
            Close
          </button>
          <button onClick={handleSubmit} disabled={loading} style={{
            flex: 1, padding: 'clamp(12px, 3vw, 14px)', borderRadius: 16, border: 'none', fontSize: 14, fontWeight: 800, cursor: 'pointer',
            background: 'linear-gradient(135deg, #6366f1, #4f46e5)', color: 'white',
            boxShadow: '0 4px 16px rgba(99,102,241,0.3)', opacity: loading ? 0.6 : 1, minHeight: 48
          }}>{loading ? '⏳ Sending...' : 'Send Offer to Help'}</button>
        </div>

        {lightboxIndex !== null && job.images?.length > 0 && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10001, padding: 20 }} onClick={() => setLightboxIndex(null)}>
            <img src={getImageUrl(job.images[lightboxIndex])} alt=""
              onClick={e => e.stopPropagation()}
              onError={(e) => { e.target.onerror = null; e.target.src = PLACEHOLDER_IMG; }}
              style={{ maxWidth: '100%', maxHeight: '85vh', borderRadius: 20, objectFit: 'contain' }} />
            <button onClick={(e) => { e.stopPropagation(); setLightboxIndex(null); }} style={{
              position: 'absolute', top: 20, right: 20, width: 44, height: 44, borderRadius: '50%',
              background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.2)',
              color: 'white', fontSize: 20, cursor: 'pointer'
            }}>✕</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default ApplyJobModal;
