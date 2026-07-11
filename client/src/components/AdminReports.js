import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

const API_URL = process.env.REACT_APP_API_URL || '';

const REASON_LABELS = {
  scam: '🚨 Scam / fraud', harassment: '😠 Harassment', no_show: '👻 No-show',
  poor_work: '🔧 Dishonest work', spam: '📢 Spam', other: '❓ Other',
};

const ACTIONS = [
  { value: 'dismiss', label: 'Dismiss', hint: 'No action — report unfounded or minor', color: '#64748b' },
  { value: 'dismiss_frivolous', label: 'Dismiss + mark frivolous', hint: 'Bogus report — counts against the REPORTER (complainer score +15)', color: '#b45309' },
  { value: 'warn', label: 'Warn user', hint: 'Send the reported user a guidelines warning', color: '#d97706' },
  { value: 'flag_suspicious', label: 'Flag: suspicious', hint: 'Reported user gets −1★ + FLAGGED badge until cleared', color: '#dc2626' },
  { value: 'flag_scammer', label: 'Flag: scammer + kick', hint: 'FLAGGED badge AND all their sessions revoked', color: '#991b1b' },
];

function starsOf(u) {
  const identity = Number(u?.trustStars) || 0.5;
  const stats = u?.communityStats || {};
  const unresolvedFlags = (Array.isArray(u?.flags) ? u.flags : []).filter(f => f && !f.resolved).length;
  return { identity, reviews: stats.totalReceivedReviews || 0, avg: stats.receivedRatingsAvg || 0, complainer: stats.complainerScore || 0, unresolvedFlags };
}

function UserChip({ u, label, extra }) {
  const s = starsOf(u);
  return (
    <div style={{ flex: 1, minWidth: 0, background: '#f8fafc', borderRadius: 12, padding: '10px 12px' }}>
      <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
        {u?.profileImage
          ? <img src={u.profileImage} alt="" style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }} />
          : <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: '#64748b' }}>{(u?.name || '?')[0]}</div>}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u?.name || 'Unknown'}</div>
          <div style={{ fontSize: 11, color: '#64748b' }}>
            ⭐{s.identity} ID · {s.reviews ? `${Number(s.avg).toFixed(1)}★ (${s.reviews})` : 'no reviews'}
            {s.complainer >= 45 && <span style={{ color: '#b45309' }}> · complainer {s.complainer}</span>}
            {s.unresolvedFlags > 0 && <span style={{ color: '#dc2626', fontWeight: 700 }}> · 🚩{s.unresolvedFlags}</span>}
          </div>
        </div>
      </div>
      {extra}
    </div>
  );
}

