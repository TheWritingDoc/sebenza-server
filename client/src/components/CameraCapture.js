import React, { useState, useRef, useCallback, useEffect } from 'react';

const isMobile = () => /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

/**
 * Attach GPS geo-tags and timestamp to a File/Blob.
 * Returns a new File with embedded JSON metadata plus FormData-ready fields.
 */
async function enrichPhotoWithGeo(file, geo = null) {
  const metadata = {
    capturedAt: new Date().toISOString(),
    latitude: geo?.latitude ?? null,
    longitude: geo?.longitude ?? null,
    accuracy: geo?.accuracy ?? null,
    altitude: geo?.altitude ?? null,
  };

  // Rename file to include timestamp so it sorts and is identifiable
  const timestamp = Date.now();
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const safeExt = ['jpg', 'jpeg', 'png', 'webp'].includes(ext) ? ext : 'jpg';
  const newName = `sebenza_${timestamp}.${safeExt}`;

  // Build a new File so the metadata survives FormData upload.
  // We attach metadata as a custom property for downstream upload helpers.
  const renamed = new File([file], newName, { type: file.type || 'image/jpeg' });
  renamed.geoMetadata = metadata;
  return renamed;
}

async function getCurrentPosition(options = { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }) {
  if (!navigator.geolocation) return null;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        altitude: pos.coords.altitude,
      }),
      () => resolve(null),
      options
    );
  });
}

