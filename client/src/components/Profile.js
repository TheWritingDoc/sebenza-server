import React, { useState, useEffect } from 'react';
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || '';

function Profile({ user, setUser }) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [formData, setFormData] = useState({
    name: user?.name || '',
    email: user?.email || '',
    phone: user?.phone || '',
    bio: user?.bio || ''
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');
    try {
      const token = localStorage.getItem('token');
      const res = await axios.put(`${API_URL}/api/users/${user.id || user._id}`, formData, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setUser(res.data);
      setMessage('Profile updated successfully!');
    } catch (err) {
      setMessage('Failed to update profile. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '20px', maxWidth: 600, margin: '0 auto' }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 24, color: '#1e293b' }}>
        My Profile
      </h1>

      {message && (
        <div style={{ 
          background: message.includes('success') ? '#f0fdf4' : '#fef2f2', 
          color: message.includes('success') ? '#166534' : '#991b1b',
          padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 14, fontWeight: 600 
        }}>
          {message}
        </div>
      )}

      <div style={{ 
        background: 'white', borderRadius: 20, padding: 24, 
        border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' 
      }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{
            width: 80, height: 80, borderRadius: '50%', margin: '0 auto 12px',
            background: user?.profileImage ? `url(${API_URL}${user.profileImage}) center/cover` : 'linear-gradient(135deg, #6366f1, #4f46e5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 32, color: 'white', fontWeight: 700
          }}>
            {!user?.profileImage && (user?.name?.charAt(0).toUpperCase() || '?')}
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1e293b' }}>{user?.name || 'User'}</h2>
          <p style={{ fontSize: 13, color: '#64748b' }}>{user?.email}</p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#1e293b', marginBottom: 6 }}>Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={e => setFormData({...formData, name: e.target.value})}
              style={{ width: '100%', padding: 12, borderRadius: 12, border: '2px solid #e2e8f0', fontSize: 14, outline: 'none' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#1e293b', marginBottom: 6 }}>Email</label>
            <input
              type="email"
              value={formData.email}
              onChange={e => setFormData({...formData, email: e.target.value})}
              style={{ width: '100%', padding: 12, borderRadius: 12, border: '2px solid #e2e8f0', fontSize: 14, outline: 'none' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#1e293b', marginBottom: 6 }}>Phone</label>
            <input
              type="tel"
              value={formData.phone}
              onChange={e => setFormData({...formData, phone: e.target.value})}
              style={{ width: '100%', padding: 12, borderRadius: 12, border: '2px solid #e2e8f0', fontSize: 14, outline: 'none' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#1e293b', marginBottom: 6 }}>Bio</label>
            <textarea
              value={formData.bio}
              onChange={e => setFormData({...formData, bio: e.target.value})}
              rows={3}
              style={{ width: '100%', padding: 12, borderRadius: 12, border: '2px solid #e2e8f0', fontSize: 14, outline: 'none', resize: 'vertical' }}
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: 14, borderRadius: 14, border: 'none',
              background: 'linear-gradient(135deg, #6366f1, #4f46e5)', color: 'white',
              fontSize: 14, fontWeight: 700, cursor: 'pointer', marginTop: 8
            }}
          >
            {loading ? 'Saving...' : 'Save Changes'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default Profile;
