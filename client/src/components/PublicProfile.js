import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useParams, useNavigate } from 'react-router-dom';
import { TrustStars, BehaviourBadges } from './TrustCenter';
import { Briefcase, Wrench, ThumbsUp, CheckCircle2 } from './Icons';

const API_URL = process.env.REACT_APP_API_URL || '';

const ACCOUNT_BADGES = {
  team: { label: 'Small Team', icon: '👥', bg: '#eff6ff', color: '#1d4ed8' },
  business: { label: 'Business', icon: '🏢', bg: '#f5f3ff', color: '#6d28d9' },
};

function PublicProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [trust, setTrust] = useState(null);
  const [loading, setLoading] = useState(true);
  const [rec, setRec] = useState({ count: 0, endorsed: false });
  const [endorsing, setEndorsing] = useState(false);
  const [verifiedWork, setVerifiedWork] = useState([]);
  const [photoView, setPhotoView] = useState(null);
  const token = localStorage.getItem('token');

  useEffect(() => {
    fetchProfile();
  }, [id]);

  const fetchProfile = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/users/${id}`);
      setProfile(res.data);
      try {
        const trustRes = await axios.get(`${API_URL}/api/users/${id}/trust`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        setTrust(trustRes.data);
        setRec({ count: trustRes.data.recommendations || 0, endorsed: !!trustRes.data.viewerEndorsed });
      } catch { setTrust(null); }
      try {
        const workRes = await axios.get(`${API_URL}/api/users/${id}/verified-work`);
        setVerifiedWork(workRes.data.work || []);
      } catch { setVerifiedWork([]); }
    } catch (err) {
      console.error('Fetch profile error:', err);
    }
    setLoading(false);
  };

  const toggleEndorse = async () => {
    if (!token) { navigate('/login'); return; }
    setEndorsing(true);
    try {
      const res = await axios.post(`${API_URL}/api/users/${id}/endorse`, {}, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setRec({ count: res.data.count, endorsed: res.data.endorsed });
    } catch (err) {
      console.error('Endorse failed:', err);
    }
    setEndorsing(false);
  };

  const statusColors = { online: '#22c55e', away: '#f59e0b', offline: '#9ca3af' };
  const stats = profile?.communityStats || {};
  const reliabilityColor = stats.reliabilityScore >= 80 ? '#22c55e' : stats.reliabilityScore >= 50 ? '#f59e0b' : '#ef4444';

  if (loading) return <div style={{ textAlign: 'center', padding: 40 }}>Loading profile...</div>;
  if (!profile) return <div style={{ textAlign: 'center', padding: 40 }}>Profile not found</div>;

  return (
    <div style={{ padding: '16px', maxWidth: '600px', margin: '0 auto', paddingBottom: '100px' }}>
      <button onClick={() => navigate(-1)} style={{
        background: 'none', border: 'none', color: '#6366f1', fontSize: '14px',
        fontWeight: 600, cursor: 'pointer', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '4px'
      }}>← Back</button>

      <div style={{ background: 'white', borderRadius: '16px', padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', textAlign: 'center' }}>
        <div style={{
          width: '100px', height: '100px', borderRadius: '50%', margin: '0 auto 16px',
          background: profile.profileImage
            ? `url(${API_URL}${profile.profileImage}) center/cover`
            : 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '40px', color: 'white', fontWeight: 600,
          border: '4px solid #e5e7eb', position: 'relative'
        }}>
          {!profile.profileImage && profile.name?.charAt(0).toUpperCase()}
          <div style={{
            position: 'absolute', bottom: '4px', right: '4px',
            width: '20px', height: '20px', borderRadius: '50%',
            background: statusColors[profile.status || 'offline'],
            border: '3px solid white'
          }} />
        </div>

        <h2 style={{ margin: '0 0 4px', fontSize: '22px' }}>{profile.name}</h2>

        {/* Team / Business badge */}
        {trust && ACCOUNT_BADGES[trust.accountType] && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 8,
            background: ACCOUNT_BADGES[trust.accountType].bg, color: ACCOUNT_BADGES[trust.accountType].color,
            padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700,
          }}>
            <span>{ACCOUNT_BADGES[trust.accountType].icon}</span>
            {trust.businessName || ACCOUNT_BADGES[trust.accountType].label}
          </div>
        )}

        {/* Trust stars: identity (KYC) + community (job feedback) = /10 */}
        {trust && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b' }}>Identity</span>
              <TrustStars stars={trust.stars} size={16} max={5} />
              <span style={{ fontSize: 12, fontWeight: 700, color: '#b45309' }}>{trust.level}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 3, flexWrap: 'wrap' }}>
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
              <div style={{ fontSize: 12, fontWeight: 800, color: '#4f46e5', marginTop: 4 }}>
                Total trust: {trust.totalStars} / 10
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', marginBottom: '12px' }}>
          <span style={{
            width: '8px', height: '8px', borderRadius: '50%',
            background: statusColors[profile.status || 'offline']
          }} />
          <span style={{ fontSize: '14px', color: '#666', textTransform: 'capitalize' }}>{profile.status || 'offline'}</span>
        </div>

        {/* Community Stats */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', marginBottom: '16px', flexWrap: 'wrap' }}>
          <div style={{ textAlign: 'center', minWidth: 70 }}>
            <div style={{ fontSize: '24px', fontWeight: 700, color: stats.receivedRatingsAvg > 0 ? '#4f46e5' : '#9ca3af' }}>
              {stats.receivedRatingsAvg > 0 ? stats.receivedRatingsAvg.toFixed(1) : '—'}
            </div>
            <div style={{ fontSize: '11px', color: '#9ca3af' }}>Rating</div>
          </div>
          <div style={{ textAlign: 'center', minWidth: 70 }}>
            <div style={{ fontSize: '24px', fontWeight: 700, color: reliabilityColor }}>
              {stats.reliabilityScore ?? 100}%
            </div>
            <div style={{ fontSize: '11px', color: '#9ca3af' }}>Reliability</div>
          </div>
          <div style={{ textAlign: 'center', minWidth: 70 }}>
            <div style={{ fontSize: '24px', fontWeight: 700, color: '#4f46e5' }}>{stats.jobsCompleted || 0}</div>
            <div style={{ fontSize: '11px', color: '#9ca3af' }}>Jobs Done</div>
          </div>
          <div style={{ textAlign: 'center', minWidth: 70 }}>
            <div style={{ fontSize: '24px', fontWeight: 700, color: '#4f46e5' }}>{profile.services?.length || 0}</div>
            <div style={{ fontSize: '11px', color: '#9ca3af' }}>Services</div>
          </div>
        </div>

        {profile.verified && (
          <span style={{
            display: 'inline-block', background: '#d1fae5', color: '#065f46',
            padding: '4px 12px', borderRadius: '12px', fontSize: '12px', fontWeight: 600
          }}><CheckCircle2 size={12} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />Verified</span>
        )}

        {/* Recommend / endorse */}
        <div style={{ marginTop: 16 }}>
          <button onClick={toggleEndorse} disabled={endorsing} style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 44,
            padding: '10px 20px', borderRadius: 999, cursor: 'pointer', fontSize: 14, fontWeight: 700,
            border: rec.endorsed ? 'none' : '2px solid #e2e8f0',
            background: rec.endorsed ? 'linear-gradient(135deg,#22c55e,#16a34a)' : 'white',
            color: rec.endorsed ? 'white' : '#334155', transition: 'all 0.2s',
          }}>
            <ThumbsUp size={16} color="currentColor" style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />{rec.endorsed ? 'Recommended' : 'Recommend'}
            {rec.count > 0 && (
              <span style={{
                background: rec.endorsed ? 'rgba(255,255,255,0.25)' : '#f1f5f9',
                color: rec.endorsed ? 'white' : '#475569',
                borderRadius: 999, padding: '1px 8px', fontSize: 12, fontWeight: 800,
              }}>{rec.count}</span>
            )}
          </button>
          {rec.count > 0 && (
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>
              {rec.count} neighbour{rec.count === 1 ? '' : 's'} vouch for {profile.name?.split(' ')[0]}
            </div>
          )}
        </div>
      </div>

      {/* Verified work — only jobs completed and proven through the app */}
      {verifiedWork.length > 0 && (
        <div style={{ background: 'white', borderRadius: '16px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', marginTop: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}><Wrench size={16} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />Verified Work</h3>
            <span style={{ background: '#d1fae5', color: '#065f46', padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700 }}>
              ✓ Verified by Sebenza
            </span>
          </div>
          <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 12px' }}>
            Real jobs completed through the app, with photos taken on site.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {verifiedWork.map(w => (
              <div key={w.jobId} style={{ padding: '12px 14px', borderRadius: '12px', background: '#f8fafc', border: '1px solid #f1f5f9' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '14px', color: '#1e293b' }}>{w.title}</div>
                    <div style={{ fontSize: '12px', color: '#64748b', marginTop: 2 }}>
                      {[w.category, w.completedAt && new Date(w.completedAt).toLocaleDateString()].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  {w.rating && (
                    <span style={{ fontSize: 12, color: '#f59e0b', fontWeight: 700, whiteSpace: 'nowrap' }}>
                      {'⭐'.repeat(w.rating)}
                    </span>
                  )}
                </div>
                {w.photos?.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 10, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                    {w.photos.map((p, i) => (
                      <img key={i} src={p.url.startsWith('http') ? p.url : `${API_URL}${p.url}`} alt={`${w.title} — on-site photo`}
                        onClick={() => setPhotoView(p.url.startsWith('http') ? p.url : `${API_URL}${p.url}`)}
                        style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 10, flexShrink: 0, cursor: 'pointer', border: '1px solid #e2e8f0' }} />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Full-screen photo viewer */}
      {photoView && (
        <div onClick={() => setPhotoView(null)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, cursor: 'zoom-out'
        }}>
          <img src={photoView} alt="Work" style={{ maxWidth: '100%', maxHeight: '90vh', borderRadius: 12 }} />
        </div>
      )}

      {/* Work experience */}
      {profile.workExperience?.length > 0 && (
        <div style={{ background: 'white', borderRadius: '16px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', marginTop: '16px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '16px', fontWeight: 600 }}><Briefcase size={16} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />Work Experience</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {profile.workExperience.map((w, i) => (
              <div key={i} style={{ padding: '12px 14px', borderRadius: '10px', background: '#f8fafc', border: '1px solid #f1f5f9' }}>
                <div style={{ fontWeight: 600, fontSize: '14px', color: '#1e293b' }}>{w.title}</div>
                <div style={{ fontSize: '12px', color: '#64748b', marginTop: 2 }}>
                  {[w.place, w.years].filter(Boolean).join(' · ')}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Skills */}
      {profile.skills?.length > 0 && (
        <div style={{ background: 'white', borderRadius: '16px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', marginTop: '16px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '16px', fontWeight: 600 }}>Skills</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {profile.skills.map(skill => (
              <span key={skill} style={{
                background: '#f3f4f6', color: '#374151', padding: '6px 14px',
                borderRadius: '20px', fontSize: '13px', fontWeight: 500
              }}>{skill}</span>
            ))}
          </div>
        </div>
      )}

      {/* Services */}
      {profile.services?.length > 0 && (
        <div style={{ background: 'white', borderRadius: '16px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', marginTop: '16px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '16px', fontWeight: 600 }}>Services Offered</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {profile.services.map(s => (
              <div key={s._id} style={{
                padding: '14px', borderRadius: '10px', border: '1px solid #e5e7eb',
                display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start'
              }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '14px' }}>{s.title}</div>
                  <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>{s.description}</div>
                  <span style={{
                    display: 'inline-block', marginTop: '6px', background: '#eef2ff', color: '#4f46e5',
                    padding: '3px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 500
                  }}>{s.category}</span>
                  <div style={{ display: 'flex', gap: 10, marginTop: 6, fontSize: 12, color: '#64748b' }}>
                    <span>✅ {s.completedJobsCount || 0} done</span>
                    {s.averageRating > 0 && <span>⭐ {s.averageRating} ({s.totalReviews || 0} reviews)</span>}
                  </div>
                </div>
                <div style={{ fontWeight: 700, color: '#4f46e5', fontSize: '14px', whiteSpace: 'nowrap' }}>
                  {s.pricingType === 'quote' ? '📋 Quote' : `R${s.randAmount || 0}`}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reviews */}
      {profile.reviews?.length > 0 && (
        <div style={{ background: 'white', borderRadius: '16px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', marginTop: '16px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '16px', fontWeight: 600 }}>
            Community Feedback ({profile.reviews.length})
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {profile.reviews.map(r => (
              <div key={r._id} style={{
                padding: '14px', borderRadius: '12px', background: '#f8fafc',
                borderLeft: '3px solid #6366f1'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#374151' }}>
                    {r.reviewerId?.name || 'Anonymous'}
                  </div>
                  <div style={{ fontSize: '12px', color: '#f59e0b', fontWeight: 700 }}>
                    {'⭐'.repeat(r.overallRating)}
                  </div>
                </div>
                {r.comment && (
                  <div style={{ fontSize: '13px', color: '#475569', fontStyle: 'italic', marginBottom: 6 }}>
                    "{r.comment}"
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {r.categories && Object.entries(r.categories).map(([cat, val]) => (
                    <span key={cat} style={{
                      fontSize: '11px', background: val >= 4 ? '#dcfce7' : val >= 3 ? '#fef9c3' : '#fee2e2',
                      color: val >= 4 ? '#166534' : val >= 3 ? '#854d0e' : '#991b1b',
                      padding: '3px 8px', borderRadius: 10, fontWeight: 600
                    }}>
                      {cat.charAt(0).toUpperCase() + cat.slice(1)}: {val}
                    </span>
                  ))}
                </div>
                <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: 6 }}>
                  {r.serviceId?.title} • {new Date(r.createdAt).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default PublicProfile;
