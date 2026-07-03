import React from 'react';
import { useNavigate } from 'react-router-dom';

function MapView({ user, onViewPortfolio }) {
  const navigate = useNavigate();

  return (
    <div style={{ padding: '20px', maxWidth: 900, margin: '0 auto' }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 16, color: '#1e293b' }}>
        Map View
      </h1>
      <p style={{ fontSize: 14, color: '#64748b', marginBottom: 24 }}>
        Find jobs and services near you on the map.
      </p>
      
      <div style={{ 
        background: 'white', borderRadius: 20, padding: 40, 
        border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        textAlign: 'center'
      }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🗺️</div>
        <h3 style={{ fontSize: 18, fontWeight: 700, color: '#1e293b', marginBottom: 8 }}>
          Map Coming Soon
        </h3>
        <p style={{ fontSize: 14, color: '#64748b', marginBottom: 20, maxWidth: 400, margin: '0 auto 20px' }}>
          We're working on an interactive map to help you find jobs and services nearby. 
          In the meantime, browse the job board!
        </p>
        <button 
          onClick={() => navigate('/jobs')}
          style={{
            padding: '14px 28px', borderRadius: 14, border: 'none',
            background: 'linear-gradient(135deg, #6366f1, #4f46e5)', color: 'white',
            fontSize: 14, fontWeight: 700, cursor: 'pointer'
          }}
        >
          Browse Job Board
        </button>
      </div>
    </div>
  );
}

export default MapView;
