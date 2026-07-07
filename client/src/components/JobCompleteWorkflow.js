import React, { useState } from 'react';
import axios from 'axios';
import PhotoUploadFlow from './PhotoUploadFlow';

const API_URL = process.env.REACT_APP_API_URL || '';

function getCurrentLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  });
}

function JobCompleteWorkflow({ job, onClose, onCompleted }) {
  const [photos, setPhotos] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleComplete = async () => {
    if (photos.length === 0) {
      setError('Please take at least one photo of the finished work as proof.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const token = localStorage.getItem('token');
      const loc = await getCurrentLocation();
      const formData = new FormData();
      photos.forEach(p => formData.append('photos', p.file || p));
      if (loc) {
        formData.append('lat', String(loc.lat));
        formData.append('lng', String(loc.lng));
      }
      await axios.post(`${API_URL}/api/jobs/${job._id || job.id}/complete`, formData, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'multipart/form-data' }
      });
      if (onCompleted) await onCompleted();
      if (onClose) onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to submit completion. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000, padding: 20 }}>
      <div style={{ background: 'white', borderRadius: 20, padding: 24, maxWidth: 400, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ fontSize: 18, fontWeight: 800, marginBottom: 4, color: '#1e293b' }}>Complete Job</h3>
        <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>{job?.title}</p>

        <div style={{ background: '#dbeafe', borderRadius: 14, padding: 12, marginBottom: 16, border: '1px solid #93c5fd' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#1d4ed8', marginBottom: 4 }}>📸 Proof of Work Required</div>
          <div style={{ fontSize: 12, color: '#1e40af' }}>Take photos of the finished work. The poster will inspect them before confirming.</div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#1e293b', marginBottom: 6 }}>After Photos *</label>
          <PhotoUploadFlow label="Take After Photos" onChange={setPhotos} />
        </div>

        {error && (
          <div style={{ background: '#fef2f2', color: '#991b1b', padding: 10, borderRadius: 12, marginBottom: 12, fontSize: 12, fontWeight: 600 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={handleComplete}
            disabled={submitting || photos.length === 0}
            style={{ flex: 1, padding: 12, borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, #22c55e, #16a34a)', color: 'white', fontWeight: 700, cursor: (submitting || photos.length === 0) ? 'not-allowed' : 'pointer', opacity: (submitting || photos.length === 0) ? 0.6 : 1 }}
          >
            {submitting ? 'Submitting…' : 'Yes, Complete'}
          </button>
          <button
            onClick={onClose}
            disabled={submitting}
            style={{ padding: '12px 20px', borderRadius: 12, border: 'none', background: '#f1f5f9', color: '#475569', fontWeight: 700, cursor: 'pointer' }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export default JobCompleteWorkflow;
