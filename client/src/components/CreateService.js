import React, { useState } from 'react';
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || '';

function CreateService({ user, onServiceCreated }) {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    category: 'House Cleaning',
    pricingType: 'fixed',
    randAmount: ''
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const categories = [
    'House Cleaning', 'Car Wash', 'Dog Walking', 'Laundry',
    'Braai / BBQ', 'Haircut', 'Errands', 'Yard Work',
    'Moving Help', 'Pet Wash', 'Furniture Assembly', 'Shoe Cleaning'
  ];

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');
    try {
      const token = localStorage.getItem('token');
      await axios.post(`${API_URL}/api/services`, formData, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setMessage('Service created successfully!');
      setFormData({ title: '', description: '', category: 'House Cleaning', pricingType: 'fixed', randAmount: '' });
      if (onServiceCreated) onServiceCreated();
    } catch (err) {
      setMessage('Failed to create service. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '20px', maxWidth: 600, margin: '0 auto' }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 24, color: '#1e293b' }}>
        Create Service
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
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#1e293b', marginBottom: 6 }}>Title</label>
            <input
              type="text"
              value={formData.title}
              onChange={e => setFormData({...formData, title: e.target.value})}
              placeholder="e.g., House Cleaning Service"
              required
              style={{ width: '100%', padding: 12, borderRadius: 12, border: '2px solid #e2e8f0', fontSize: 14, outline: 'none' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#1e293b', marginBottom: 6 }}>Description</label>
            <textarea
              value={formData.description}
              onChange={e => setFormData({...formData, description: e.target.value})}
              placeholder="Describe what you offer..."
              rows={3}
              required
              style={{ width: '100%', padding: 12, borderRadius: 12, border: '2px solid #e2e8f0', fontSize: 14, outline: 'none', resize: 'vertical' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#1e293b', marginBottom: 6 }}>Category</label>
            <select
              value={formData.category}
              onChange={e => setFormData({...formData, category: e.target.value})}
              style={{ width: '100%', padding: 12, borderRadius: 12, border: '2px solid #e2e8f0', fontSize: 14, outline: 'none' }}
            >
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#1e293b', marginBottom: 6 }}>Price (R)</label>
            <input
              type="number"
              value={formData.randAmount}
              onChange={e => setFormData({...formData, randAmount: e.target.value})}
              placeholder="e.g., 150"
              required
              style={{ width: '100%', padding: 12, borderRadius: 12, border: '2px solid #e2e8f0', fontSize: 14, outline: 'none' }}
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
            {loading ? 'Creating...' : 'Create Service'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default CreateService;
