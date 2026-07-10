import React, { useEffect, useRef, useState } from 'react';
import useBodyScrollLock from './useBodyScrollLock';
import useHardwareBackClose from './useHardwareBackClose';

// Full-screen in-app navigation: live map with the user's position and the
// job pin, updated as they move (Leaflet + OpenStreetMap, no API key).
// Voice turn-by-turn is only possible in the phone's maps app, so a small
// hand-off button is kept as an option — but users navigate without ever
// leaving Sebenza.

// Leaflet is bundled (npm) so navigation works in the native shell and offline.
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

function loadLeaflet() {
  return Promise.resolve(L);
}

function distanceKm(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export default function NavigationMap({ lat, lng, title, onClose }) {
  useBodyScrollLock();
  useHardwareBackClose(true, onClose);
  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const userMarkerRef = useRef(null);
  const lineRef = useRef(null);
  const watchIdRef = useRef(null);
  const followRef = useRef(true);
  const [dist, setDist] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    loadLeaflet().then(L => {
      if (cancelled || !mapEl.current) return;
      const job = { lat: Number(lat), lng: Number(lng) };
      const map = L.map(mapEl.current, { zoomControl: true }).setView([job.lat, job.lng], 15);
      mapRef.current = map;
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors', maxZoom: 19
      }).addTo(map);

      const jobIcon = L.divIcon({ className: '', html: '<div style="font-size:30px;line-height:30px;transform:translate(-6px,-26px)">📍</div>', iconSize: [30, 30] });
      L.marker([job.lat, job.lng], { icon: jobIcon }).addTo(map).bindPopup(title || 'Job location');

      const userIcon = L.divIcon({
        className: '',
        html: '<div style="width:18px;height:18px;border-radius:50%;background:#2563eb;border:3px solid white;box-shadow:0 0 0 6px rgba(37,99,235,0.25)"></div>',
        iconSize: [18, 18], iconAnchor: [9, 9]
      });

      // Stop auto-following once the user pans the map themselves.
      map.on('dragstart', () => { followRef.current = false; });

      if (navigator.geolocation) {
        watchIdRef.current = navigator.geolocation.watchPosition(
          pos => {
            if (cancelled) return;
            const me = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            setDist(distanceKm(me, job));
            if (!userMarkerRef.current) {
              userMarkerRef.current = L.marker([me.lat, me.lng], { icon: userIcon }).addTo(map);
              lineRef.current = L.polyline([[me.lat, me.lng], [job.lat, job.lng]], { color: '#2563eb', weight: 3, dashArray: '6 8', opacity: 0.8 }).addTo(map);
              map.fitBounds(L.latLngBounds([me.lat, me.lng], [job.lat, job.lng]).pad(0.25));
            } else {
              userMarkerRef.current.setLatLng([me.lat, me.lng]);
              lineRef.current.setLatLngs([[me.lat, me.lng], [job.lat, job.lng]]);
              if (followRef.current) map.panTo([me.lat, me.lng], { animate: true });
            }
          },
          () => setError('Location unavailable — showing the job position only.'),
          { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 }
        );
      } else {
        setError('Location unavailable — showing the job position only.');
      }
    }).catch(() => setError('Map failed to load. Check your connection.'));

    return () => {
      cancelled = true;
      if (watchIdRef.current != null && navigator.geolocation) navigator.geolocation.clearWatch(watchIdRef.current);
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
      userMarkerRef.current = null;
      lineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng]);

  const openExternal = () => {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const url = isIOS
      ? `http://maps.apple.com/?daddr=${lat},${lng}&dirflg=d`
      : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
    window.open(url, '_blank');
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 10050, background: '#f8fafc', display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: 'white', borderBottom: '1px solid #e2e8f0', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <button onClick={onClose} aria-label="Back" style={{ width: 40, height: 40, borderRadius: '50%', border: '1px solid #e2e8f0', background: 'white', color: '#1e293b', fontSize: 20, cursor: 'pointer', flexShrink: 0 }}>←</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>🧭 {title || 'Navigate to job'}</div>
          <div style={{ fontSize: 11, color: '#64748b' }}>
            {dist != null ? (dist < 1 ? `${Math.round(dist * 1000)} m away` : `${dist.toFixed(1)} km away`) : 'Locating you…'}
          </div>
        </div>
        <button
          onClick={() => {
            followRef.current = true;
            if (userMarkerRef.current && mapRef.current) mapRef.current.panTo(userMarkerRef.current.getLatLng());
          }}
          aria-label="Center on me"
          style={{ width: 40, height: 40, borderRadius: '50%', border: '1px solid #bfdbfe', background: '#eff6ff', fontSize: 17, cursor: 'pointer', flexShrink: 0 }}
        >🎯</button>
      </div>

      {error && (
        <div style={{ padding: '8px 14px', background: '#fffbeb', borderBottom: '1px solid #fde68a', fontSize: 12, color: '#92400e', fontWeight: 600, flexShrink: 0 }}>{error}</div>
      )}

      <div ref={mapEl} style={{ flex: 1 }} />

      <div style={{ padding: '10px 14px calc(env(safe-area-inset-bottom, 0px) + 10px)', background: 'white', borderTop: '1px solid #e2e8f0', flexShrink: 0 }}>
        <button onClick={openExternal} style={{ width: '100%', padding: '11px 12px', borderRadius: 12, border: '1px solid #e2e8f0', background: '#f8fafc', color: '#475569', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
          🔊 Need voice directions? Open in your maps app
        </button>
      </div>
    </div>
  );
}
