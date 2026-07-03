import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import PhotoGallery from './PhotoGallery';
import JobCompletionSummary from './JobCompletionSummary';
import { getImageUrl, PLACEHOLDER_IMG, categoryEmojis, categoryGradients } from '../shared/constants';

const API_URL = process.env.REACT_APP_API_URL || '';

const statusConfig = {
  open:          { label: 'Open',           color: '#22c55e', bg: '#dcfce7', hint: 'Accepting applications' },
  negotiating:   { label: 'Negotiating',    color: '#8b5cf6', bg: '#ede9fe', hint: 'Offers in progress' },
  approved:      { label: 'Approved',       color: '#3b82f6', bg: '#dbeafe', hint: 'Schedule confirmed' },
  accepted:      { label: 'Accepted',       color: '#f59e0b', bg: '#fef3c7', hint: 'Ready to start' },
  in_progress:   { label: 'In Progress',    color: '#f97316', bg: '#ffedd5', hint: 'Work ongoing' },
  pending_review:{ label: 'Pending Review', color: '#ec4899', bg: '#fce7f3', hint: 'Awaiting confirmation' },
  pending_payment:{label: 'Pending Payment',color: '#6366f1', bg: '#e0e7ff', hint: 'Payment required' },
  completed:     { label: 'Completed',      color: '#10b981', bg: '#d1fae5', hint: 'Done & reviewed' },
};