/** Admin-only report review queue at /admin. */
export default function AdminReports({ user }) {
  const navigate = useNavigate();
  const [reports, setReports] = useState([]);
  const [status, setStatus] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [notes, setNotes] = useState({});
  const [msg, setMsg] = useState('');

  const isAdmin = user?.role === 'admin';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_URL}/api/admin/reports?status=${status}`);
      setReports(res.data);
    } catch (err) {
      setMsg(err.response?.status === 403 ? 'Admin access required' : 'Could not load reports');
    }
    setLoading(false);
  }, [status]);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  if (!isAdmin) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>
        <div style={{ fontSize: 40 }}>🔒</div>
        <p>Admin access required.</p>
        <button onClick={() => navigate('/dashboard')} style={{ minHeight: 44, padding: '10px 20px', borderRadius: 999, border: '2px solid #e2e8f0', background: 'white', cursor: 'pointer', fontWeight: 700 }}>Back to dashboard</button>
      </div>
    );
  }

  const resolve = async (reportId, action) => {
    setBusyId(reportId);
    try {
      await axios.post(`${API_URL}/api/admin/reports/${reportId}/resolve`, { action, note: notes[reportId] || '' });
      setMsg(`Report resolved: ${action.replace(/_/g, ' ')}`);
      setOpenId(null);
      await load();
    } catch (err) {
      setMsg(err.response?.data?.error || 'Could not resolve report');
    }
    setBusyId(null);
    setTimeout(() => setMsg(''), 4000);
  };

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '16px 16px 90px' }}>
      <h2 style={{ margin: '8px 0 2px', fontSize: 22 }}>🛡️ Report Review</h2>
      <p style={{ margin: '0 0 14px', color: '#64748b', fontSize: 13 }}>
        Flags set here directly affect community stars — flag only with clear evidence.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {['pending', 'actioned', 'dismissed', 'all'].map(st => (
          <button key={st} onClick={() => setStatus(st)} style={{
            minHeight: 40, padding: '6px 16px', borderRadius: 999, cursor: 'pointer', fontWeight: 700, fontSize: 13,
            border: status === st ? 'none' : '2px solid #e2e8f0',
            background: status === st ? '#0f172a' : 'white', color: status === st ? 'white' : '#475569',
          }}>{st}</button>
        ))}
      </div>

      {msg && <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', color: '#0369a1', padding: '10px 14px', borderRadius: 12, fontSize: 13, fontWeight: 600, marginBottom: 12 }}>{msg}</div>}

      {loading ? (
        <div style={{ textAlign: 'center', color: '#94a3b8', padding: 40 }}>Loading…</div>
      ) : reports.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#94a3b8', padding: 40 }}>
          <div style={{ fontSize: 40 }}>🎉</div>No {status === 'all' ? '' : status} reports.
        </div>
      ) : reports.map((r) => (
        <div key={r._id} style={{ background: 'white', borderRadius: 16, padding: 16, marginBottom: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 800, fontSize: 14 }}>{REASON_LABELS[r.reason] || r.reason}</span>
            <span style={{ fontSize: 11, color: '#94a3b8' }}>
              {new Date(r.createdAt).toLocaleString()} ·
              <span style={{ fontWeight: 700, color: r.status === 'pending' ? '#d97706' : r.status === 'actioned' ? '#dc2626' : '#64748b' }}> {r.status}</span>
            </span>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <UserChip u={r.reporter} label="Reporter" />
            <UserChip u={r.reported} label={`Reported${r.reportedTotalReports > 1 ? ` · ${r.reportedTotalReports} reports total` : ''}`}
              extra={<button onClick={() => navigate(`/user/${r.reported?._id || r.reportedId}`)} style={{ marginTop: 6, border: 'none', background: 'transparent', color: '#0ea5e9', fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: 0 }}>View profile →</button>} />
          </div>

          {r.details && (
            <div style={{ marginTop: 10, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '8px 12px', fontSize: 13, color: '#78350f' }}>
              “{r.details}”
            </div>
          )}

          {r.status !== 'pending' && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#64748b' }}>
              Resolved: <b>{(r.actionTaken || '').replace(/_/g, ' ')}</b>{r.resolutionNote ? ` — ${r.resolutionNote}` : ''}
            </div>
          )}

          {r.status === 'pending' && (
            openId === r._id ? (
              <div style={{ marginTop: 12 }}>
                <input
                  value={notes[r._id] || ''}
                  onChange={(e) => setNotes({ ...notes, [r._id]: e.target.value })}
                  placeholder="Resolution note (kept on record, shown in flag reason)"
                  style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10, border: '2px solid #e2e8f0', fontSize: 13, marginBottom: 8 }}
                />
                <div style={{ display: 'grid', gap: 6 }}>
                  {ACTIONS.map(a => (
                    <button key={a.value} disabled={busyId === r._id} onClick={() => resolve(r._id, a.value)} style={{
                      textAlign: 'left', minHeight: 44, padding: '8px 12px', borderRadius: 10, cursor: 'pointer',
                      border: `2px solid ${a.color}22`, background: `${a.color}0d`,
                    }}>
                      <span style={{ fontWeight: 800, fontSize: 13, color: a.color }}>{a.label}</span>
                      <span style={{ fontSize: 12, color: '#64748b', marginLeft: 8 }}>{a.hint}</span>
                    </button>
                  ))}
                </div>
                <button onClick={() => setOpenId(null)} style={{ marginTop: 8, border: 'none', background: 'transparent', color: '#94a3b8', fontSize: 12, cursor: 'pointer', minHeight: 44 }}>Cancel</button>
              </div>
            ) : (
              <button onClick={() => setOpenId(r._id)} disabled={busyId === r._id} style={{
                marginTop: 12, minHeight: 44, padding: '8px 20px', borderRadius: 999, border: 'none',
                background: '#0f172a', color: 'white', fontWeight: 700, fontSize: 13, cursor: 'pointer',
              }}>Review & resolve</button>
            )
          )}
        </div>
      ))}
    </div>
  );
}
