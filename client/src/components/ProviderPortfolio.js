import React, { useState, useEffect } from 'react';
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || '';

function ProviderPortfolio({ providerId, providerName, onClose }) {
  const [provider, setProvider] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProvider = async () => {
      try {
        const res = await axios.get(`${API_URL}/api/users/${providerId}`);
        setProvider(res.data);
      } catch (err) {
        console.error('Error fetching provider:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchProvider();
  }, [providerId]);

  if (loading) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 }}>
        <div style={{ background: 'white', borderRadius: 20, padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 16 }}>⏳</div>
          <p>Loading profile...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000, padding: 20 }}>
      <div style={{ background: 'white', borderRadius: 20, padding: 24, maxWidth: 500, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: '#1e293b' }}>{provider?.name || providerName || 'Provider'}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: '#64748b' }}>✕</button>
        </div>

        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{
            width: 80, height: 80, borderRadius: '50%', margin: '0 auto 12px',
            background: provider?.profileImage ? `url(${API_URL}${provider.profileImage}) center/cover` : 'linear-gradient(135deg, #6366f1, #4f46e5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 32, color: 'white', fontWeight: 700
          }}>
            {!provider?.profileImage && (provider?.name?.charAt(0).toUpperCase() || '?')}
          </div>
          <p style={{ fontSize: 14, color: '#64748b' }}>{provider?.bio || 'No bio yet'}</p>
        </div>

        {provider?.services && provider.services.length > 0 && (
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12, color: '#1e293b' }}>Services</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {provider.services.map(service => (
                <div key={service._id} style={{ padding: 14, borderRadius: 12, border: '1px solid #e2e8f0', background: '#f8fafc' }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{service.title}</div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{service.description}</div>
                  <div style={{ fontSize: 12, color: '#6366f1', fontWeight: 700, marginTop: 6 }}>R{service.randAmount || 0}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ProviderPortfolio;