function WorkHistory() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('active'); // 'active' | 'history'
  const [allJobs, setAllJobs] = useState([]);
  const [completedJobs, setCompletedJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewingJob, setViewingJob] = useState(null);
  const [galleryPhotos, setGalleryPhotos] = useState([]);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [showGallery, setShowGallery] = useState(false);
  const [filter, setFilter] = useState('all'); // all | client | provider
  const [isMobile, setIsMobile] = useState(false);

  const token = localStorage.getItem('token');
  const userId = token ? (() => { try { return JSON.parse(atob(token.split('.')[1])).userId; } catch { return null; } })() : null;

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const fetchJobs = async () => {
    if (!token) { setLoading(false); return; }
    setLoading(true);
    try {
      const [myJobsRes, myAppsRes] = await Promise.all([
        axios.get(`${API_URL}/api/jobs/my-jobs`, { headers: { Authorization: `Bearer ${token}` } }),
        axios.get(`${API_URL}/api/jobs/my-applications`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const myJobs = Array.isArray(myJobsRes.data) ? myJobsRes.data : (myJobsRes.data.jobs || []);
      const myApps = Array.isArray(myAppsRes.data) ? myAppsRes.data : (myAppsRes.data.jobs || []);

      // Combine and deduplicate
      const seen = new Set();
      const unique = [];
      for (const job of [...myJobs, ...myApps]) {
        if (!seen.has(job._id)) { seen.add(job._id); unique.push(job); }
      }
      setAllJobs(unique);
      setCompletedJobs(unique.filter(j => j.status === 'completed'));
    } catch (err) { console.error('Fetch jobs error:', err); }
    setLoading(false);
  };

  useEffect(() => { fetchJobs(); }, []);

  const isPoster = (job) => job.posterId?._id?.toString?.() === userId || job.posterId?.toString?.() === userId;
  const myApplication = (job) => job.applications?.find(a => a.applicantId?._id?.toString?.() === userId || a.applicantId?.toString?.() === userId);

  const activeJobs = allJobs.filter(j => j.status !== 'completed').sort((a, b) => {
    const order = { in_progress: 0, pending_review: 1, pending_payment: 2, accepted: 3, approved: 4, negotiating: 5, open: 6 };
    return (order[a.status] ?? 99) - (order[b.status] ?? 99);
  });

  const filteredHistory = completedJobs.filter(job => {
    const poster = isPoster(job);
    if (filter === 'client') return poster;
    if (filter === 'provider') return !poster;
    return true;
  });

  // History stats
  const totalEarnings = filteredHistory.reduce((sum, job) => {
    const app = job.applications?.find(a => a.status === 'accepted');
    const isProv = app?.applicantId?._id?.toString?.() === userId || app?.applicantId?.toString?.() === userId;
    if (!isProv) return sum;
    return sum + (app?.approvedAmount || app?.proposedAmount || job.budget || 0);
  }, 0);
  const totalSpent = filteredHistory.reduce((sum, job) => {
    if (!isPoster(job)) return sum;
    const app = job.applications?.find(a => a.status === 'accepted');
    return sum + (app?.approvedAmount || app?.proposedAmount || job.budget || 0);
  }, 0);
  const asProvider = filteredHistory.filter(j => {
    const app = j.applications?.find(a => a.status === 'accepted');
    return app?.applicantId?._id?.toString?.() === userId || app?.applicantId?.toString?.() === userId;
  }).length;
  const asClient = filteredHistory.filter(j => isPoster(j)).length;

  const openGallery = (photos, startIdx = 0) => {
    const normalized = (photos || []).filter(p => p && (p.url || typeof p === 'string'));
    if (normalized.length === 0) return;
    setGalleryPhotos(normalized); setGalleryIndex(startIdx); setShowGallery(true);
  };

  const StatusBadge = ({ status }) => {
    const cfg = statusConfig[status] || statusConfig.open;
    return (
      <span style={{
        fontSize: 11, fontWeight: 800, color: cfg.color, background: cfg.bg,
        padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap'
      }}>{cfg.label}</span>
    );
  };

  const renderActiveCard = (job) => {
    const emoji = categoryEmojis[job.category] || '✨';
    const gradient = categoryGradients[job.category] || categoryGradients.Other;
    const poster = isPoster(job);
    const app = myApplication(job);
    const cfg = statusConfig[job.status] || statusConfig.open;
    const amount = app?.approvedAmount || app?.proposedAmount || job.budget || 0;
    const otherName = poster
      ? (app?.applicantId?.name || 'No helper yet')
      : (job.posterId?.name || 'Unknown');

    return (
      <div key={job._id} style={{
        background: 'white', borderRadius: 20, overflow: 'hidden', border: '1px solid #f1f5f9',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      }}>
        <div style={{ display: 'flex', padding: 16, gap: 14 }}>
          {/* Emoji block */}
          <div style={{
            width: 52, height: 52, borderRadius: 16, flexShrink: 0,
            background: gradient, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 24, boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
          }}>{emoji}</div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
              <h4 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: '#1e293b', lineHeight: 1.35, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{job.title}</h4>
              <StatusBadge status={job.status} />
            </div>

            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8, fontWeight: 500 }}>
              {poster ? '👤 You posted' : '🔧 You applied'} • {otherName} {amount > 0 && <span style={{ color: '#6366f1', fontWeight: 700 }}>• R{amount}</span>}
            </div>

            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 10, fontWeight: 500 }}>
              {cfg.hint}
            </div>

            <button onClick={() => navigate(`/jobs?view=${job._id}`)} style={{
              width: '100%', padding: '10px', borderRadius: 12, border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              background: 'linear-gradient(135deg, #6366f1, #4f46e5)', color: 'white', minHeight: 40
            }}>
              View Details →
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderHistoryCard = (job) => {
    const emoji = categoryEmojis[job.category] || '✨';
    const gradient = categoryGradients[job.category] || categoryGradients.Other;
    const poster = isPoster(job);
    const amount = job.applications?.find(a => a.status === 'accepted')?.approvedAmount || job.proposedAmount || job.budget || 0;
    const completedDate = job.completedAt ? new Date(job.completedAt).toLocaleDateString() : '';
    const myRating = poster ? job.posterReview?.overallRating : job.providerReview?.overallRating;
    const otherRating = poster ? job.providerReview?.overallRating : job.posterReview?.overallRating;
    const myReviewed = poster ? job.posterReviewed : job.providerReviewed;
    const otherReviewed = poster ? job.providerReviewed : job.posterReviewed;

    return (
      <div key={job._id} style={{
        background: 'white', borderRadius: 20, overflow: 'hidden', border: '1px solid #f1f5f9',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      }}>
        {/* Image header */}
        <div style={{ position: 'relative', height: 160, background: '#f8fafc', overflow: 'hidden' }}>
          {job.images?.[0] ? (
            <img src={getImageUrl(job.images[0])} alt="" onError={(e) => { e.target.onerror = null; e.target.src = PLACEHOLDER_IMG; }} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: gradient }}>
              <span style={{ fontSize: 56, opacity: 0.4 }}>{emoji}</span>
            </div>
          )}
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 60, background: 'linear-gradient(to top, rgba(0,0,0,0.4), transparent)' }} />
          <div style={{ position: 'absolute', top: 10, left: 10, padding: '5px 10px', borderRadius: 20, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)', color: 'white', fontSize: 11, fontWeight: 700 }}>
            {poster ? '👤 You posted' : '🔧 You worked'}
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '16px 18px 14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8, gap: 10 }}>
            <h4 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: '#1e293b', lineHeight: 1.35, flex: 1 }}>{job.title}</h4>
            <span style={{ fontSize: 15, fontWeight: 800, color: '#22c55e', flexShrink: 0 }}>R{amount}</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: '#64748b', fontWeight: 700, background: '#f1f5f9', padding: '3px 10px', borderRadius: 20 }}>{emoji} {job.category}</span>
            {completedDate && <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>{completedDate}</span>}
          </div>

          {/* Photos row */}
          {(job.images?.length > 0 || job.workProofPhotos?.length > 0) && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 12, overflowX: 'auto', paddingBottom: 2 }}>
              {job.images?.slice(0, 3).map((img, i) => (
                <img key={`b-${i}`} src={getImageUrl(img)} alt="" onClick={() => openGallery(job.images, i)} onError={(e) => { e.target.onerror = null; e.target.src = PLACEHOLDER_IMG; }} style={{ width: 48, height: 48, borderRadius: 10, objectFit: 'cover', cursor: 'pointer', border: '2px solid #fecaca', flexShrink: 0 }} />
              ))}
              {job.workProofPhotos?.slice(0, 3).map((p, i) => (
                <img key={`a-${i}`} src={getImageUrl(p)} alt="" onClick={() => openGallery(job.workProofPhotos, i)} onError={(e) => { e.target.onerror = null; e.target.src = PLACEHOLDER_IMG; }} style={{ width: 48, height: 48, borderRadius: 10, objectFit: 'cover', cursor: 'pointer', border: '2px solid #bbf7d0', flexShrink: 0 }} />
              ))}
              {(job.images?.length > 3 || job.workProofPhotos?.length > 3) && (
                <div style={{ width: 48, height: 48, borderRadius: 10, background: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#475569', flexShrink: 0 }}>+</div>
              )}
            </div>
          )}

          {/* Rating badges */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            {myReviewed && (
              <span style={{ background: '#fef9c3', color: '#854d0e', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600 }}>⭐ You: {myRating}/5</span>
            )}
            {otherReviewed && (
              <span style={{ background: '#dbeafe', color: '#1d4ed8', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600 }}>⭐ Them: {otherRating}/5</span>
            )}
          </div>

          <button onClick={() => setViewingJob(job)} style={{
            width: '100%', padding: '11px', borderRadius: 12, border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer',
            background: 'linear-gradient(135deg, #065f46, #047857)', color: 'white',
          }}>📋 View Summary</button>
        </div>
      </div>
    );
  };

  const tabBtn = (key, label, count) => {
    const active = activeTab === key;
    return (
      <button onClick={() => setActiveTab(key)} style={{
        flex: 1, padding: '12px', borderRadius: 14, border: 'none', fontSize: 14, fontWeight: 700, cursor: 'pointer',
        background: active ? '#1e293b' : '#f1f5f9', color: active ? 'white' : '#64748b',
        transition: 'all 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      }}>
        {label}
        {count > 0 && <span style={{ fontSize: 12, opacity: 0.8, fontWeight: 800 }}>{count}</span>}
      </button>
    );
  };

  const filterBtn = (key, label, count) => {
    const active = filter === key;
    return (
      <button onClick={() => setFilter(key)} style={{
        padding: '8px 14px', borderRadius: 12, border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
        background: active ? '#1e293b' : '#f1f5f9', color: active ? 'white' : '#64748b', transition: 'all 0.2s',
      }}>
        {label} {count > 0 && <span style={{ opacity: 0.7 }}>({count})</span>}
      </button>
    );
  };

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', width: '100%', padding: '0 16px calc(40px + env(safe-area-inset-bottom, 0px))' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, marginTop: 12 }}>
        <button onClick={() => navigate('/dashboard')} style={{
          padding: '10px 14px', borderRadius: 12, border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer',
          background: '#f1f5f9', color: '#475569', display: 'flex', alignItems: 'center', gap: 6,
        }}>← Back</button>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#1e293b' }}>🛠️ My Work</h2>
      </div>

      {/* Tab Switcher */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {tabBtn('active', 'Active', activeJobs.length)}
        {tabBtn('history', 'History', completedJobs.length)}
      </div>

      {/* ========== ACTIVE TAB ========== */}
      {activeTab === 'active' && (
        <>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[1, 2, 3].map(i => (
                <div key={i} style={{ height: 140, background: '#e2e8f0', borderRadius: 20, animation: 'pulse 1.5s infinite' }} />
              ))}
            </div>
          ) : activeJobs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', background: 'white', borderRadius: 20, border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>📋</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#1e293b', marginBottom: 6 }}>No active jobs</div>
              <div style={{ fontSize: 14, color: '#64748b', marginBottom: 16 }}>You're all caught up! Browse open gigs to find work or post a job.</div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                <button onClick={() => navigate('/jobs')} style={{
                  padding: '12px 24px', borderRadius: 14, border: 'none', fontSize: 14, fontWeight: 700, cursor: 'pointer',
                  background: 'linear-gradient(135deg, #6366f1, #4f46e5)', color: 'white'
                }}>Browse Gigs</button>
                <button onClick={() => navigate('/jobs')} style={{
                  padding: '12px 24px', borderRadius: 14, border: 'none', fontSize: 14, fontWeight: 700, cursor: 'pointer',
                  background: '#f1f5f9', color: '#475569'
                }}>Post a Job</button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {activeJobs.map(job => renderActiveCard(job))}
            </div>
          )}
        </>
      )}

      {/* ========== HISTORY TAB ========== */}
      {activeTab === 'history' && (
        <>
          {/* Stats */}
          {completedJobs.length > 0 && (
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', marginBottom: 20, paddingBottom: 4 }}>
              <div style={{ flexShrink: 0, background: 'white', borderRadius: 16, padding: '14px 16px', border: '1px solid #f1f5f9', textAlign: 'center', minWidth: 90 }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#22c55e' }}>R{totalEarnings}</div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 2, fontWeight: 600 }}>Earned</div>
              </div>
              <div style={{ flexShrink: 0, background: 'white', borderRadius: 16, padding: '14px 16px', border: '1px solid #f1f5f9', textAlign: 'center', minWidth: 90 }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#ef4444' }}>R{totalSpent}</div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 2, fontWeight: 600 }}>Spent</div>
              </div>
              <div style={{ flexShrink: 0, background: 'white', borderRadius: 16, padding: '14px 16px', border: '1px solid #f1f5f9', textAlign: 'center', minWidth: 90 }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#4f46e5' }}>{completedJobs.length}</div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 2, fontWeight: 600 }}>Total</div>
              </div>
            </div>
          )}

          {/* Filter */}
          {completedJobs.length > 0 && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
              {filterBtn('all', 'All', completedJobs.length)}
              {filterBtn('client', 'As Client', asClient)}
              {filterBtn('provider', 'Helping', asProvider)}
            </div>
          )}

          {loading ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))', gap: 16 }}>
              {[1, 2].map(i => (
                <div key={i} style={{ height: 300, background: '#e2e8f0', borderRadius: 20, animation: 'pulse 1.5s infinite' }} />
              ))}
            </div>
          ) : (
            <>
              {filteredHistory.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '60px 20px', background: 'white', borderRadius: 20, border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: 48, marginBottom: 12 }}>💼</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#1e293b', marginBottom: 6 }}>No completed jobs yet.</div>
                  <div style={{ fontSize: 14, color: '#64748b' }}>Completed jobs appear here once done and reviewed.</div>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))', gap: 16 }}>
                  {filteredHistory.map(job => renderHistoryCard(job))}
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Modals */}
      {viewingJob && (
        <JobCompletionSummary job={viewingJob} userId={userId} onClose={() => setViewingJob(null)} onPhotoClick={openGallery} />
      )}
      {showGallery && (
        <PhotoGallery photos={galleryPhotos} startIndex={galleryIndex} onClose={() => setShowGallery(false)} />
      )}
    </div>
  );
}

export default WorkHistory;
