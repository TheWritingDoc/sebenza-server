import React, { useState, useEffect, useCallback } from 'react';
import { getImageUrl, PLACEHOLDER_IMG } from '../shared/constants';

function PhotoGallery({ photos, onClose, startIndex = 0 }) {
  const [currentIndex, setCurrentIndex] = useState(startIndex);
  const [touchStart, setTouchStart] = useState(null);
  const [touchEnd, setTouchEnd] = useState(null);

  const minSwipeDistance = 50;

  const normalizedPhotos = (photos || []).map(p => {
    if (typeof p === 'string') return { url: p };
    return p;
  }).filter(p => p && (p.url || p));

  const onTouchStart = (e) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };

  const onTouchMove = (e) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const onTouchEnd = () => {
    if (!touchStart || !touchEnd) return;
    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;
    if (isLeftSwipe) goNext();
    if (isRightSwipe) goPrev();
  };

  const goNext = useCallback(() => {
    setCurrentIndex(prev => (prev + 1) % normalizedPhotos.length);
  }, [normalizedPhotos.length]);

  const goPrev = useCallback(() => {
    setCurrentIndex(prev => (prev - 1 + normalizedPhotos.length) % normalizedPhotos.length);
  }, [normalizedPhotos.length]);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'ArrowRight') goNext();
      if (e.key === 'ArrowLeft') goPrev();
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [goNext, goPrev, onClose]);

  if (normalizedPhotos.length === 0) return null;

  const currentPhoto = normalizedPhotos[currentIndex];
  const currentUrl = getImageUrl(currentPhoto);
  const hasLocation = currentPhoto?.location?.lat && currentPhoto?.location?.lng;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)',
      backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center',
      justifyContent: 'center', zIndex: 10060, padding: 'clamp(8px, 3vw, 20px)'
    }} onClick={onClose}>
      <div style={{ position: 'relative', width: '100%', maxWidth: 800, height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }} onClick={e => e.stopPropagation()}>

        <button
          onClick={onClose}
          aria-label="Close gallery"
          style={{
            position: 'absolute',
            top: 'max(12px, env(safe-area-inset-top, 0px))',
            right: 'max(12px, env(safe-area-inset-right, 0px))',
            width: 44,
            height: 44,
            borderRadius: '50%',
            border: '1px solid rgba(255,255,255,0.25)',
            background: 'rgba(0,0,0,0.45)',
            color: 'white',
            fontSize: 22,
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 20,
          }}
        >
          ✕
        </button>

        {/* Counter */}
        <div style={{
          position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.5)', color: 'white', padding: '6px 14px',
          borderRadius: 20, fontSize: 13, fontWeight: 700, zIndex: 10
        }}>
          {currentIndex + 1} / {normalizedPhotos.length}
        </div>

        {/* Main image */}
        <div
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          style={{ width: '100%', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}
        >
          <img
            src={currentUrl}
            alt=""
            onError={(e) => { e.target.onerror = null; e.target.src = PLACEHOLDER_IMG; }}
            style={{ maxWidth: '100%', maxHeight: '80vh', borderRadius: 16, objectFit: 'contain', userSelect: 'none', WebkitUserDrag: 'none' }}
            draggable={false}
          />
        </div>

        {/* Location badge */}
        {hasLocation && (
          <div style={{
            position: 'absolute', bottom: 70, left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(0,0,0,0.6)', color: '#86efac', padding: '6px 14px',
            borderRadius: 20, fontSize: 12, fontWeight: 600, zIndex: 10, display: 'flex', alignItems: 'center', gap: 6
          }}>
            📍 {currentPhoto.location.lat.toFixed(5)}, {currentPhoto.location.lng.toFixed(5)}
          </div>
        )}

        {/* Navigation arrows */}
        {normalizedPhotos.length > 1 && (
          <>
            <button onClick={goPrev} style={{
              position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)',
              width: 48, height: 48, borderRadius: '50%',
              background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(8px)',
              border: '1px solid rgba(255,255,255,0.2)', color: 'white',
              fontSize: 24, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>‹</button>
            <button onClick={goNext} style={{
              position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
              width: 48, height: 48, borderRadius: '50%',
              background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(8px)',
              border: '1px solid rgba(255,255,255,0.2)', color: 'white',
              fontSize: 24, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>›</button>
          </>
        )}

        {/* Thumbnails */}
        {normalizedPhotos.length > 1 && (
          <div style={{
            display: 'flex', gap: 8, overflowX: 'auto', padding: '8px 4px',
            maxWidth: '100%', scrollbarWidth: 'none'
          }}>
            {normalizedPhotos.map((p, i) => (
              <button key={i} onClick={() => setCurrentIndex(i)} style={{
                flexShrink: 0, width: 56, height: 56, borderRadius: 12,
                border: i === currentIndex ? '3px solid #6366f1' : '3px solid transparent',
                overflow: 'hidden', padding: 0, cursor: 'pointer', opacity: i === currentIndex ? 1 : 0.6
              }}>
                <img src={getImageUrl(p)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  onError={(e) => { e.target.onerror = null; e.target.src = PLACEHOLDER_IMG; }} />
              </button>
            ))}
          </div>
        )}


      </div>
    </div>
  );
}

export default PhotoGallery;
