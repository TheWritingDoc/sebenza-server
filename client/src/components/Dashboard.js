import React from 'react';
import { useNavigate } from 'react-router-dom';

function Dashboard({ user }) {
  const navigate = useNavigate();

  return (
    <div style={{ padding: '20px', maxWidth: 900, margin: '0 auto' }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 16, color: '#1e293b' }}>
        Welcome back, {user?.name || 'Neighbour'}!
      </h1>
      <p style={{ fontSize: 14, color: '#64748b', marginBottom: 24 }}>
        Here's what's happening in your community.
      </p>
      
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
          <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
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
          <div style={{ fontSize: 32, marginBottom: 12 }}>✏️</div>
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
          <div style={{ fontSize: 32, marginBottom: 12 }}>💼</div>
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
          <div style={{ fontSize: 32, marginBottom: 12 }}>👤</div>
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
          <div style={{ fontSize: 32, marginBottom: 12 }}>👥</div>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4, color: '#1e293b' }}>Your Team</h3>
          <p style={{ fontSize: 13, color: '#64748b' }}>Work as a crew under one supervisor</p>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
