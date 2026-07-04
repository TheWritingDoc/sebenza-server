import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { IdCard, Camera, CheckCircle2, Clock, ShieldCheck } from './Icons';

const API_URL = process.env.REACT_APP_API_URL || '';

/**
 * Real KYC identity verification: photo of the ID card FRONT, the BACK, and a
 * selfie. Files upload to the private secure-docs storage bucket via
 * POST /api/verification/upload; an admin reviews and approves (+ biggest
 * trust-star boost). Camera-first capture on mobile.
 */

const SLOTS = [
  { key: 'idFront', label: 'ID card — FRONT', hint: 'Photo of the front of your SA ID or card', capture: 'environment', icon: IdCard },
  { key: 'idBack', label: 'ID card — BACK', hint: 'Photo of the back of the same document', capture: 'environment', icon: IdCard },
  { key: 'selfie', label: 'Selfie', hint: 'A clear photo of your face — we match it to your ID', capture: 'user', icon: Camera },
];

function Verification({ embedded, onStatusChange }) {
  const [status, setStatus] = useState(null); // null | not_submitted | pending | verified
  const [files, setFiles] = useState({});    // key -> File
  const [previews, setPreviews] = useState({});
  const [idNumber, setIdNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const token = localStorage.getItem('token');

  const fetchStatus = useCallback(async () => {
    try {
      const res = await axios.get(`${API_URL}/api/verification/status`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setStatus(res.data.status);
    } catch (e) {
      setStatus('not_submitted');
    }
  }, [token]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const pick = (key) => (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFiles(prev => ({ ...prev, [key]: f }));
    setPreviews(prev => ({ ...prev, [key]: URL.createObjectURL(f) }));
  };

  const submit = async () => {
    if (!files.idFront || !files.idBack || !files.selfie) {
      setMessage('Please add all three photos: ID front, ID back, and a selfie.');
      return;
    }
    setLoading(true); setMessage('');
    try {
      const data = new FormData();
      data.append('idFront', files.idFront);
      data.append('idBack', files.idBack);
      data.append('selfie', files.selfie);
      if (idNumber.trim()) data.append('idNumber', idNumber.trim());
      await axios.post(`${API_URL}/api/verification/upload`, data, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'multipart/form-data' }
      });
      setMessage('✅ Documents submitted — under review.');
      setStatus('pending');
      if (onStatusChange) setTimeout(onStatusChange, 1400);
    } catch (err) {
      setMessage(err.response?.data?.error || 'Upload failed — please try again');
    }
    setLoading(false);
  };

  if (status === null) {
    return <div style={{ textAlign: 'center', padding: 24, color: '#64748b', fontSize: 14 }}>Checking your verification status…</div>;
  }

  if (status === 'verified') {
    return (
      <div style={{ textAlign: 'center', padding: 24 }}>
        <ShieldCheck size={48} color="#16a34a" />
        <h3 style={{ fontSize: 18, fontWeight: 800, color: '#1e293b', margin: '12px 0 4px' }}>Identity Verified</h3>
        <p style={{ fontSize: 14, color: '#64748b' }}>Your ID has been checked and approved — you carry the biggest trust boost.</p>
      </div>
    );
  }

  if (status === 'pending') {
    return (
      <div style={{ textAlign: 'center', padding: 24 }}>
        <Clock size={48} color="#f59e0b" />
        <h3 style={{ fontSize: 18, fontWeight: 800, color: '#1e293b', margin: '12px 0 4px' }}>Under Review</h3>
        <p style={{ fontSize: 14, color: '#64748b' }}>
          Your ID photos are being checked. Your stars jump as soon as it's approved — usually within 24 hours.
        </p>
      </div>
    );
  }

  // not_submitted → the real uploader
  return (
    <div style={{ padding: embedded ? 0 : 20 }}>
      {message && (
        <div style={{
          padding: 12, borderRadius: 12, textAlign: 'center', fontSize: 13, fontWeight: 600, marginBottom: 14,
          background: message.startsWith('✅') ? '#f0fdf4' : '#fef2f2',
          color: message.startsWith('✅') ? '#166534' : '#991b1b'
        }}>{message}</div>
      )}

      <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 14px' }}>
        Take three photos. They're stored in a private vault, used only to verify who you are, and never shown publicly.
      </p>

      {SLOTS.map(slot => {
        const Icon = slot.icon;
        return (
          <div key={slot.key} style={{ marginBottom: 12 }}>
            <input type="file" accept="image/*" capture={slot.capture} onChange={pick(slot.key)}
              id={`kyc-${slot.key}`} style={{ display: 'none' }} />
            <label htmlFor={`kyc-${slot.key}`} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, cursor: 'pointer',
              border: previews[slot.key] ? '2px solid #22c55e' : '2px dashed #cbd5e1',
              background: previews[slot.key] ? '#f0fdf4' : 'white'
            }}>
              {previews[slot.key] ? (
                <img src={previews[slot.key]} alt={slot.label}
                  style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 10, flexShrink: 0 }} />
              ) : (
                <span style={{
                  width: 56, height: 56, borderRadius: 10, background: '#f1f5f9', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}><Icon size={26} color="#64748b" /></span>
              )}
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: '#1e293b' }}>
                  {slot.label} {previews[slot.key] && <CheckCircle2 size={14} color="#16a34a" style={{ verticalAlign: 'text-bottom' }} />}
                </span>
                <span style={{ display: 'block', fontSize: 12, color: '#94a3b8' }}>
                  {previews[slot.key] ? 'Tap to retake' : slot.hint}
                </span>
              </span>
            </label>
          </div>
        );
      })}

      <input value={idNumber} onChange={e => setIdNumber(e.target.value)} inputMode="numeric" maxLength={20}
        placeholder="ID number (optional)"
        style={{ width: '100%', padding: '12px 14px', borderRadius: 12, border: '2px solid #e2e8f0', fontSize: 15, boxSizing: 'border-box', marginBottom: 14 }} />

      <button onClick={submit} disabled={loading || !files.idFront || !files.idBack || !files.selfie}
        style={{
          width: '100%', minHeight: 48, borderRadius: 14, border: 'none', cursor: 'pointer',
          background: loading || !files.idFront || !files.idBack || !files.selfie ? '#cbd5e1' : 'linear-gradient(135deg, #6366f1, #4f46e5)',
          color: 'white', fontSize: 15, fontWeight: 700
        }}>
        {loading ? 'Uploading…' : 'Submit for Verification'}
      </button>
    </div>
  );
}

export default Verification;
