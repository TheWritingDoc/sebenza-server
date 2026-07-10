import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { MapIcon, MapPin, Building2 } from './Icons';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const API_URL = process.env.REACT_APP_API_URL || '';

// Leaflet is bundled (npm) so the map works in the native shell and offline.
function loadLeaflet() {
  return Promise.resolve(L);
}

const SA_DEFAULT = { lat: -30.5595, lng: 22.9375, zoom: 5 }; // whole country

function MapView({ user }) {
  const navigate = useNavigate();
  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const [layer, setLayer] = useState('all'); // all | jobs | businesses
  const [counts, setCounts] = useState({ jobs: 0, businesses: 0 });
  const [error, setError] = useState('');
  const layerGroups = useRef({ jobs: null, businesses: null });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const L = await loadLeaflet();
        if (cancelled || !mapEl.current || mapRef.current) return;

        const center = (user?.location?.lat && user?.location?.lng)
          ? [user.location.lat, user.location.lng]
          : [SA_DEFAULT.lat, SA_DEFAULT.lng];
        const zoom = (user?.location?.lat) ? 12 : SA_DEFAULT.zoom;

        const map = L.map(mapEl.current).setView(center, zoom);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap', maxZoom: 19,
        }).addTo(map);
        mapRef.current = map;
        // Ensure tiles lay out correctly once the container has its final size.
        setTimeout(() => { try { map.invalidateSize(); } catch (e) {} }, 200);

        const jobsGroup = L.layerGroup().addTo(map);
        const bizGroup = L.layerGroup().addTo(map);
        layerGroups.current = { jobs: jobsGroup, businesses: bizGroup };

        const pin = (emoji, color) => L.divIcon({
          className: '', html: `<div style="font-size:22px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))">${emoji}</div>`,
          iconSize: [24, 24], iconAnchor: [12, 24],
        });

        // Jobs (temporary)
        try {
          const q = user?.location?.lat ? `?lat=${user.location.lat}&lng=${user.location.lng}` : '';
          const jobs = (await axios.get(`${API_URL}/api/jobs${q}`)).data || [];
          let jc = 0;
          jobs.forEach(j => {
            if (!j.location?.lat) return;
            jc++;
            L.marker([j.location.lat, j.location.lng], { icon: pin('📌') })
              .bindPopup(`<strong>${j.title}</strong><br/>R${j.budgetMin || j.budget}${j.budgetMax ? '–R' + j.budgetMax : ''}<br/><span style="color:#6366f1">${j.category || ''}</span>`)
              .addTo(jobsGroup);
          });
          if (!cancelled) setCounts(c => ({ ...c, jobs: jc }));
        } catch (e) { /* jobs optional */ }

        // Businesses (always-on)
        try {
          const biz = (await axios.get(`${API_URL}/api/users/businesses`)).data || [];
          let bc = 0;
          biz.forEach(b => {
            if (!b.lat) return;
            bc++;
            const stars = '★'.repeat(Math.round(b.trustStars || 0));
            const m = L.marker([b.lat, b.lng], { icon: pin(b.accountType === 'business' ? '🏢' : '👥') })
              .bindPopup(`<strong>${b.name}</strong>${b.verified ? ' 🪪' : ''}<br/><span style="color:#f59e0b">${stars}</span> ${b.trustLevel || ''}<br/><span style="color:#6366f1">${b.category || ''}</span><br/><a href="/user/${b.id}">View profile →</a>`);
            m.on('popupopen', () => {
              const link = document.querySelector('.leaflet-popup a[href^="/user/"]');
              if (link) link.onclick = (ev) => { ev.preventDefault(); navigate(`/user/${b.id}`); };
            });
            m.addTo(bizGroup);
          });
          if (!cancelled) setCounts(c => ({ ...c, businesses: bc }));
        } catch (e) { /* businesses optional */ }
      } catch (e) {
        if (!cancelled) setError('Could not load the map. Check your connection and try again.');
      }
    })();

    return () => {
      cancelled = true;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
  }, [user, navigate]);

  // Toggle layers
  useEffect(() => {
    const { jobs, businesses } = layerGroups.current;
    const map = mapRef.current;
    if (!map || !jobs || !businesses) return;
    (layer === 'all' || layer === 'jobs') ? jobs.addTo(map) : map.removeLayer(jobs);
    (layer === 'all' || layer === 'businesses') ? businesses.addTo(map) : map.removeLayer(businesses);
  }, [layer]);

  const tab = (key, label) => (
    <button onClick={() => setLayer(key)} style={{
      flex: 1, minHeight: 40, borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700,
      background: layer === key ? '#4f46e5' : '#f1f5f9', color: layer === key ? 'white' : '#475569',
    }}>{label}</button>
  );

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '12px 12px 90px' }}>
      <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 4px', color: '#1e293b' }}><MapIcon size={20} color="#4f46e5" style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />Map</h1>
      <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 10px' }}>
        <MapPin size={13} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />{counts.jobs} live jobs · <Building2 size={13} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />{counts.businesses} businesses near you
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        {tab('all', 'All')}
        {tab('jobs', <><MapPin size={14} color="currentColor" style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />Jobs</>)}
        {tab('businesses', <><Building2 size={14} color="currentColor" style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />Businesses</>)}
      </div>
      {error && <div style={{ background: '#fef2f2', color: '#991b1b', padding: 12, borderRadius: 12, fontSize: 13, marginBottom: 10 }}>{error}</div>}
      <div ref={mapEl} style={{ height: '65vh', minHeight: 380, borderRadius: 16, overflow: 'hidden', border: '1px solid #e2e8f0' }} />
    </div>
  );
}

export default MapView;
