import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { IconBox, ClipboardList, Plus, Briefcase, UserCircle, Users, ShieldCheck, Star, ArrowRight } from './Icons';
import { TrustStars } from './TrustCenter';

const API_URL = process.env.REACT_APP_API_URL || '';

function Dashboard({ user }) {
  const navigate = useNavigate();
  const [trust, setTrust] = useState(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;
    axios.get(`${API_URL}/api/users/me/trust`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => setTrust(res.data))
      .catch(() => {});
  }, []);

  const photo = user?.profileImage
    ? (user.profileImage.startsWith('http') ? user.profileImage : `${API_URL}${user.profileImage}`)
    : null;
  const community = trust?.community;

  return (
    <div style={{ padding: '20px', maxWidth: 900, margin: '0 auto' }}>
      {/* Profile header card: photo, stars, level — the user's standing at a glance */}
      <div style={{
        background: 'linear-gradient(135deg, #4f46e5 0%, #6366f1 55%, #818cf8 100%)',
        borderRadius: 24, padding: '22px 24px', marginBottom: 20, color: 'white',
        display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap',
        boxShadow: '0 8px 24px rgba(79,70,229,0.25)'
      }}>
        <div style={{
          width: 72, height: 72, borderRadius: '50%', flexShrink: 0,
          background: photo ? `url(${photo}) center/cover` : 'rgba(255,255,255,0.2)',
          border: '3px solid rgba(255,255,255,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 28, fontWeight: 800
        }}>
          {!photo && (user?.name?.charAt(0).toUpperCase() || '?')}
        </div>

        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.2 }}>
            {user?.name || 'Neighbour'}
          </div>
          {trust ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                <ShieldCheck size={14} color="#c7d2fe" />
                <span style={{ fontSize: 12, color: '#e0e7ff', fontWeight: 600 }}>Identity</span>
                <TrustStars stars={trust.stars} size={14} max={5} />
                <span style={{ fontSize: 12, fontWeight: 700 }}>{trust.stars}/5</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3, flexWrap: 'wrap' }}>
                <Star size={14} color="#c7d2fe" />
                <span style={{ fontSize: 12, color: '#e0e7ff', fontWeight: 600 }}>Community</span>
                {community?.stars != null ? (
                  <>
                    <TrustStars stars={community.stars} size={14} max={5} />
                    <span style={{ fontSize: 12, fontWeight: 700 }}>{community.stars}/5 · {community.reviews} review{community.reviews === 1 ? '' : 's'}</span>
                  </>
                ) : (
                  <span style={{ fontSize: 12, color: '#e0e7ff' }}>No ratings yet — complete your first job</span>
                )}
              </div>
            </>
          ) : (
            <div style={{ fontSize: 13, color: '#e0e7ff', marginTop: 6 }}>Here's what's happening in your community.</div>
          )}
        </div>

        {trust && (
          <div style={{ textAlign: 'center', flexShrink: 0 }}>
            <div style={{ fontSize: 30, fontWeight: 900, lineHeight: 1 }}>{trust.totalStars}<span style={{ fontSize: 15, fontWeight: 700, opacity: 0.8 }}>/10</span></div>
            <div style={{ fontSize: 11, fontWeight: 700, background: 'rgba(255,255,255,0.2)', borderRadius: 999, padding: '3px 10px', marginTop: 6, display: 'inline-block' }}>{trust.level}</div>
            <div>
              <button onClick={() => navigate('/verification')} style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 8, cursor: 'pointer',
                background: 'white', color: '#4f46e5', border: 'none', borderRadius: 999,
                padding: '7px 14px', fontSize: 12, fontWeight: 800
              }}>
                Boost your stars <ArrowRight size={13} color="#4f46e5" />
              </button>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))' }}>
        <div 
          onClick={() => navigate('/jobs')}
          style={{ 
            background: 'white', 
            borderRadius: 20, 
            padding: 24, 
            cursor: 'pointer',
            border: '1px solid #f1f5f9',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            transition: 'all 0.2s'
          }}
          onMouseEnter={e => {
            e.currentTarget.style.transform = 'translateY(-4px)';
            e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.08)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.04)';
          }}
        >
          <IconBox size={52} bg="#eef2ff" style={{ marginBottom: 12 }}><ClipboardList size={26} color="#4f46e5" /></IconBox>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4, color: '#1e293b' }}>Browse Jobs</h3>
          <p style={{ fontSize: 13, color: '#64748b' }}>Find tasks nearby and offer to help</p>
        </div>

        <div 
          onClick={() => navigate('/jobs?post=1')}
          style={{ 
            background: 'white', 
            borderRadius: 20, 
            padding: 24, 
            cursor: 'pointer',
            border: '1px solid #f1f5f9',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            transition: 'all 0.2s'
          }}
          onMouseEnter={e => {
            e.currentTarget.style.transform = 'translateY(-4px)';
            e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.08)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.04)';
          }}
        >
          <IconBox size={52} bg="#eef2ff" style={{ marginBottom: 12 }}><Plus size={26} color="#4f46e5" /></IconBox>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4, color: '#1e293b' }}>Post a Job</h3>
          <p style={{ fontSize: 13, color: '#64748b' }}>Need help? Post a task in 30 seconds</p>
        </div>

        <div 
          onClick={() => navigate('/work')}
          style={{ 
            background: 'white', 
            borderRadius: 20, 
            padding: 24, 
            cursor: 'pointer',
            border: '1px solid #f1f5f9',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            transition: 'all 0.2s'
          }}
          onMouseEnter={e => {
            e.currentTarget.style.transform = 'translateY(-4px)';
            e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.08)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.04)';
          }}
        >
          <IconBox size={52} bg="#eef2ff" style={{ marginBottom: 12 }}><Briefcase size={26} color="#4f46e5" /></IconBox>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4, color: '#1e293b' }}>My Work</h3>
          <p style={{ fontSize: 13, color: '#64748b' }}>View your job history and active tasks</p>
        </div>

        <div 
          onClick={() => navigate('/profile')}
          style={{ 
            background: 'white', 
            borderRadius: 20, 
            padding: 24, 
            cursor: 'pointer',
            border: '1px solid #f1f5f9',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            transition: 'all 0.2s'
          }}
          onMouseEnter={e => {
            e.currentTarget.style.transform = 'translateY(-4px)';
            e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.08)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.04)';
          }}
        >
          <IconBox size={52} bg="#eef2ff" style={{ marginBottom: 12 }}><UserCircle size={26} color="#4f46e5" /></IconBox>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4, color: '#1e293b' }}>My Profile</h3>
          <p style={{ fontSize: 13, color: '#64748b' }}>Manage your account and settings</p>
        </div>

        <div
          onClick={() => navigate('/team')}
          style={{
            background: 'white',
            borderRadius: 20,
            padding: 24,
            cursor: 'pointer',
            border: '1px solid #f1f5f9',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            transition: 'all 0.2s'
          }}
          onMouseEnter={e => {
            e.currentTarget.style.transform = 'translateY(-4px)';
            e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.08)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.04)';
          }}
        >
          <IconBox size={52} bg="#eef2ff" style={{ marginBottom: 12 }}><Users size={26} color="#4f46e5" /></IconBox>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4, color: '#1e293b' }}>Your Team</h3>
          <p style={{ fontSize: 13, color: '#64748b' }}>Work as a crew under one supervisor</p>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