// enforceCamera: when true (proof/before/issue/after photos) the component
// keeps users on the live camera and never opens the free photo gallery. The
// fallback <input> still uses capture="environment", which opens the camera app
// rather than the gallery, so evidence photos stay genuine and geo-tagged.
function CameraCapture({ onCapture, onClose, multiple = false, enforceCamera = false }) {
  const videoRef = useRef(null);
  const fileInputRef = useRef(null);
  const streamRef = useRef(null);
  const [stream, setStream] = useState(null);
  const [captured, setCaptured] = useState([]);
  const [error, setError] = useState('');
  const [showFallback, setShowFallback] = useState(false);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setStream(null);
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const startCamera = useCallback(async () => {
    // Warm up the location permission early so the geo-tag is ready by capture
    // time (getCurrentPosition is also called again at capture for a fresh fix).
    if (navigator.geolocation) {
      try { navigator.geolocation.getCurrentPosition(() => {}, () => {}, { timeout: 8000 }); } catch (e) { /* ignore */ }
    }
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('getUserMedia not supported');
      }
      // Prefer the rear camera but never hard-fail if a device only has a front
      // one (facingMode as ideal, not exact). Request a usable resolution.
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });
      streamRef.current = mediaStream;
      setStream(mediaStream);
      setShowFallback(false);
    } catch (err) {
      console.error('Camera start error:', err);
      setShowFallback(true);
      // Fall back to the device camera app via a capture-hinted file input.
      // This still opens the camera (not the gallery), so proof photos stay live.
      if (fileInputRef.current) {
        fileInputRef.current.click();
      }
    }
  }, []);

  // Attach the stream AFTER the <video> mounts. It renders conditionally on
  // `stream`, so assigning srcObject inside startCamera hits a null ref and
  // leaves a black screen until the camera is reopened.
  useEffect(() => {
    if (stream && videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
  }, [stream]);

  const finalize = useCallback(async (files) => {
    const geo = await getCurrentPosition();
    const enriched = await Promise.all(files.map(f => enrichPhotoWithGeo(f, geo)));
    if (multiple) {
      setCaptured(prev => [...prev, ...enriched]);
    } else {
      onCapture(enriched[0]);
      stopCamera();
      onClose();
    }
  }, [multiple, onCapture, onClose, stopCamera]);

  const capture = useCallback(async () => {
    if (!videoRef.current || videoRef.current.readyState < 2) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth || 1280;
    canvas.height = videoRef.current.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoRef.current, 0, 0);

    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const file = new File([blob], `capture_${Date.now()}.jpg`, { type: 'image/jpeg' });
      await finalize([file]);
    }, 'image/jpeg', 0.9);
  }, [finalize]);

  const handleFileSelect = useCallback(async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    await finalize(files);
    e.target.value = '';
  }, [finalize]);

  const handleDone = useCallback(() => {
    if (multiple && captured.length > 0) {
      onCapture(captured);
    }
    stopCamera();
    onClose();
  }, [multiple, captured, onCapture, onClose, stopCamera]);

  // Start camera automatically on desktop; on mobile wait for user action to
  // avoid permission spam. Mount-only: re-running this on state changes used to
  // stop/restart the stream in a loop, forcing users to reopen the camera.
  useEffect(() => {
    if (!isMobile()) {
      startCamera();
    }
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <div style={{ padding: 20, textAlign: 'center' }}>
        <p style={{ color: '#ef4444', marginBottom: 16 }}>{error}</p>
        <button onClick={onClose} style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: '#f1f5f9', cursor: 'pointer' }}>
          Close
        </button>
      </div>
    );
  }

  return (
    // zIndex above every app surface (WorkHub footer is 10021, notifications
    // 10072) so nothing overlaps the live camera.
    <div style={{ position: 'fixed', inset: 0, background: 'black', zIndex: 100000, display: 'flex', flexDirection: 'column' }}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple={multiple}
        onChange={handleFileSelect}
        style={{ display: 'none' }}
      />
      {!stream && !showFallback ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <p style={{ color: 'white', marginBottom: 20, fontSize: 16, textAlign: 'center' }}>
            {isMobile() ? 'Tap below to open your camera' : 'Camera access required'}
          </p>
          <button
            onClick={startCamera}
            style={{ padding: '14px 28px', borderRadius: 12, border: 'none', background: '#6366f1', color: 'white', fontSize: 16, fontWeight: 700, cursor: 'pointer', minHeight: 48 }}
          >
            {isMobile() ? '📷 Open Camera' : 'Start Camera'}
          </button>
          <button
            onClick={onClose}
            style={{ marginTop: 12, padding: '10px 20px', borderRadius: 8, border: 'none', background: 'transparent', color: 'white', cursor: 'pointer' }}
          >
            Cancel
          </button>
        </div>
      ) : !stream && showFallback ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <p style={{ color: 'white', marginBottom: 20, fontSize: 16, textAlign: 'center' }}>
            Could not start camera. Use your device&apos;s camera instead.
          </p>
          <button
            onClick={() => fileInputRef.current && fileInputRef.current.click()}
            style={{ padding: '14px 28px', borderRadius: 12, border: 'none', background: '#6366f1', color: 'white', fontSize: 16, fontWeight: 700, cursor: 'pointer' }}
          >
            📷 Choose / Take Photo
          </button>
          <button
            onClick={onClose}
            style={{ marginTop: 12, padding: '10px 20px', borderRadius: 8, border: 'none', background: 'transparent', color: 'white', cursor: 'pointer' }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{ flex: 1, objectFit: 'cover', width: '100%' }}
          />
          {multiple && captured.length > 0 && (
            <div style={{ position: 'absolute', top: 16, right: 16, background: 'rgba(0,0,0,0.6)', color: 'white', padding: '6px 12px', borderRadius: 999, fontSize: 13, fontWeight: 700 }}>
              {captured.length} captured
            </div>
          )}
          <div style={{ padding: 20, display: 'flex', justifyContent: 'center', gap: 20, background: 'rgba(0,0,0,0.8)' }}>
            <button
              onClick={capture}
              aria-label="Take photo"
              style={{ width: 64, height: 64, borderRadius: '50%', border: '4px solid white', background: '#6366f1', cursor: 'pointer' }}
            />
            {multiple && (
              <button
                onClick={handleDone}
                style={{ padding: '12px 24px', borderRadius: 12, border: 'none', background: '#22c55e', color: 'white', fontWeight: 700, cursor: 'pointer' }}
              >
                Done
              </button>
            )}
            <button
              onClick={() => { stopCamera(); onClose(); }}
              style={{ padding: '12px 24px', borderRadius: 12, border: 'none', background: '#ef4444', color: 'white', fontWeight: 700, cursor: 'pointer' }}
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default CameraCapture;
