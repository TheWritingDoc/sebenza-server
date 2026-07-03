import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useParams, useNavigate } from 'react-router-dom';
import { TrustStars } from './TrustCenter';

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

  useEffect(() => {
    fetchProfile();
  }, [id]);

  const fetchProfile = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/users/${id}`);
      setProfile(res.data);
      try {
        const trustRes = await axios.get(`${API_URL}/api/users/${id}/trust`);
        setTrust(trustRes.data);
      } catch { setTrust(null); }
    } catch (err) {
      console.error('Fetch profile error:', err);
    }
    setLoading(false);
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

        {/* Trust stars */}
        {trust && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 8 }}>
            <TrustStars stars={trust.stars} size={18} />
            <span style={{ fontSize: 12, fontWeight: 700, color: '#b45309' }}>{trust.level}</span>
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
          }}>✓ Verified</span>
        )}
      </div>

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
