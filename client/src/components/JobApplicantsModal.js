import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { getImageUrl, PLACEHOLDER_IMG, modalOverlayStyle, modalContentStyle, MAX_NEGOTIATION_ROUNDS } from '../shared/constants';
import { scrollToRef, blurActiveInput, mobileFieldFocusScroll } from '../shared/workflowFocus';
import { UserCircle, IdCard } from './Icons';
import { TrustStars } from './TrustCenter';

const API_URL = process.env.REACT_APP_API_URL || '';

function JobApplicantsModal({ job, user, onClose, onUpdated, onViewPortfolio }) {
  const [selectedApp, setSelectedApp] = useState(null);
  const [mode, setMode] = useState(null); // 'approve' | 'counter'
  const [approveAmount, setApproveAmount] = useState('');
  const [approveTime, setApproveTime] = useState('');
  const [useTimeAdjustment, setUseTimeAdjustment] = useState(false);
  const [negotiateAmount, setNegotiateAmount] = useState('');
  const [negotiateTime, setNegotiateTime] = useState('');
  const [negotiateMessage, setNegotiateMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [negotiateSuccess, setNegotiateSuccess] = useState('');
  const counterFormRef = useRef(null);
  const approveFormRef = useRef(null);
  const modalScrollRef = useRef(null);
  const applicantCardRefs = useRef({});

  const token = localStorage.getItem('token');
  const userId = token ? (() => { try { return JSON.parse(atob(token.split('.')[1])).userId; } catch { return null; } })() : null;

  const showMsg = (msg, timeout = 3000) => {
    setMessage(msg);
    setTimeout(() => setMessage(''), timeout);
  };

  const activeApps = job.applications?.filter(a => ['pending', 'negotiating', 'approved'].includes(a.status)) || [];
  const otherApps = job.applications?.filter(a => !['pending', 'negotiating'].includes(a.status)) || [];

  const formatDateTimeLocal = (date) => {
    const d = new Date(date);
    const pad = (n) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const openApprove = (app) => {
    setSelectedApp(app._id);
    setMode('approve');
    setNegotiateSuccess('');
    setApproveAmount(app.proposedAmount?.toString() || job.budget?.toString() || '');
    // Pre-fill with the poster's original proposed time
    if (job.proposedTime) {
      setApproveTime(formatDateTimeLocal(job.proposedTime));
    } else {
      setApproveTime('');
    }
    // If helper suggested a time adjustment, default to poster's time (they must actively choose)
    setUseTimeAdjustment(false);
    // Prevent keyboard auto-popup and scroll to form
    setTimeout(() => {
      blurActiveInput();
      scrollToRef(approveFormRef, { delay: 0 });
    }, 100);
  };

  const openCounter = (app) => {
    setSelectedApp(app._id);
    setMode('counter');
    setNegotiateSuccess('');
    const lastOffer = app.negotiationHistory?.length > 0
      ? app.negotiationHistory[app.negotiationHistory.length - 1]
      : null;
    setNegotiateAmount(lastOffer?.amount?.toString?.() || app.proposedAmount?.toString?.() || '');
    // Pre-fill counter time: last offer time > helper's adjustment > job's proposed time
    if (lastOffer?.proposedTime) {
      setNegotiateTime(formatDateTimeLocal(lastOffer.proposedTime));
    } else if (app.timeAdjustment) {
      setNegotiateTime(formatDateTimeLocal(app.timeAdjustment));
    } else if (job.proposedTime) {
      setNegotiateTime(formatDateTimeLocal(job.proposedTime));
    } else {
      setNegotiateTime('');
    }
    setNegotiateMessage('');
    // Prevent keyboard auto-popup and scroll to form
    setTimeout(() => {
      blurActiveInput();
      scrollToRef(counterFormRef, { delay: 0 });
    }, 100);
  };

  const handleApprove = async (appId) => {
    if (!approveTime) {
      showMsg('Please select a date and time for the job');
      return;
    }
    const amount = parseFloat(approveAmount);
    if (isNaN(amount) || amount <= 0) {
      showMsg('Please enter a valid amount');
      return;
    }
    setLoading(true);
    try {
      await axios.post(`${API_URL}/api/jobs/${job._id}/applications/${appId}/approve`,
        { approvedTime: new Date(approveTime).toISOString(), approvedAmount: amount },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      showMsg('Helper approved! Waiting for their confirmation.');
      setSelectedApp(null);
      setMode(null);
      setApproveAmount('');
      setApproveTime('');
      setUseTimeAdjustment(false);
      onUpdated();
      onClose();
    } catch (err) {
      showMsg(err.response?.data?.error || err.response?.data?.details || 'Failed to approve');
    }
    setLoading(false);
  };

  const handleReject = async (appId) => {
    if (!window.confirm('Decline this offer?')) return;
    setLoading(true);
    try {
      await axios.post(`${API_URL}/api/jobs/${job._id}/applications/${appId}/reject`, {}, { headers: { Authorization: `Bearer ${token}` } });
      showMsg('Offer declined.');
      setSelectedApp(null);
      setMode(null);
      onUpdated();
      onClose();
    } catch (err) {
      showMsg(err.response?.data?.error || 'Failed to reject');
    }
    setLoading(false);
  };

  const handleNegotiate = async (appId) => {
    const amount = parseFloat(negotiateAmount);
    if (isNaN(amount) || amount <= 0) {
      showMsg('Please enter a valid amount');
      return;
    }
    setLoading(true);
    try {
      const payload = { amount, message: negotiateMessage };
      if (negotiateTime) {
        payload.proposedTime = new Date(negotiateTime).toISOString();
      }
      await axios.post(`${API_URL}/api/jobs/${job._id}/applications/${appId}/negotiate`,
        payload,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      showMsg('Counter offer sent!');
      setNegotiateSuccess('⏳ Counter offer sent! Waiting for applicant to respond.');
      setSelectedApp(null);
      setMode(null);
      setNegotiateAmount('');
      setNegotiateTime('');
      setNegotiateMessage('');
      onUpdated();
      onClose();
    } catch (err) {
      const errData = err.response?.data;
      if (errData?.autoRejected) {
        showMsg('⚠️ ' + (errData.error || 'Offer auto-declined after max rounds.'));
        setSelectedApp(null);
        setMode(null);
        onUpdated();
        onClose();
      } else {
        showMsg(errData?.error || 'Failed to negotiate');
      }
    }
    setLoading(false);
  };

  const handleAcceptOffer = async (appId) => {
    setLoading(true);
    try {
      await axios.post(`${API_URL}/api/jobs/${job._id}/applications/${appId}/accept-offer`, {}, { headers: { Authorization: `Bearer ${token}` } });
      showMsg('Offer accepted!');
      setSelectedApp(null);
      setMode(null);
      onUpdated();
      onClose();
    } catch (err) {
      showMsg(err.response?.data?.error || 'Failed to accept offer');
    }
    setLoading(false);
  };

  const handleRejectOffer = async (appId) => {
    setLoading(true);
    try {
      await axios.post(`${API_URL}/api/jobs/${job._id}/applications/${appId}/reject-offer`, {}, { headers: { Authorization: `Bearer ${token}` } });
      showMsg('Offer rejected.');
      setSelectedApp(null);
      setMode(null);
      onUpdated();
      onClose();
    } catch (err) {
      showMsg(err.response?.data?.error || 'Failed to reject offer');
    }
    setLoading(false);
  };

  const getLastOffer = (app) => {
    if (!app.negotiationHistory?.length) return null;
    const last = app.negotiationHistory[app.negotiationHistory.length - 1];
    return last.status === 'pending' ? last : null;
  };

  useEffect(() => {
    if (!modalScrollRef.current) return;

    const apps = job.applications?.filter(a => ['pending', 'negotiating', 'approved'].includes(a.status)) || [];

    // If a form is open, focus that form first
    if (selectedApp && mode === 'approve' && approveFormRef.current) {
      const t = scrollToRef(approveFormRef);
      return () => clearTimeout(t);
    }
    if (selectedApp && mode === 'counter' && counterFormRef.current) {
      const t = scrollToRef(counterFormRef);
      return () => clearTimeout(t);
    }

    // Otherwise, auto-focus first "action-required" applicant card
    const actionApp = apps.find((app) => {
      const lastOffer = app.negotiationHistory?.length > 0 ? app.negotiationHistory[app.negotiationHistory.length - 1] : null;
      const isMyTurnToRespond = lastOffer && lastOffer.status === 'pending' && lastOffer.proposedBy?.toString?.() !== userId && lastOffer.proposedBy !== userId;
      if (isMyTurnToRespond) return true;
      if (!lastOffer && ['pending', 'negotiating', 'approved'].includes(app.status)) return true;
      return false;
    });

    if (!actionApp?._id) return;
    const t = scrollToRef({ current: applicantCardRefs.current[actionApp._id] });
    return () => clearTimeout(t);
  }, [job.applications, selectedApp, mode, userId]);

  const renderApplicantCard = (app) => {
    const applicant = typeof app.applicantId === 'object' ? app.applicantId : null;
    const applicantId = applicant?._id || applicant?.id || (typeof app.applicantId === 'string' ? app.applicantId : null);
    const applicantName = applicant?.name || app.applicantName || 'Unknown';
    const lastOffer = getLastOffer(app);
    const currentOffer = Number(lastOffer ? lastOffer.amount : app.proposedAmount) || 0;
    const baseBudget = Number(job.budget) || 0;
    const isHigherThanBudget = baseBudget > 0 && currentOffer > baseBudget;
    const offerDelta = currentOffer - baseBudget;
    const isMyTurnToRespond = lastOffer && lastOffer.proposedBy?.toString?.() !== userId && lastOffer.proposedBy !== userId;
    const reliability = applicant?.communityStats?.reliabilityScore ?? 100;
    const rating = applicant?.rating > 0 ? applicant.rating : null;
    const jobsCompleted = applicant?.communityStats?.jobsCompleted ?? 0;
    const trustStars = applicant?.trustStars ?? 0;
    const isVerified = !!applicant?.verified;
    const portfolioImages = (applicant?.portfolioImages || []).filter(img => img && (img.url || typeof img === 'string'));

    return (
      <div key={app._id} ref={(el) => { applicantCardRefs.current[app._id] = el; }} style={{
        background: '#f8fafc', borderRadius: 20, padding: 'clamp(12px, 3vw, 16px)', border: '1px solid #f1f5f9',
        transition: 'all 0.2s'
      }}>
        <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
          <div style={{
            width: 52, height: 52, borderRadius: 16, flexShrink: 0,
            background: applicant?.avatar ? `url(${getImageUrl(applicant.avatar)}) center/cover` : 'linear-gradient(135deg, #6366f1, #4f46e5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, color: 'white', fontWeight: 600, cursor: 'pointer'
          }} onClick={() => {
            if (!applicantId) { showMsg('Profile unavailable for this applicant. Please refresh applicants.'); return; }
            onViewPortfolio && onViewPortfolio({ id: applicantId, name: applicantName });
          }}>
            {!applicant?.avatar && applicant?.name?.charAt(0).toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{applicantName}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                <span style={{ fontSize: 12, color: '#94a3b8', textDecoration: 'line-through', fontWeight: 600 }}>R{job.budget}</span>
                <span style={{ fontSize: 28, fontWeight: 900, color: isHigherThanBudget ? '#dc2626' : '#4338ca', letterSpacing: -0.4 }}>R{lastOffer ? lastOffer.amount : app.proposedAmount}</span>
                {lastOffer && (
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 10, background: lastOffer.amount > job.budget ? '#fee2e2' : lastOffer.amount < job.budget ? '#dcfce7' : '#f1f5f9', color: lastOffer.amount > job.budget ? '#991b1b' : lastOffer.amount < job.budget ? '#166534' : '#475569' }}>
                    {lastOffer.amount > job.budget ? '↑' : lastOffer.amount < job.budget ? '↓' : '='} vs budget
                  </span>
                )}
              </div>
            </div>
            {/* Identity trust — how well this person has proven who they are */}
            <div style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'center', flexWrap: 'wrap' }}>
              <TrustStars stars={trustStars} size={14} />
              {isVerified && (
                <span style={{ fontSize: 10, fontWeight: 800, background: '#dbeafe', color: '#1d4ed8', padding: '2px 8px', borderRadius: 999, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  <IdCard size={12} color="currentColor" /> ID Verified
                </span>
              )}
              {applicant?.trustLevel && (
                <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700 }}>{applicant.trustLevel}</span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
              {isHigherThanBudget && (
                <span style={{ fontSize: 12, fontWeight: 800, background: '#fee2e2', color: '#991b1b', padding: '4px 10px', borderRadius: 999, border: '1px solid #fecaca' }}>
                  Higher than budget by R{offerDelta}
                </span>
              )}
              {rating && (
                <span style={{ fontSize: 11, color: '#f59e0b', fontWeight: 700 }}>⭐ {rating.toFixed(1)}</span>
              )}
              <span style={{ fontSize: 11, background: '#f0fdf4', color: '#166534', padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>✅ {jobsCompleted} done</span>
              <span style={{ fontSize: 11, background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>Reliability: {reliability}%</span>
              {applicant?.primaryCategory && (
                <span style={{ fontSize: 11, background: '#eef2ff', color: '#4338ca', padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>{applicant.primaryCategory}</span>
              )}
              {app.status === 'negotiating' && (
                <span style={{ fontSize: 11, background: '#fef3c7', color: '#b45309', padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>
                  Negotiating {app.negotiationHistory?.length > 0 ? `(${app.negotiationHistory.length}/${MAX_NEGOTIATION_ROUNDS})` : ''}
                </span>
              )}
              {app.status === 'negotiating' && app.negotiationHistory?.length >= 2 && (
                <span style={{ fontSize: 11, background: '#fee2e2', color: '#991b1b', padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>⚠️ Final round</span>
              )}
            </div>
          </div>
        </div>

        {/* Skills */}
        {applicant?.skills?.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            {applicant.skills.slice(0, 6).map((skill, i) => (
              <span key={i} style={{ fontSize: 11, background: 'white', color: '#475569', padding: '3px 10px', borderRadius: 20, fontWeight: 600, border: '1px solid #e2e8f0' }}>{skill}</span>
            ))}
            {applicant.skills.length > 6 && (
              <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>+{applicant.skills.length - 6} more</span>
            )}
          </div>
        )}

        {/* Portfolio preview */}
        {portfolioImages.length > 0 && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, overflowX: 'auto', paddingBottom: 4 }}>
            {portfolioImages.slice(0, 4).map((img, i) => (
              <img key={i} src={getImageUrl(img)} alt="" onError={(e) => { e.target.onerror = null; e.target.src = PLACEHOLDER_IMG; }} style={{ width: 64, height: 64, borderRadius: 12, objectFit: 'cover', flexShrink: 0, border: '2px solid #e2e8f0', cursor: 'pointer' }} />
            ))}
          </div>
        )}

        {app.message && (
          <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.5, marginBottom: 12, background: 'white', padding: 12, borderRadius: 12 }}>
            "{app.message}"
          </div>
        )}
        {/* Time info */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: '#475569', background: '#f1f5f9', padding: '8px 12px', borderRadius: 10, fontWeight: 600, marginBottom: 6 }}>
            📅 Your time: {job.proposedTime ? new Date(job.proposedTime).toLocaleString() : 'Not set'}
          </div>
          {app.timeAdjustment ? (
            <div style={{ fontSize: 12, color: '#b45309', background: '#fef3c7', padding: '8px 12px', borderRadius: 10, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
              🔄 Helper suggests: {new Date(app.timeAdjustment).toLocaleString()}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: '#166534', background: '#dcfce7', padding: '8px 12px', borderRadius: 10, fontWeight: 600 }}>
              ✅ Helper is happy with your proposed time
            </div>
          )}
        </div>
        <button
          onClick={() => {
            if (!applicantId) { showMsg('Profile unavailable for this applicant. Please refresh applicants.'); return; }
            onViewPortfolio && onViewPortfolio({ id: applicantId, name: applicantName });
          }}
          disabled={!applicantId}
          style={{
          width: '100%', padding: 'clamp(10px, 2.5vw, 12px)', borderRadius: 12, border: 'none', fontSize: 13, fontWeight: 700, cursor: applicantId ? 'pointer' : 'not-allowed',
          background: applicantId ? 'linear-gradient(135deg, #6366f1, #4f46e5)' : '#cbd5e1', color: 'white', marginBottom: 12, minHeight: 44,
          opacity: applicantId ? 1 : 0.75, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6
        }}><UserCircle size={15} /> View Full Profile & Past Work</button>

        {lastOffer && (
          <div style={{ background: '#fffbeb', borderRadius: 16, padding: 14, marginBottom: 12, border: lastOffer.proposedBy?.toString?.() !== userId && lastOffer.proposedBy !== userId ? '2px solid #f59e0b' : '1px solid #fde68a', boxShadow: lastOffer.proposedBy?.toString?.() !== userId && lastOffer.proposedBy !== userId ? '0 0 0 3px rgba(245,158,11,0.15)' : 'none' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#b45309', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              {lastOffer.proposedBy?.toString?.() === userId || lastOffer.proposedBy === userId ? '✅ Your counter offer:' : '🔔 New offer from helper:'}
            </div>
            {(() => {
              const prevAmount = app.negotiationHistory?.length > 1
                ? app.negotiationHistory[app.negotiationHistory.length - 2].amount
                : app.proposedAmount;
              const diff = lastOffer.amount - prevAmount;
              const isLower = diff < 0;
              const isHigher = diff > 0;
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                  <div style={{ flex: '1 1 100px', background: '#f8fafc', borderRadius: 14, padding: '12px 14px', textAlign: 'center', border: '1px solid #e2e8f0' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>Previous</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: '#475569', marginTop: 4 }}>R{prevAmount}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 28 }}>
                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#fef3c7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, color: '#b45309' }}>→</div>
                  </div>
                  <div style={{ flex: '1 1 100px', background: '#ffffff', borderRadius: 14, padding: '12px 14px', textAlign: 'center', border: '2px solid #fde68a' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#b45309', textTransform: 'uppercase', letterSpacing: 0.5 }}>New Offer</div>
                    <div style={{ fontSize: 34, fontWeight: 900, color: '#111827', marginTop: 4, letterSpacing: -0.4 }}>R{lastOffer.amount}</div>
                  </div>
                  {diff !== 0 && (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      background: isLower ? '#dcfce7' : '#fee2e2',
                      color: isLower ? '#166534' : '#991b1b',
                      padding: '8px 14px', borderRadius: 20, fontSize: 13, fontWeight: 700
                    }}>
                      <span>{isLower ? '↓' : '↑'}</span>
                      <span>R{Math.abs(diff)} ({isLower ? 'Lower' : 'Higher'})</span>
                    </div>
                  )}
                  {diff === 0 && (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      background: '#f1f5f9', color: '#475569',
                      padding: '8px 14px', borderRadius: 20, fontSize: 13, fontWeight: 700
                    }}>
                      <span>→</span>
                      <span>No change</span>
                    </div>
                  )}
                </div>
              );
            })()}
            {lastOffer.proposedTime && (
              <div style={{ fontSize: 12, color: '#4338ca', marginTop: 4, fontWeight: 600 }}>
                📅 {new Date(lastOffer.proposedTime).toLocaleString()}
              </div>
            )}
            {lastOffer.message && <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{lastOffer.message}</div>}
            {isMyTurnToRespond && (
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <button onClick={() => handleAcceptOffer(app._id)} disabled={loading} style={{
                  flex: '1 1 100px', padding: 'clamp(10px, 2.5vw, 12px)', borderRadius: 12, border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  background: '#22c55e', color: 'white', minHeight: 44
                }}>✅ Accept Offer</button>
                <button onClick={() => handleRejectOffer(app._id)} disabled={loading} style={{
                  flex: '1 1 100px', padding: 'clamp(10px, 2.5vw, 12px)', borderRadius: 12, border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  background: '#fee2e2', color: '#991b1b', minHeight: 44
                }}>❌ Reject</button>
                <button onClick={() => openCounter(app)} disabled={loading || app.negotiationHistory?.length >= MAX_NEGOTIATION_ROUNDS} style={{
                  flex: '1 1 100px', padding: 'clamp(10px, 2.5vw, 12px)', borderRadius: 12, border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  background: '#dbeafe', color: '#1d4ed8', minHeight: 44,
                  opacity: loading || app.negotiationHistory?.length >= MAX_NEGOTIATION_ROUNDS ? 0.5 : 1
                }}>💬 Counter {app.negotiationHistory?.length > 0 ? `(${app.negotiationHistory.length}/${MAX_NEGOTIATION_ROUNDS})` : ''}</button>
              </div>
            )}
            {!isMyTurnToRespond && lastOffer.status === 'pending' && (
              <div style={{ marginTop: 10, padding: '10px 12px', background: '#eff6ff', borderRadius: 10, border: '1px solid #bfdbfe', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 16 }}>⏳</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#1d4ed8' }}>Waiting for applicant to respond to your offer</span>
              </div>
            )}
          </div>
        )}

        {/* Negotiation history toggle */}
        {app.negotiationHistory?.length > 1 && (
          <details style={{ marginBottom: 12 }}>
            <summary style={{ fontSize: 12, color: '#64748b', cursor: 'pointer', fontWeight: 600 }}>View negotiation history ({app.negotiationHistory.length})</summary>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[...app.negotiationHistory].reverse().map((n, i) => {
                const originalIndex = app.negotiationHistory.length - 1 - i;
                const prevAmount = originalIndex > 0 ? app.negotiationHistory[originalIndex - 1].amount : app.proposedAmount;
                const diff = n.amount - prevAmount;
                const isLower = diff < 0;
                const isHigher = diff > 0;
                const round = originalIndex + 1;
                const isYou = n.proposedBy?.toString?.() === userId || n.proposedBy === userId;
                return (
                  <div key={i} style={{ fontSize: 12, padding: '10px 12px', background: 'white', borderRadius: 10, color: '#475569', border: '1px solid #e2e8f0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 4 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8', background: '#f1f5f9', padding: '2px 6px', borderRadius: 6 }}>Round {round}</span>
                        <span style={{ fontWeight: 700, color: isYou ? '#4f46e5' : '#059669' }}>{isYou ? 'You' : 'Helper'}</span>
                      </div>
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                        background: n.status === 'pending' ? '#fef3c7' : n.status === 'accepted' ? '#dcfce7' : n.status === 'rejected' ? '#fee2e2' : '#f1f5f9',
                        color: n.status === 'pending' ? '#b45309' : n.status === 'accepted' ? '#166534' : n.status === 'rejected' ? '#991b1b' : '#475569'
                      }}>{n.status}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 800, color: '#1e293b', fontSize: 18 }}>R{n.amount}</span>
                      {diff !== 0 && (
                        <span style={{
                          display: 'flex', alignItems: 'center', gap: 3,
                          fontSize: 11, fontWeight: 700,
                          color: isLower ? '#166534' : '#991b1b',
                          background: isLower ? '#dcfce7' : '#fee2e2',
                          padding: '2px 8px', borderRadius: 8
                        }}>
                          {isLower ? '↓' : '↑'} R{Math.abs(diff)} from previous
                        </span>
                      )}
                      {diff === 0 && (
                        <span style={{
                          display: 'flex', alignItems: 'center', gap: 3,
                          fontSize: 11, fontWeight: 700,
                          color: '#64748b', background: '#f1f5f9',
                          padding: '2px 8px', borderRadius: 8
                        }}>
                          = Same as previous
                        </span>
                      )}
                    </div>
                    {n.proposedTime && (
                      <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>📅 {new Date(n.proposedTime).toLocaleString()}</div>
                    )}
                    {n.message && <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{n.message}</div>}
                  </div>
                );
              })}
            </div>
          </details>
        )}

        {selectedApp === app._id && mode === 'approve' ? (
          <div ref={approveFormRef} style={{ background: 'white', borderRadius: 16, padding: 14, marginBottom: 12, border: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', marginBottom: 8 }}>✅ Review & Approve</div>
            <p style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>
              Confirm the final price and time. Your helper must accept before you start.
            </p>

            {/* Price */}
            <div style={{ marginBottom: 10 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 4 }}>Final Price (R)</label>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 13, fontWeight: 700, color: '#6366f1' }}>R</span>
                <input type="number" value={approveAmount} onChange={e => setApproveAmount(e.target.value)}
                  onFocus={(e) => mobileFieldFocusScroll(e)}
                  style={{ width: '100%', padding: '10px 12px 10px 28px', borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 14, boxSizing: 'border-box', minHeight: 44 }} />
              </div>
              <p style={{ fontSize: 13, color: '#64748b', margin: '6px 0 0', fontWeight: 700 }}>
                They proposed:
                <span style={{ color: '#4338ca', fontSize: 28, fontWeight: 900, marginLeft: 8, letterSpacing: -0.4 }}>R{app.proposedAmount}</span>
              </p>
            </div>

            {/* Time review */}
            <div style={{ marginBottom: 10 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 6 }}>Work Time</label>

              {/* Poster original time */}
              <div style={{ background: '#f1f5f9', borderRadius: 12, padding: '10px 12px', marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, marginBottom: 2 }}>Your proposed time</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#1e293b' }}>
                  📅 {job.proposedTime ? new Date(job.proposedTime).toLocaleString() : 'Not set'}
                </div>
              </div>

              {/* Helper time adjustment */}
              {app.timeAdjustment ? (
                <div style={{ background: '#fef3c7', borderRadius: 12, padding: '10px 12px', marginBottom: 8, border: '1px solid #fde68a' }}>
                  <div style={{ fontSize: 11, color: '#b45309', fontWeight: 700, marginBottom: 6 }}>🔄 Helper suggests a different time</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#1e293b', marginBottom: 8 }}>
                    {new Date(app.timeAdjustment).toLocaleString()}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => {
                      setUseTimeAdjustment(true);
                      setApproveTime(formatDateTimeLocal(app.timeAdjustment));
                    }} style={{
                      flex: 1, padding: '8px 12px', borderRadius: 10, border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                      background: useTimeAdjustment ? '#22c55e' : '#f1f5f9', color: useTimeAdjustment ? 'white' : '#475569', minHeight: 36
                    }}>✅ Accept Their Time</button>
                    <button onClick={() => {
                      setUseTimeAdjustment(false);
                      if (job.proposedTime) setApproveTime(formatDateTimeLocal(job.proposedTime));
                    }} style={{
                      flex: 1, padding: '8px 12px', borderRadius: 10, border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                      background: !useTimeAdjustment ? '#6366f1' : '#f1f5f9', color: !useTimeAdjustment ? 'white' : '#475569', minHeight: 36
                    }}>⏰ Keep My Time</button>
                  </div>
                </div>
              ) : (
                <div style={{ background: '#dcfce7', borderRadius: 12, padding: '10px 12px', marginBottom: 8, border: '1px solid #86efac' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#166534' }}>
                    ✅ Helper is happy with your proposed time
                  </div>
                </div>
              )}

              {/* Manual override */}
              <div style={{ marginTop: 6 }}>
                <label style={{ display: 'block', fontSize: 10, fontWeight: 600, color: '#94a3b8', marginBottom: 4 }}>Or pick a different time manually</label>
                <input type="datetime-local" value={approveTime} onChange={e => { setApproveTime(e.target.value); setUseTimeAdjustment(false); }}
                  onFocus={(e) => mobileFieldFocusScroll(e)}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 14, boxSizing: 'border-box', minHeight: 44 }} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => handleApprove(app._id)} disabled={loading} style={{
                flex: 1, padding: 'clamp(10px, 2.5vw, 12px)', borderRadius: 12, border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                background: 'linear-gradient(135deg, #22c55e, #16a34a)', color: 'white', minHeight: 44
              }}>✅ Confirm Approval</button>
              <button onClick={() => { setSelectedApp(null); setMode(null); setApproveAmount(''); setApproveTime(''); setUseTimeAdjustment(false); }} style={{
                padding: 'clamp(10px, 2.5vw, 12px) 14px', borderRadius: 12, border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                background: '#f1f5f9', color: '#475569', minHeight: 44
              }}>Cancel</button>
            </div>
          </div>
        ) : selectedApp === app._id && mode === 'counter' ? (
          <div ref={counterFormRef} style={{ background: 'white', borderRadius: 16, padding: 12, marginBottom: 12, border: '2px solid #6366f1', boxShadow: '0 4px 12px rgba(99,102,241,0.12)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', marginBottom: 6 }}>💬 Send Counter Offer</div>
            <p style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>Propose a different price and/or time.</p>
            {app.negotiationHistory?.length >= 2 && (
              <div style={{ fontSize: 11, color: '#991b1b', background: '#fee2e2', padding: '8px 10px', borderRadius: 8, marginBottom: 8, fontWeight: 600 }}>
                ⚠️ Final round — {app.negotiationHistory.length}/${MAX_NEGOTIATION_ROUNDS} used
              </div>
            )}
            {app.negotiationHistory?.length > 0 && app.negotiationHistory?.length < 2 && (
              <div style={{ fontSize: 11, color: '#b45309', background: '#fef3c7', padding: '6px 10px', borderRadius: 8, marginBottom: 8, fontWeight: 600 }}>
                Round {app.negotiationHistory.length}/${MAX_NEGOTIATION_ROUNDS} used
              </div>
            )}
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 4 }}>Your Price (R)</label>
            <input type="number" value={negotiateAmount} onChange={e => setNegotiateAmount(e.target.value)} placeholder="Amount"
              onFocus={(e) => mobileFieldFocusScroll(e)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 14, marginBottom: 8, boxSizing: 'border-box', minHeight: 40 }} />
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 4 }}>Work Time</label>
            <input type="datetime-local" value={negotiateTime} onChange={e => setNegotiateTime(e.target.value)}
              onFocus={(e) => mobileFieldFocusScroll(e)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 14, marginBottom: 8, boxSizing: 'border-box', minHeight: 40 }} />
            <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
              {job.proposedTime && (
                <span style={{ fontSize: 10, color: '#94a3b8' }}>📅 Your: {new Date(job.proposedTime).toLocaleString()}</span>
              )}
              {app.timeAdjustment && (
                <span style={{ fontSize: 10, color: '#b45309' }}>🔄 Helper: {new Date(app.timeAdjustment).toLocaleString()}</span>
              )}
              {app.negotiationHistory?.length > 0 && app.negotiationHistory[app.negotiationHistory.length - 1].proposedTime && (
                <span style={{ fontSize: 10, color: '#94a3b8' }}>🔄 Last: {new Date(app.negotiationHistory[app.negotiationHistory.length - 1].proposedTime).toLocaleString()}</span>
              )}
            </div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 4 }}>Message (optional)</label>
            <input value={negotiateMessage} onChange={e => setNegotiateMessage(e.target.value)} placeholder="Add a note..."
              onFocus={(e) => mobileFieldFocusScroll(e)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 14, marginBottom: 10, boxSizing: 'border-box', minHeight: 40 }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => handleNegotiate(app._id)} disabled={loading || app.negotiationHistory?.length >= MAX_NEGOTIATION_ROUNDS} style={{
                flex: 1, padding: '10px', borderRadius: 10, border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                background: 'linear-gradient(135deg, #6366f1, #4f46e5)', color: 'white', minHeight: 40,
                opacity: loading || app.negotiationHistory?.length >= MAX_NEGOTIATION_ROUNDS ? 0.5 : 1
              }}>{app.negotiationHistory?.length >= MAX_NEGOTIATION_ROUNDS ? 'Max Rounds' : 'Send Counter'}</button>
              <button onClick={() => { setSelectedApp(null); setMode(null); }} style={{
                padding: '10px 14px', borderRadius: 10, border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                background: '#f1f5f9', color: '#475569', minHeight: 40
              }}>Cancel</button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={() => openApprove(app)} disabled={loading || !!lastOffer} style={{
              flex: 1, padding: 'clamp(11px, 2.5vw, 13px)', borderRadius: 14, border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              background: app.proposedTime ? '#dcfce7' : 'linear-gradient(135deg, #22c55e, #16a34a)',
              color: app.proposedTime ? '#166534' : 'white',
              opacity: loading || !!lastOffer ? 0.5 : 1, minHeight: 44
            }}>✅ Approve</button>
            <button onClick={() => openCounter(app)} disabled={loading || !!lastOffer || app.negotiationHistory?.length >= MAX_NEGOTIATION_ROUNDS} style={{
              flex: 1, padding: 'clamp(11px, 2.5vw, 13px)', borderRadius: 14, border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              background: '#dbeafe', color: '#1d4ed8',
              opacity: loading || !!lastOffer || app.negotiationHistory?.length >= MAX_NEGOTIATION_ROUNDS ? 0.5 : 1, minHeight: 44
            }}>💬 Counter {app.negotiationHistory?.length > 0 ? `(${app.negotiationHistory.length}/${MAX_NEGOTIATION_ROUNDS})` : ''}</button>
            <button onClick={() => handleReject(app._id)} disabled={loading} style={{
              padding: 'clamp(11px, 2.5vw, 13px) 14px', borderRadius: 14, border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              background: '#fee2e2', color: '#991b1b', minHeight: 44
            }}>❌</button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={modalOverlayStyle} onClick={onClose}>
      <div ref={modalScrollRef} style={{ ...modalContentStyle(540) }} onClick={e => e.stopPropagation()}>
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 'clamp(18px, 4vw, 20px)', fontWeight: 800, color: '#1e293b' }}>🤝 People Offering to Help</h3>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748b' }}>{job.title}</p>
        </div>

        {message && (
          <div style={{ background: '#1e293b', color: 'white', padding: '12px 16px', borderRadius: 14, marginBottom: 16, fontSize: 13, fontWeight: 700 }}>
            {message}
          </div>
        )}
        {negotiateSuccess && (
          <div style={{ background: '#dbeafe', color: '#1e3a8a', padding: '12px 16px', borderRadius: 14, marginBottom: 16, fontSize: 13, fontWeight: 700, border: '1px solid #93c5fd' }}>
            {negotiateSuccess}
          </div>
        )}

        {activeApps.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>📭</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b' }}>No one has offered to help yet</div>
            <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>Neighbours will appear here once they offer to help</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {activeApps.map(renderApplicantCard)}
          </div>
        )}

        {otherApps.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#94a3b8', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Previous</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {otherApps.map(app => (
                <div key={app._id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: '#f8fafc', borderRadius: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 12,
                      background: app.applicantId?.avatar ? `url(${getImageUrl(app.applicantId.avatar)}) center/cover` : 'linear-gradient(135deg, #6366f1, #4f46e5)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'white', fontWeight: 600
                    }}>{!app.applicantId?.avatar && app.applicantId?.name?.charAt(0).toUpperCase()}</div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#1e293b' }}>{app.applicantId?.name || 'Unknown'}</div>
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>R{app.proposedAmount}</div>
                    </div>
                  </div>
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
                    background: app.status === 'accepted' ? '#dcfce7' : app.status === 'approved' ? '#dbeafe' : app.status === 'rejected' ? '#fee2e2' : '#f3f4f6',
                    color: app.status === 'accepted' ? '#166534' : app.status === 'approved' ? '#1d4ed8' : app.status === 'rejected' ? '#991b1b' : '#6b7280'
                  }}>{app.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Sticky Bottom Close */}
        <div style={{ position: 'sticky', bottom: 0, background: 'white', padding: '12px 0', borderTop: '1px solid #e2e8f0', marginTop: 20, display: 'flex', justifyContent: 'center', zIndex: 5 }}>
          <button onClick={onClose} style={{ padding: '10px 24px', borderRadius: 12, border: 'none', fontSize: 14, fontWeight: 700, cursor: 'pointer', background: '#f1f5f9', color: '#475569' }}>
            ✕ Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default JobApplicantsModal;
