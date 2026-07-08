import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { TrustStars, BehaviourBadges } from './TrustCenter';
import useBodyScrollLock from '../shared/useBodyScrollLock';
import useHardwareBackClose from '../shared/useHardwareBackClose';

const API_URL = process.env.REACT_APP_API_URL || '';

// Full profile sheet: identity + community trust, verified past work (photos
// taken through the app on completed jobs), experience, skills and reviews.
// Rendered ABOVE every job modal (z 10060 > modalOverlayStyle 10040) so
// "View Profile" works from inside the applicants/apply/details modals.
function ProviderPortfolio({ providerId, providerName, onClose }) {
  useBodyScrollLock();
  const [provider, setProvider] = useState(null);
  const [trust, setTrust] = useState(null);
  const [verifiedWork, setVerifiedWork] = useState([]);
  const [loading, setLoading] = useState(true);
  // Photo viewer: { photos: [url, ...], index } so the user can swipe/step
  // through all photos of a work item instead of being stuck on one.
  const [photoView, setPhotoView] = useState(null);
  const touchStartX = React.useRef(null);
  useHardwareBackClose(!!photoView, () => setPhotoView(null));

  const stepPhoto = (dir) => {
    setPhotoView(pv => {
      if (!pv) return pv;
      const next = (pv.index + dir + pv.photos.length) % pv.photos.length;
      return { ...pv, index: next };
    });
  };

  useEffect(() => {
    let cancelled = false;
    const token = localStorage.getItem('token');
    const load = async () => {
      try {
        const [userRes, trustRes, workRes] = await Promise.all([
          axios.get(`${API_URL}/api/users/${providerId}`),
          axios.get(`${API_URL}/api/users/${providerId}/trust`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }).catch(() => null),
          axios.get(`${API_URL}/api/users/${providerId}/verified-work`).catch(() => null),
        ]);
        if (cancelled) return;
        setProvider(userRes.data);
        setTrust(trustRes?.data || null);
        setVerifiedWork(workRes?.data?.work || []);
      } catch (err) {
        console.error('Error fetching provider profile:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [providerId]);

  const stats = provider?.communityStats || {};
  const imgUrl = (u) => (u && u.startsWith('http') ? u : `${API_URL}${u}`);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 10060, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#f1f5f9', width: '100%', maxWidth: 560,
          height: window.innerWidth < 640 ? '94dvh' : '88vh',
          borderRadius: '24px 24px 0 0', display: 'flex', flexDirection: 'column', overflow: 'hidden'
        }}
      >
        {/* Header */}
        <div style={{ background: 'white', borderBottom: '1px solid #e2e8f0', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <button onClick={onClose} aria-label="Back" style={{ width: 40, height: 40, borderRadius: '50%', border: '1px solid #e2e8f0', background: 'white', color: '#1e293b', fontSize: 20, fontWeight: 700, cursor: 'pointer', flexShrink: 0, lineHeight: 1 }}>←</button>
          <div style={{
            width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
            background: provider?.profileImage ? `url(${imgUrl(provider.profileImage)}) center/cover` : 'linear-gradient(135deg, #6366f1, #4f46e5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, color: 'white', fontWeight: 700
          }}>
            {!provider?.profileImage && ((provider?.name || providerName || '?').charAt(0).toUpperCase())}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {provider?.name || providerName || 'Profile'}
              {provider?.verified && <span style={{ marginLeft: 6, fontSize: 12, color: '#059669', fontWeight: 800 }}>✓ Verified</span>}
            </div>
            <div style={{ fontSize: 11, color: '#64748b' }}>Profile & verified past work</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ width: 40, height: 40, borderRadius: '50%', border: '1px solid #e2e8f0', background: 'white', color: '#64748b', fontSize: 18, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 16, WebkitOverflowScrolling: 'touch' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
              Loading profile...
            </div>
          ) : !provider ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>Profile not found</div>
          ) : (
            <>
              {/* Trust */}
              {trust && (
                <div style={{ background: 'white', borderRadius: 16, padding: 14, marginBottom: 12, border: '1px solid #e2e8f0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b' }}>Identity</span>
                    <TrustStars stars={trust.stars} size={16} max={5} />
                    {trust.level && <span style={{ fontSize: 12, fontWeight: 700, color: '#b45309' }}>{trust.level}</span>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b' }}>Community</span>
                    {trust.community?.stars != null ? (
                      <>
                        <TrustStars stars={trust.community.stars} size={16} max={5} />
                        <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700 }}>{trust.community.reviews} review{trust.community.reviews === 1 ? '' : 's'}</span>
                      </>
                    ) : (
                      <span style={{ fontSize: 11, color: '#94a3b8' }}>No ratings yet</span>
                    )}
                    <BehaviourBadges flags={trust.community?.flags} />
                  </div>
                  {trust.totalStars != null && (
                    <div style={{ fontSize: 12, fontWeight: 800, color: '#4f46e5', marginTop: 6 }}>Total trust: {trust.totalStars} / 10</div>
                  )}
                  {(trust.community?.flags?.flagged || trust.community?.flags?.frequentComplainer) && (
                    <div style={{ marginTop: 8, fontSize: 11, color: '#9a3412', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, padding: '8px 10px', lineHeight: 1.4 }}>
                      ⚖️ Flags come from recorded platform activity (issue reports, cancellations). They clear automatically — "redeemed" — when the user completes jobs with 4★+ ratings and no new issues.
                    </div>
                  )}
                  {trust.community?.flags?.redeemed && !trust.community?.flags?.flagged && (
                    <div style={{ marginTop: 8, fontSize: 11, color: '#166534', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '8px 10px', lineHeight: 1.4 }}>
                      ✅ Past flags were cleared through good completed work.
                    </div>
                  )}
                </div>
              )}

              {/* Stats */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                {[
                  [stats.receivedRatingsAvg > 0 ? stats.receivedRatingsAvg.toFixed(1) : '—', 'Rating'],
                  [`${stats.reliabilityScore ?? 100}%`, 'Reliability'],
                  [stats.jobsCompleted || 0, 'Jobs Done'],
                ].map(([val, lbl]) => (
                  <div key={lbl} style={{ flex: 1, background: 'white', borderRadius: 14, padding: '12px 8px', textAlign: 'center', border: '1px solid #e2e8f0' }}>
                    <div style={{ fontSize: 20, fontWeight: 800, color: '#4f46e5' }}>{val}</div>
                    <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700 }}>{lbl}</div>
                  </div>
                ))}
              </div>

              {/* Bio */}
              {provider.bio && (
                <div style={{ background: 'white', borderRadius: 16, padding: 14, marginBottom: 12, border: '1px solid #e2e8f0', fontSize: 13, color: '#475569', lineHeight: 1.5 }}>
                  {provider.bio}
                </div>
              )}

              {/* Verified past work — photos taken through the app on completed jobs */}
              <div style={{ background: 'white', borderRadius: 16, padding: 14, marginBottom: 12, border: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#1e293b' }}>🛠 Past Work</div>
                  <span style={{ background: '#d1fae5', color: '#065f46', padding: '3px 10px', borderRadius: 12, fontSize: 10, fontWeight: 800 }}>✓ Verified by Sebenza</span>
                </div>
                <p style={{ fontSize: 11, color: '#94a3b8', margin: '0 0 10px' }}>Real jobs completed through the app — photos taken on site with the in-app camera.</p>
                {verifiedWork.length === 0 ? (
                  <div style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', padding: '14px 0' }}>No completed jobs yet — every finished job builds this record.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {verifiedWork.map(w => (
                      <div key={w.jobId} style={{ padding: '10px 12px', borderRadius: 12, background: '#f8fafc', border: '1px solid #f1f5f9' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 700, fontSize: 13, color: '#1e293b' }}>{w.title}</div>
                            <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                              {[w.category, w.completedAt && new Date(w.completedAt).toLocaleDateString()].filter(Boolean).join(' · ')}
                            </div>
                          </div>
                          {w.rating && <span style={{ fontSize: 11, color: '#f59e0b', fontWeight: 700, whiteSpace: 'nowrap' }}>{'⭐'.repeat(w.rating)}</span>}
                        </div>
                        {w.photos?.length > 0 && (
                          <div style={{ display: 'flex', gap: 6, marginTop: 8, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                            {w.photos.map((p, i) => (
                              <img key={i} src={imgUrl(p.url)} alt={`${w.title} — on-site photo`}
                                onClick={() => setPhotoView({ photos: w.photos.map(ph => imgUrl(ph.url)), index: i })}
                                style={{ width: 68, height: 68, objectFit: 'cover', borderRadius: 10, flexShrink: 0, cursor: 'pointer', border: '1px solid #e2e8f0' }} />
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Work experience */}
              {provider.workExperience?.length > 0 && (
                <div style={{ background: 'white', borderRadius: 16, padding: 14, marginBottom: 12, border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#1e293b', marginBottom: 8 }}>💼 Work Experience</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {provider.workExperience.map((w, i) => (
                      <div key={i} style={{ padding: '10px 12px', borderRadius: 10, background: '#f8fafc', border: '1px solid #f1f5f9' }}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: '#1e293b' }}>{w.title}</div>
                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{[w.place, w.years].filter(Boolean).join(' · ')}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Skills */}
              {provider.skills?.length > 0 && (
                <div style={{ background: 'white', borderRadius: 16, padding: 14, marginBottom: 12, border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#1e293b', marginBottom: 8 }}>Skills</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {provider.skills.map(skill => (
                      <span key={skill} style={{ background: '#f3f4f6', color: '#374151', padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600 }}>{skill}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Reviews */}
              {provider.reviews?.length > 0 && (
                <div style={{ background: 'white', borderRadius: 16, padding: 14, marginBottom: 12, border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#1e293b', marginBottom: 8 }}>⭐ Community Feedback ({provider.reviews.length})</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {provider.reviews.slice(0, 10).map((r, i) => (
                      <div key={r._id || i} style={{ padding: '10px 12px', borderRadius: 10, background: '#f8fafc', borderLeft: '3px solid #6366f1' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: '#374151' }}>{r.reviewerId?.name || 'Neighbour'}</span>
                          <span style={{ fontSize: 11, color: '#f59e0b', fontWeight: 700 }}>{'⭐'.repeat(r.overallRating || 0)}</span>
                        </div>
                        {r.comment && <div style={{ fontSize: 12, color: '#475569', fontStyle: 'italic', marginTop: 4 }}>"{r.comment}"</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Full-screen photo viewer — swipe or use ‹ › to move between photos */}
      {photoView && (
        <div
          onClick={(e) => { e.stopPropagation(); setPhotoView(null); }}
          onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX; }}
          onTouchEnd={(e) => {
            if (touchStartX.current == null) return;
            const dx = e.changedTouches[0].clientX - touchStartX.current;
            touchStartX.current = null;
            if (Math.abs(dx) > 40) { stepPhoto(dx < 0 ? 1 : -1); }
          }}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', zIndex: 10061,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16
          }}
        >
          <button onClick={(e) => { e.stopPropagation(); setPhotoView(null); }} aria-label="Back" style={{
            position: 'absolute', top: 'calc(env(safe-area-inset-top, 0px) + 14px)', left: 14,
            width: 44, height: 44, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,0.15)',
            color: 'white', fontSize: 22, fontWeight: 700, cursor: 'pointer', zIndex: 2
          }}>←</button>
          {photoView.photos.length > 1 && (
            <>
              <button onClick={(e) => { e.stopPropagation(); stepPhoto(-1); }} aria-label="Previous photo" style={{
                position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)',
                width: 44, height: 44, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,0.15)',
                color: 'white', fontSize: 24, fontWeight: 700, cursor: 'pointer', zIndex: 2
              }}>‹</button>
              <button onClick={(e) => { e.stopPropagation(); stepPhoto(1); }} aria-label="Next photo" style={{
                position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                width: 44, height: 44, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,0.15)',
                color: 'white', fontSize: 24, fontWeight: 700, cursor: 'pointer', zIndex: 2
              }}>›</button>
              <div style={{
                position: 'absolute', bottom: 'calc(env(safe-area-inset-bottom, 0px) + 18px)', left: '50%', transform: 'translateX(-50%)',
                color: 'white', fontSize: 13, fontWeight: 700, background: 'rgba(0,0,0,0.5)', borderRadius: 999, padding: '5px 14px'
              }}>{photoView.index + 1} / {photoView.photos.length}</div>
            </>
          )}
          <img
            src={photoView.photos[photoView.index]}
            alt="Work"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '100%', maxHeight: '86vh', borderRadius: 12 }}
          />
        </div>
      )}
    </div>
  );
}

export default ProviderPortfolio;
