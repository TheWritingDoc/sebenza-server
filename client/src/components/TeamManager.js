import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { TrustStars } from './TrustCenter';

const API_URL = process.env.REACT_APP_API_URL || '';

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
            <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 10px' }}>Members</h3>
            {activeMembers.length === 0 && pendingMembers.length === 0 && (
              <p style={{ fontSize: 13, color: '#94a3b8' }}>No members yet — invite someone above.</p>
            )}
            {activeMembers.map((m, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: '#1e293b' }}>{m.userId?.name || m.name}</div>
                  {m.userId?.trustStars != null && <TrustStars stars={m.userId.trustStars} size={13} />}
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
      {team && role === 'member' && (
        <div style={card}>
          <h3 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 4px' }}>{team.name}</h3>
          <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 12px' }}>
            You work under {team.supervisorId?.businessName || team.supervisorId?.name || 'your supervisor'}.
          </p>
          <button disabled={busy} onClick={leave} style={{ ...btn('#fef2f2'), color: '#dc2626', width: '100%' }}>Leave Team</button>
        </div>
      )}
    </div>
  );
}

export default TeamManager;
