// InvitePage - landing page for shared invite links
import React, { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || '';

const FEATURES = [
  { icon: '\u{1F91D}', title: 'Help Each Other', desc: "Ask for help when you need it. Lend a hand when you can." },
  { icon: '\u{1F4B0}', title: 'Fair Pay', desc: 'Agree on a fair price directly with your neighbour.' },
  { icon: '\u{1F4CD}', title: 'Local First', desc: 'Connect with people right in your neighbourhood.' },
  { icon: '\u{2B50}', title: 'Built on Trust', desc: 'Honest reviews from real people in your community.' },
];

function InvitePage() {
  const [searchParams] = useSearchParams();
  const ref = searchParams.get('ref') || '';
  const [referrerName, setReferrerName] = useState('');
  const [stats, setStats] = useState({ users: 0, services: 0, transactions: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        if (ref) {
          try {
            const res = await axios.get(`${API_URL}/api/users/referrer/${ref}`);
            if (res.data.name) setReferrerName(res.data.name);
          } catch {
            // ignore
          }
        }
        const statsRes = await fetch(`${API_URL}/api/stats/public`);
        const stats = await statsRes.json();
        if (stats) setStats(stats);
      } catch (err) {
        console.error('Error:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [ref]);

  const registerUrl = ref ? `/register?ref=${ref}` : '/register';

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #f8fafc, #e2e8f0)' }}>
      <div style={{
        background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
        padding: '60px 20px 80px',
        textAlign: 'center',
        position: 'relative',
        overflow: 'hidden'
      }}>
        <div style={{
          position: 'absolute', top: '-40px', right: '-40px',
          width: 200, height: 200, borderRadius: '50%',
          background: 'rgba(255,255,255,0.08)'
        }} />
        <div style={{
          position: 'absolute', bottom: '-60px', left: '-60px',
          width: 280, height: 280, borderRadius: '50%',
          background: 'rgba(255,255,255,0.05)'
        }} />

        <img src="/logo-icon.png" alt="Sebenza" style={{ height: 80, marginBottom: 16 }} />
        <h1 style={{
          color: 'white', fontSize: 32, fontWeight: 800, margin: '0 0 8px',
          textShadow: '0 2px 10px rgba(0,0,0,0.15)'
        }}>
          Share a Hand. Build Trust.<br />Grow Together.
        </h1>
        <p style={{ color: 'rgba(255,255,255,0.9)', fontSize: 16, margin: '0 0 28px' }}>
          {referrerName
            ? `${referrerName} invited you to join Sebenza.`
            : 'Join Sebenza — your local community help network.'}
        </p>
        <Link to={registerUrl} style={{
          display: 'inline-block', background: 'white', color: '#4f46e5',
          padding: '14px 36px', borderRadius: 14, fontWeight: 800,
          fontSize: 16, textDecoration: 'none',
          boxShadow: '0 8px 24px rgba(0,0,0,0.2)'
        }}>
          Join Free — No Credit Card
        </Link>
        <div style={{ marginTop: 14 }}>
          <Link to="/login" style={{
            color: 'rgba(255,255,255,0.85)', fontSize: 14,
            textDecoration: 'underline'
          }}>
            Already have an account? Sign In
          </Link>
        </div>
      </div>

      <div style={{
        display: 'flex', justifyContent: 'center', gap: '32px',
        flexWrap: 'wrap', padding: '24px 20px',
        marginTop: '-40px', position: 'relative', zIndex: 2
      }}>
        {[
          { label: 'Members', value: stats.users },
          { label: 'Services', value: stats.services },
          { label: 'Jobs Done', value: stats.transactions },
        ].map((s, i) => (
          <div key={i} style={{
            background: 'white', borderRadius: 16, padding: '16px 28px',
            textAlign: 'center', boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
            minWidth: 110
          }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#4f46e5' }}>
              {loading ? '...' : s.value.toLocaleString()}
            </div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '40px 20px' }}>
        <h2 style={{ textAlign: 'center', fontSize: 24, fontWeight: 800, color: '#1e293b', marginBottom: 28 }}>
          Why Join Sebenza?
        </h2>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16
        }}>
          {FEATURES.map((f, i) => (
            <div key={i} style={{
              background: 'white', borderRadius: 20, padding: 24,
              boxShadow: '0 2px 12px rgba(0,0,0,0.05)', textAlign: 'center'
            }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>{f.icon}</div>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1e293b', margin: '0 0 6px' }}>{f.title}</h3>
              <p style={{ fontSize: 13, color: '#64748b', margin: 0, lineHeight: 1.5 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '20px 20px 40px' }}>
        <h2 style={{ textAlign: 'center', fontSize: 24, fontWeight: 800, color: '#1e293b', marginBottom: 28 }}>
          Popular Categories
        </h2>
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center'
        }}>
          {['House Cleaning', 'Car Wash', 'Dog Walking', 'Laundry', 'Braai / BBQ', 'Haircut', 'Errands', 'Cooking', 'Babysitting', 'Gardening', 'Moving Help', 'Tech Help'].map((cat, i) => (
            <span key={i} style={{
              background: 'white', borderRadius: 20, padding: '8px 16px',
              fontSize: 13, fontWeight: 600, color: '#4f46e5',
              boxShadow: '0 1px 6px rgba(0,0,0,0.05)'
            }}>
              {cat}
            </span>
          ))}
        </div>
      </div>

      <div style={{ textAlign: 'center', padding: '40px 20px 60px' }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: '#1e293b', marginBottom: 12 }}>
          Ready to start?
        </h2>
        <p style={{ fontSize: 14, color: '#64748b', marginBottom: 24 }}>
          Join thousands of neighbours helping each other every day.
        </p>
        <Link to={registerUrl} style={{
          display: 'inline-block', background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
          color: 'white', padding: '14px 36px', borderRadius: 14,
          fontWeight: 800, fontSize: 16, textDecoration: 'none',
          boxShadow: '0 8px 24px rgba(79,70,229,0.3)'
        }}>
          Create Free Account
        </Link>
      </div>
    </div>
  );
}

export default InvitePage;
