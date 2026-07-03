import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { TrustStars } from './TrustCenter';

const API_URL = process.env.REACT_APP_API_URL || '';

// Load the tiny qrcodejs lib from CDN once (same pattern as Leaflet in MapView).
let qrLibPromise = null;
function loadQrLib() {
  if (window.QRCode) return Promise.resolve(window.QRCode);
  if (qrLibPromise) return qrLibPromise;
  qrLibPromise = new Promise((resolve, reject) => {
    const js = document.createElement('script');
    js.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
    js.onload = () => resolve(window.QRCode);
    js.onerror = reject;
    document.head.appendChild(js);
  });
  return qrLibPromise;
}

function TeamManager({ user }) {
  const navigate = useNavigate();
  const token = localStorage.getItem('token');
  const H = { headers: { Authorization: `Bearer ${token}` } };

  const [team, setTeam] = useState(null);
  const [role, setRole] = useState(null);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  // Create-team form
  const [teamName, setTeamName] = useState('');
  const [teamType, setTeamType] = useState('team');
  // Invite form
  const [inviteEmail, setInviteEmail] = useState('');
  // QR check-in (supervisor shows, member scans/types)
  const [qr, setQr] = useState(null); // {code, payload, expiresAt, ttlMinutes}
  const [scanning, setScanning] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [myRole, setMyRole] = useState('');
  const qrBoxRef = useRef(null);
  const videoRef = useRef(null);
  const scanStopRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const [mineRes, invRes] = await Promise.all([
        axios.get(`${API_URL}/api/teams/mine`, H),
        axios.get(`${API_URL}/api/teams/invites`, H),
      ]);
      setTeam(mineRes.data.team);
      setRole(mineRes.data.role || null);
      setInvites(invRes.data.invites || []);
    } catch (err) {
      console.error('Team load failed:', err);
    }
    setLoading(false);
  }, [token]); // eslint-disable-line

  useEffect(() => { load(); }, [load]);

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(''), 2500); };

  const createTeam = async () => {
    if (!teamName.trim()) { flash('Enter a team name'); return; }
    setBusy(true);
    try {
      const res = await axios.post(`${API_URL}/api/teams`, { name: teamName, type: teamType }, H);
      setTeam(res.data.team); setRole('supervisor');
      flash('✅ Team created');
    } catch (err) { flash(err.response?.data?.error || 'Could not create team'); }
    setBusy(false);
  };

  const invite = async () => {
    if (!inviteEmail.trim()) { flash('Enter an email'); return; }
    setBusy(true);
    try {
      const res = await axios.post(`${API_URL}/api/teams/invite`, { email: inviteEmail }, H);
      setTeam(res.data.team); setInviteEmail('');
      flash('✅ ' + res.data.message);
    } catch (err) { flash(err.response?.data?.error || 'Invite failed'); }
    setBusy(false);
  };

  const respond = async (teamId, accept) => {
    setBusy(true);
    try {
      await axios.post(`${API_URL}/api/teams/${teamId}/respond`, { accept }, H);
      flash(accept ? '✅ Joined the team' : 'Invitation declined');
      await load();
    } catch (err) { flash(err.response?.data?.error || 'Failed'); }
    setBusy(false);
  };

  const removeMember = async (memberUserId) => {
    setBusy(true);
    try {
      const res = await axios.post(`${API_URL}/api/teams/${team._id}/remove-member`, { memberUserId }, H);
      setTeam(res.data.team);
      flash('Member removed');
    } catch (err) { flash(err.response?.data?.error || 'Failed'); }
    setBusy(false);
  };

  const leave = async () => {
    setBusy(true);
    try {
      await axios.post(`${API_URL}/api/teams/${team._id}/leave`, {}, H);
      flash('You left the team'); setTeam(null); setRole(null);
    } catch (err) { flash(err.response?.data?.error || 'Failed'); }
    setBusy(false);
  };

  // Supervisor: generate + render the QR
  const showQr = async () => {
    setBusy(true);
    try {
      const res = await axios.post(`${API_URL}/api/teams/${team._id}/qr`, {}, H);
      setQr(res.data);
      const QRCode = await loadQrLib();
      setTimeout(() => {
        if (qrBoxRef.current) {
          qrBoxRef.current.innerHTML = '';
          new QRCode(qrBoxRef.current, { text: res.data.payload, width: 200, height: 200, correctLevel: QRCode.CorrectLevel.M });
        }
      }, 50);
    } catch (err) { flash(err.response?.data?.error || 'Could not generate QR'); }
    setBusy(false);
  };

  const stopScan = useCallback(() => {
    if (scanStopRef.current) { scanStopRef.current(); scanStopRef.current = null; }
    setScanning(false);
  }, []);
  useEffect(() => stopScan, [stopScan]); // clean up camera on unmount

  const confirmQr = async (payloadOrCode) => {
    stopScan();
    setBusy(true);
    try {
      const res = await axios.post(`${API_URL}/api/teams/confirm-qr`, { payload: payloadOrCode, role: myRole }, H);
      flash('✅ ' + res.data.message);
      setManualCode('');
      await load();
    } catch (err) { flash(err.response?.data?.error || 'Confirmation failed'); }
    setBusy(false);
  };

  // Member: scan with the camera (BarcodeDetector) — falls back to typing the code.
  const startScan = async () => {
    if (!('BarcodeDetector' in window)) {
      flash('Camera scanning is not supported here — type the code instead');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      setScanning(true);
      const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      let active = true;
      scanStopRef.current = () => { active = false; stream.getTracks().forEach(t => t.stop()); };
      // Wait for the video element to mount, then attach + poll
      setTimeout(async () => {
        if (!active || !videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
        const tick = async () => {
          if (!active || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            const hit = codes.find(c => (c.rawValue || '').startsWith('SEBENZA-TEAM:'));
            if (hit) { confirmQr(hit.rawValue); return; }
          } catch (e) { /* keep polling */ }
          setTimeout(tick, 400);
        };
        tick();
      }, 100);
    } catch (err) {
      flash('Camera unavailable — type the code instead');
    }
  };

  const card = { background: 'white', borderRadius: 16, padding: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', marginBottom: 16 };
  const input = { width: '100%', padding: '12px 14px', borderRadius: 12, border: '2px solid #e2e8f0', fontSize: 16, boxSizing: 'border-box', minHeight: 48 };
  const btn = (bg) => ({ minHeight: 48, padding: '0 18px', borderRadius: 12, border: 'none', background: bg, color: 'white', fontWeight: 700, fontSize: 15, cursor: 'pointer' });

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>Loading your team…</div>;

  const activeMembers = (team?.members || []).filter(m => m.status === 'active');
  const pendingMembers = (team?.members || []).filter(m => m.status === 'invited');

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', padding: '16px 16px 100px' }}>
      <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', color: '#6366f1', fontSize: 14, fontWeight: 600, cursor: 'pointer', marginBottom: 12 }}>← Back</button>
      <h2 style={{ fontSize: 22, fontWeight: 800, color: '#1e293b', margin: '0 0 4px' }}>👥 Your Team</h2>
      <p style={{ color: '#64748b', fontSize: 14, margin: '0 0 16px' }}>Work as a crew under one supervisor.</p>

      {msg && <div style={{ ...card, textAlign: 'center', color: msg.startsWith('✅') ? '#166534' : '#991b1b', background: msg.startsWith('✅') ? '#f0fdf4' : '#fef2f2', fontWeight: 600, fontSize: 14 }}>{msg}</div>}

      {/* Pending invitations addressed to me */}
      {invites.length > 0 && (
        <div style={card}>
          <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 12px' }}>Invitations</h3>
          {invites.map(inv => (
            <div key={inv.teamId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid #f1f5f9', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: '#1e293b' }}>{inv.name}</div>
                <div style={{ fontSize: 12, color: '#64748b' }}>Supervisor: {inv.supervisor?.businessName || inv.supervisor?.name || 'Unknown'}</div>
              </div>
              <button disabled={busy} onClick={() => respond(inv.teamId, true)} style={btn('linear-gradient(135deg,#22c55e,#16a34a)')}>Accept</button>
              <button disabled={busy} onClick={() => respond(inv.teamId, false)} style={{ ...btn('#f1f5f9'), color: '#475569' }}>Decline</button>
            </div>
          ))}
        </div>
      )}

      {/* No team yet + not a member → create one */}
      {!team && (
        <div style={card}>
          <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 4px' }}>Start a team or business</h3>
          <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 14px' }}>Invite workers to operate under your supervision.</p>
          <input style={{ ...input, marginBottom: 10 }} placeholder="Team or business name" value={teamName} onChange={e => setTeamName(e.target.value)} />
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            {['team', 'business'].map(t => (
              <button key={t} onClick={() => setTeamType(t)} style={{
                flex: 1, minHeight: 44, borderRadius: 12, border: teamType === t ? '2px solid #6366f1' : '2px solid #e2e8f0',
                background: teamType === t ? '#eef2ff' : 'white', color: teamType === t ? '#4338ca' : '#475569', fontWeight: 700, cursor: 'pointer', textTransform: 'capitalize'
              }}>{t === 'team' ? '👥 Team' : '🏢 Business'}</button>
            ))}
          </div>
          <button disabled={busy} onClick={createTeam} style={{ ...btn('linear-gradient(135deg,#6366f1,#4f46e5)'), width: '100%' }}>Create Team</button>
        </div>
      )}

      {/* I supervise this team */}
      {team && role === 'supervisor' && (
        <>
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <h3 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>{team.name}</h3>
              <span style={{ fontSize: 11, fontWeight: 800, background: '#eef2ff', color: '#4338ca', padding: '3px 10px', borderRadius: 999 }}>
                {team.type === 'business' ? '🏢 Business' : '👥 Team'} · Supervisor
              </span>
            </div>
            <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 8px' }}>{activeMembers.length} active member{activeMembers.length === 1 ? '' : 's'}</p>
          </div>

          <div style={card}>
            <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 10px' }}>Invite a worker</h3>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input style={{ ...input, flex: 1, minWidth: 180 }} placeholder="worker's email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} />
              <button disabled={busy} onClick={invite} style={btn('linear-gradient(135deg,#6366f1,#4f46e5)')}>Invite</button>
            </div>
          </div>

          <div style={card}>
            <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 4px' }}>📷 On-site QR check-in</h3>
            <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 12px' }}>
              Show this QR to a member on site — they scan it to confirm you're working together (and their role).
            </p>
            {!qr && (
              <button disabled={busy} onClick={showQr} style={{ ...btn('linear-gradient(135deg,#0ea5e9,#0284c7)'), width: '100%' }}>Show QR Code</button>
            )}
            {qr && (
              <div style={{ textAlign: 'center' }}>
                <div ref={qrBoxRef} style={{ display: 'inline-block', padding: 12, background: 'white', border: '1px solid #e2e8f0', borderRadius: 12 }} />
                <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 4, color: '#1e293b', marginTop: 10 }}>{qr.code}</div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                  Or they can type this code · valid {qr.ttlMinutes} minutes
                </div>
                <button disabled={busy} onClick={showQr} style={{ ...btn('#f1f5f9'), color: '#475569', marginTop: 10, minHeight: 40 }}>↻ New code</button>
              </div>
            )}
          </div>

          <div style={card}>
            <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 10px' }}>Members</h3>
            {activeMembers.length === 0 && pendingMembers.length === 0 && (
              <p style={{ fontSize: 13, color: '#94a3b8' }}>No members yet — invite someone above.</p>
            )}
            {activeMembers.map((m, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: '#1e293b' }}>{m.userId?.name || m.name}</div>
                  {m.userId?.trustStars != null && <TrustStars stars={m.userId.trustStars} size={13} />}
                  {m.qrConfirmedAt && (
                    <div style={{ fontSize: 11, color: '#166534', fontWeight: 700, marginTop: 2 }}>
                      ✅ On-site confirmed{m.confirmedRole ? ` · ${m.confirmedRole}` : ''} · {new Date(m.qrConfirmedAt).toLocaleDateString()}
                    </div>
                  )}
                </div>
                <button disabled={busy} onClick={() => removeMember(m.userId?._id || m.userId)} style={{ ...btn('#fef2f2'), color: '#dc2626', minHeight: 40 }}>Remove</button>
              </div>
            ))}
            {pendingMembers.map((m, i) => (
              <div key={`p${i}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: '#64748b' }}>{m.name || m.inviteEmail}</div>
                  <div style={{ fontSize: 11, color: '#f59e0b', fontWeight: 700 }}>Invited — pending</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* I'm a member of someone's team */}
      {team && role === 'member' && (() => {
        const myRecord = (team.members || []).find(m => String(m.userId?._id || m.userId) === String(user?._id || user?.id));
        return (
          <>
            <div style={card}>
              <h3 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 4px' }}>{team.name}</h3>
              <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 12px' }}>
                You work under {team.supervisorId?.businessName || team.supervisorId?.name || 'your supervisor'}.
              </p>
              {myRecord?.qrConfirmedAt && (
                <div style={{ background: '#f0fdf4', color: '#166534', padding: '10px 12px', borderRadius: 12, fontSize: 13, fontWeight: 700, marginBottom: 12 }}>
                  ✅ On-site confirmed{myRecord.confirmedRole ? ` as ${myRecord.confirmedRole}` : ''} · {new Date(myRecord.qrConfirmedAt).toLocaleDateString()}
                </div>
              )}
              <button disabled={busy} onClick={leave} style={{ ...btn('#fef2f2'), color: '#dc2626', width: '100%' }}>Leave Team</button>
            </div>

            <div style={card}>
              <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 4px' }}>📷 Confirm you're working together</h3>
              <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 12px' }}>
                Scan your supervisor's QR code on site, or type the code they show you. Adding your role is optional.
              </p>
              <input style={{ ...input, marginBottom: 10 }} placeholder="Your role today (optional, e.g. Painter)" value={myRole} onChange={e => setMyRole(e.target.value)} maxLength={60} />
              {scanning ? (
                <div style={{ textAlign: 'center' }}>
                  <video ref={videoRef} muted playsInline style={{ width: '100%', maxHeight: 280, borderRadius: 12, background: '#000', objectFit: 'cover' }} />
                  <button onClick={stopScan} style={{ ...btn('#f1f5f9'), color: '#475569', width: '100%', marginTop: 10 }}>Stop scanning</button>
                </div>
              ) : (
                <button disabled={busy} onClick={startScan} style={{ ...btn('linear-gradient(135deg,#0ea5e9,#0284c7)'), width: '100%', marginBottom: 10 }}>📷 Scan QR Code</button>
              )}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: scanning ? 10 : 0 }}>
                <input style={{ ...input, flex: 1, minWidth: 140, textTransform: 'uppercase', letterSpacing: 2 }} placeholder="or type code"
                  value={manualCode} onChange={e => setManualCode(e.target.value.toUpperCase())} maxLength={10} />
                <button disabled={busy || !manualCode.trim()} onClick={() => confirmQr(manualCode.trim())} style={btn('linear-gradient(135deg,#22c55e,#16a34a)')}>Confirm</button>
              </div>
            </div>
          </>
        );
      })()}
    </div>
  );
}

export default TeamManager;
