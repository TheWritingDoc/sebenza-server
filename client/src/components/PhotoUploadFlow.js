import React, { useState, useCallback, useEffect, useRef } from 'react';
import CameraCapture from './CameraCapture';

export function appendPhotosWithGeo(formData, files, options = {}) {
  const prefix = options.prefix || 'photos';
  const metadataKey = options.metadataKey || `${prefix}Metadata`;
  const metadata = [];

  files.forEach((file, idx) => {
    const key = Array.isArray(files) ? `${prefix}[${idx}]` : prefix;
    formData.append(key, file);
    metadata.push({
      capturedAt: file.geoMetadata?.capturedAt || new Date().toISOString(),
      latitude: file.geoMetadata?.latitude ?? null,
      longitude: file.geoMetadata?.longitude ?? null,
      accuracy: file.geoMetadata?.accuracy ?? null,
      altitude: file.geoMetadata?.altitude ?? null,
    });
  });

  formData.append(metadataKey, JSON.stringify(metadata));
  return formData;
}

// allowGallery defaults to FALSE: every place this component is used captures
// before/issue/after PROOF photos, which must come from the live in-app camera
// and be geo-tagged. Opening the gallery would let users submit old or fake
// photos as work evidence, so the gallery path is off unless explicitly enabled.
function PhotoUploadFlow({ maxPhotos = 5, label = 'Take Photos', disabled = false, onChange, includeGeo = true, allowGallery = false }) {
  const [photos, setPhotos] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [cameraOpen, setCameraOpen] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    const newPreviews = photos.map(file =>
      typeof file === 'string' ? file : URL.createObjectURL(file)
    );
    setPreviews(newPreviews);
    return () => {
      newPreviews.forEach(url => {
        if (url.startsWith('blob:')) URL.revokeObjectURL(url);
      });
    };
  }, [photos]);

  const handleCapture = useCallback((files) => {
    const incoming = Array.isArray(files) ? files : [files];
    if (incoming.length + photos.length > maxPhotos) return;
    const newPhotos = [...photos, ...incoming].slice(0, maxPhotos);
    setPhotos(newPhotos);
    setCameraOpen(false);
    if (onChange) onChange(newPhotos);
  }, [photos, maxPhotos, onChange]);

  const handleFileSelect = useCallback((e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    if (files.length + photos.length > maxPhotos) return;
    const newPhotos = [...photos, ...files].slice(0, maxPhotos);
    setPhotos(newPhotos);
    if (onChange) onChange(newPhotos);
    e.target.value = '';
  }, [photos, maxPhotos, onChange]);

  const removePhoto = useCallback((idx) => {
    const newPhotos = photos.filter((_, i) => i !== idx);
    if (previews[idx]?.startsWith('blob:')) {
      URL.revokeObjectURL(previews[idx]);
    }
    setPhotos(newPhotos);
    setPreviews(prev => prev.filter((_, i) => i !== idx));
    if (onChange) onChange(newPhotos);
  }, [photos, previews, onChange]);

  const canAddMore = !disabled && photos.length < maxPhotos;

  return (
    <div>
      {allowGallery && (
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />
      )}
      <button
        type="button"
        onClick={() => canAddMore && setCameraOpen(true)}
        disabled={!canAddMore}
        style={{
          width: '100%',
          padding: '14px 16px',
          minHeight: 48,
          borderRadius: 12,
          border: '1px dashed #94a3b8',
          background: canAddMore ? '#f8fafc' : '#f1f5f9',
          color: canAddMore ? '#334155' : '#94a3b8',
          fontSize: 15,
          fontWeight: 700,
          cursor: canAddMore ? 'pointer' : 'not-allowed',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8
        }}
      >
        📷 {label} ({photos.length}/{maxPhotos})
      </button>
      {!allowGallery && (
        <p style={{ margin: '6px 2px 0', fontSize: 11, color: '#94a3b8', textAlign: 'center' }}>
          🔒 Live camera only · location-tagged for proof
        </p>
      )}
      {allowGallery && (
        <button
          type="button"
          onClick={() => canAddMore && fileInputRef.current && fileInputRef.current.click()}
          disabled={!canAddMore}
          style={{
            width: '100%',
            marginTop: 8,
            padding: '10px 16px',
            minHeight: 44,
            borderRadius: 12,
            border: 'none',
            background: 'transparent',
            color: canAddMore ? '#6366f1' : '#94a3b8',
            fontSize: 13,
            fontWeight: 700,
            cursor: canAddMore ? 'pointer' : 'not-allowed'
          }}
        >
          🖼️ Choose from Gallery
        </button>
      )}
      {cameraOpen && (
        <CameraCapture
          onCapture={handleCapture}
          onClose={() => setCameraOpen(false)}
          multiple={maxPhotos > 1}
          enforceCamera={!allowGallery}
        />
      )}
      {previews.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          {previews.map((preview, idx) => (
            <div key={idx} style={{ position: 'relative', width: 72, height: 72, borderRadius: 14, overflow: 'hidden' }}>
              <img src={preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              <button
                type="button"
                onClick={() => removePhoto(idx)}
                style={{
                  position: 'absolute', top: -2, right: -2, width: 22, height: 22,
                  background: '#ef4444', color: 'white', border: '2px solid white',
                  borderRadius: '50%', fontSize: 10, cursor: 'pointer', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', padding: 0
                }}
              >✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default PhotoUploadFlow;
