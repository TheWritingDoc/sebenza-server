import React, { useState } from 'react';

// In-app map (OpenStreetMap embed, no API key needed) showing the job
// location. Turn-by-turn directions still hand off to the phone's maps app —
// that's the only way to get live voice navigation.
export default function JobMap({ lat, lng, height = 220 }) {
  const [failed, setFailed] = useState(false);
  if (lat == null || lng == null) return null;

  const d = 0.006; // ~600m box around the job
  const bbox = `${lng - d},${lat - d},${lng + d},${lat + d}`;
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${lat},${lng}`;

  if (failed) {
    return (
      <div style={{ padding: 12, borderRadius: 12, background: '#f1f5f9', fontSize: 12, color: '#64748b', textAlign: 'center' }}>
        📍 Map unavailable offline — location: {Number(lat).toFixed(5)}, {Number(lng).toFixed(5)}
      </div>
    );
  }

  return (
    <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid #e2e8f0', position: 'relative' }}>
      <iframe
        title="Job location map"
        src={src}
        onError={() => setFailed(true)}
        style={{ width: '100%', height, border: 'none', display: 'block' }}
        loading="lazy"
      />
    </div>
  );
}
