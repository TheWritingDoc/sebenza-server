import React, { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FeatureIcon, IconBox } from './Icons';
import { UserPlus, Search, Handshake, Star, Smartphone, Share2 } from './Icons';
import { HOME_FEATURE_ICONS } from './Icons';
import { categoryEmojis, categoryGradients, categoryPriceHints } from '../shared/constants';
import '../styles/Home.css';

const API_URL = process.env.REACT_APP_API_URL || '';

const POPULAR_TASKS = [
  { cat: 'House Cleaning', emoji: '🧹', price: 'R150', desc: 'Get your home sparkling clean' },
  { cat: 'Car Wash', emoji: '🚗', price: 'R80', desc: 'Wash & shine at your doorstep' },
  { cat: 'Dog Walking', emoji: '🐕', price: 'R50', desc: 'Someone to walk your furry friend' },
  { cat: 'Laundry', emoji: '🧺', price: 'R60', desc: 'Wash, dry & fold your clothes' },
  { cat: 'Braai / BBQ', emoji: '🔥', price: 'R300', desc: 'A braai master for your event' },
  { cat: 'Haircut', emoji: '💇', price: 'R100', desc: 'Fresh cut in the comfort of home' },
  { cat: 'Errands', emoji: '🛒', price: 'R40', desc: 'Groceries, parcels, quick runs' },
  { cat: 'Yard Work', emoji: '🌿', price: 'R200', desc: 'Mow, rake, tidy your garden' },
  { cat: 'Moving Help', emoji: '📦', price: 'R400', desc: 'Extra hands for your move' },
  { cat: 'Pet Wash', emoji: '🛁', price: 'R90', desc: 'Bath & groom your pet at home' },
  { cat: 'Furniture Assembly', emoji: '🪑', price: 'R120', desc: 'Build that flat-pack furniture' },
  { cat: 'Shoe Cleaning', emoji: '👟', price: 'R35', desc: 'Make your kicks look brand new' },
];

const HOW_IT_WORKS = [
  {
    icon: '📝',
    title: 'Post a Task',
    desc: 'Need your car washed? Laundry piling up? Post it in 30 seconds.',
    color: '#6366f1',
    bg: '#eef2ff',
  },
  {
    icon: '🤝',
    title: 'Get Offers',
    desc: 'Neighbours nearby see your task and offer to help — often within minutes.',
    color: '#22c55e',
    bg: '#f0fdf4',
  },
  {
    icon: '💬',
    title: 'Agree on Price',
    desc: 'Chat, negotiate, and settle on a fair price that works for both of you.',
    color: '#f59e0b',
    bg: '#fef3c7',
  },
  {
    icon: '✅',
    title: 'Done & Dusty',
    desc: 'They show up, get it done, and you pay safely. Then leave a rating!',
    color: '#10b981',
    bg: '#d1fae5',
  },
];

const REAL_STORIES = [
  { name: 'Sarah', task: 'Car Wash', price: 'R80', time: '2 hours ago', emoji: '🚗', quote: 'My car was filthy. Someone came to my house and washed it while I worked from home!' },
  { name: 'Mike', task: 'Dog Walking', price: 'R50', time: 'Yesterday', emoji: '🐕', quote: 'I walk 3 dogs in my neighbourhood every weekend. Easy money and I love the pups.' },
  { name: 'Thabo', task: 'Braai / BBQ', price: 'R350', time: 'Last week', emoji: '🔥', quote: 'I braai for parties on weekends. Made R1,400 last month doing what I enjoy.' },
  { name: 'Lerato', task: 'House Cleaning', price: 'R200', time: '3 days ago', emoji: '🧹', quote: 'Found someone to deep clean my apartment before my parents visited. Lifesaver!' },
];

const STATS_CONFIG = [
  { key: 'users', label: 'Neighbours', icon: '👥' },
  { key: 'services', label: 'Tasks Listed', icon: '📝' },
  { key: 'transactions', label: 'Jobs Done', icon: '✅' },
];

function Home() {
  const [stats, setStats] = useState({ users: 0, services: 0, transactions: 0 });
  const [searchParams] = useSearchParams();
  const ref = searchParams.get('ref') || '';
  const registerLink = ref ? `/register?ref=${ref}` : '/register';

  useEffect(() => {
    const fetchData = async () => {
      try {
        const healthRes = await fetch(`${API_URL}/api/health`);
        const healthData = await healthRes.json();
        if (healthData.stats) setStats(healthData.stats);
      } catch (err) {
        console.error('Error:', err);
      }
    };
    fetchData();
  }, []);

  return (
    <div className="home-container" style={{ padding: '0 16px 40px', maxWidth: 900, margin: '0 auto' }}>
      {/* ===== HERO ===== */}
      <section style={{
        textAlign: 'center', padding: '48px 20px 40px',
        background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #ec4899 100%)',
        color: 'white', borderRadius: 24, margin: '16px 0 24px', position: 'relative', overflow: 'hidden',
      }}>
        {/* Floating emoji decorations */}
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', opacity: 0.12 }}>
          {['🧹','🌿','🚗','🐕','🧺','🔥','💇','🛒','🛁','👟','📦','🪑','🌱','👶','🍳'].map((e, i) => (
            <span key={i} style={{
              position: 'absolute',
              left: `${(i * 7) % 100}%`, top: `${(i * 13) % 100}%`,
              fontSize: `${20 + (i % 3) * 12}px`,
              transform: `rotate(${i * 25}deg)`,
            }}>{e}</span>
          ))}
        </div>

        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12 }}>
            <img src="/logo-icon.png" alt="Sebenza" style={{ height: 64, width: 64, borderRadius: 18, boxShadow: '0 8px 24px rgba(0,0,0,0.25)', objectFit: 'cover' }} />
            <span style={{ fontSize: 'clamp(1.9rem, 6vw, 2.4rem)', fontWeight: 800, letterSpacing: '-0.02em' }}>Sebenza</span>
          </div>
          <h1 style={{ fontSize: 'clamp(1.8rem, 6vw, 2.6rem)', fontWeight: 800, margin: '0 0 12px', lineHeight: 1.15, letterSpacing: '-0.02em' }}>
            Find Help. Find Work. Close to Home.
          </h1>
          <p style={{ fontSize: 'clamp(1rem, 3vw, 1.2rem)', opacity: 0.92, maxWidth: 520, margin: '0 auto 8px', lineHeight: 1.5 }}>
            Let's get to know each other again. Share a skill, lend a hand, ask for help — from <strong>R10</strong> upwards.
          </p>
          <p style={{ fontSize: 14, opacity: 0.75, marginBottom: 24 }}>
            🏘️ A community built on caring, sharing, and showing up for one another.
          </p>

          {ref && (
            <div style={{
              background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(8px)',
              borderRadius: 12, padding: '10px 18px', marginBottom: 20,
              color: 'white', fontSize: 14, fontWeight: 600, display: 'inline-block',
            }}>
              ⭐ You were invited by a friend! Join free below.
            </div>
          )}

          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link to={registerLink} style={{
              background: 'white', color: '#6366f1', padding: '14px 32px',
              borderRadius: 14, fontWeight: 700, textDecoration: 'none',
              fontSize: 16, display: 'inline-flex', alignItems: 'center', gap: 8,
              boxShadow: '0 4px 16px rgba(0,0,0,0.15)', transition: 'all 0.2s',
            }}>
              🤝 Join Your Community
            </Link>
            <Link to="/login" style={{
              background: 'transparent', color: 'white', padding: '14px 32px',
              borderRadius: 14, fontWeight: 700, textDecoration: 'none',
              fontSize: 16, display: 'inline-flex', alignItems: 'center', gap: 8,
              border: '2px solid rgba(255,255,255,0.5)', transition: 'all 0.2s',
            }}>
              Sign In
            </Link>
          </div>
        </div>
      </section>

      {/* ===== POPULAR TASKS ===== */}
      <section style={{ marginBottom: 40 }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: '#1e293b', margin: '0 0 6px', textAlign: 'center' }}>
          What does your community need?
        </h2>
        <p style={{ fontSize: 14, color: '#64748b', textAlign: 'center', marginBottom: 20 }}>
          Everyday tasks that bring neighbours together
        </p>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(min(140px, 100%), 1fr))',
          gap: 10,
        }}>
          {POPULAR_TASKS.map((t, i) => {
            const grad = categoryGradients[t.cat] || categoryGradients.Other;
            const hint = categoryPriceHints[t.cat];
            return (
              <div key={i} style={{
                background: 'white', borderRadius: 18, padding: '16px 10px',
                border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                textAlign: 'center', transition: 'all 0.2s', cursor: 'default',
              }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.08)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.04)'; }}
              >
                <div style={{
                  width: 52, height: 52, borderRadius: 16, margin: '0 auto 10px',
                  background: grad, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 26, boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                }}>{t.emoji}</div>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#1e293b', marginBottom: 3 }}>{t.cat}</div>
                <div style={{ fontSize: 12, color: '#22c55e', fontWeight: 700, marginBottom: 4 }}>{t.price}{hint && <span style={{ color: '#94a3b8', fontWeight: 500 }}> {hint.unit}</span>}</div>
                <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.4 }}>{t.desc}</div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ===== HOW IT WORKS ===== */}
      <section style={{ marginBottom: 40 }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: '#1e293b', margin: '0 0 20px', textAlign: 'center' }}>
          How we help each other
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(220px, 100%), 1fr))', gap: 14 }}>
          {HOW_IT_WORKS.map((step, i) => (
            <div key={i} style={{
              background: 'white', borderRadius: 20, padding: '22px 18px',
              border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              textAlign: 'center',
            }}>
              <div style={{
                width: 56, height: 56, borderRadius: 18, margin: '0 auto 14px',
                background: step.bg, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 26, boxShadow: `0 4px 12px ${step.bg}`,
              }}>{step.icon}</div>
              <div style={{ fontSize: 10, fontWeight: 800, color: step.color, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Step {i + 1}</div>
              <h3 style={{ fontSize: 16, fontWeight: 800, color: '#1e293b', margin: '0 0 8px' }}>{step.title}</h3>
              <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.55, margin: 0 }}>{step.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ===== REAL STORIES ===== */}
      <section style={{ marginBottom: 40 }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: '#1e293b', margin: '0 0 6px', textAlign: 'center' }}>
          Neighbours helping neighbours
        </h2>
        <p style={{ fontSize: 14, color: '#64748b', textAlign: 'center', marginBottom: 20 }}>
          When we show up for each other, everyone wins
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(260px, 100%), 1fr))', gap: 14 }}>
          {REAL_STORIES.map((story, i) => (
            <div key={i} style={{
              background: 'white', borderRadius: 20, padding: '18px 18px 16px',
              border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: '50%',
                  background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 16, color: 'white', fontWeight: 700,
                }}>{story.name.charAt(0)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#1e293b' }}>{story.name}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>{story.time}</div>
                </div>
                <div style={{ fontSize: 20 }}>{story.emoji}</div>
              </div>
              <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.55, margin: '0 0 12px', fontStyle: 'italic' }}>
                "{story.quote}"
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#22c55e', background: '#f0fdf4', padding: '3px 10px', borderRadius: 20 }}>Paid {story.price}</span>
                <span style={{ fontSize: 12, color: '#64748b', fontWeight: 500 }}>{story.task}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ===== STATS ===== */}
      <section style={{
        display: 'flex', justifyContent: 'center', gap: 'clamp(16px, 4vw, 40px)',
        marginBottom: 40, padding: '24px 16px',
        background: '#f8fafc', borderRadius: 20, border: '1px solid #f1f5f9',
        flexWrap: 'wrap',
      }}>
        {STATS_CONFIG.map(({ key, label, icon }) => (
          <div key={key} style={{ textAlign: 'center', minWidth: 80 }}>
            <div style={{ fontSize: 28, marginBottom: 4 }}>{icon}</div>
            <h3 style={{ fontSize: 'clamp(1.5rem, 4vw, 2rem)', color: '#1e293b', margin: '0 0 4px', fontWeight: 800 }}>{stats[key] ?? 0}</h3>
            <p style={{ color: '#64748b', fontSize: 13, fontWeight: 600 }}>{label}</p>
          </div>
        ))}
      </section>

      {/* ===== WHY SEBENZA ===== */}
      <section style={{ marginBottom: 40 }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: '#1e293b', margin: '0 0 20px', textAlign: 'center' }}>
          Why neighbours love this
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(260px, 100%), 1fr))', gap: 14 }}>
          {[
            { icon: '💰', title: 'Set Your Own Price', desc: 'From R10 to R10,000,000. You decide what the task is worth. Negotiate freely.' },
            { icon: '🏘️', title: 'Neighbours Near You', desc: 'Find help within walking distance. No waiting for delivery trucks or call-outs.' },
            { icon: '🔒', title: 'Pay Safely', desc: 'Use escrow for peace of mind, or pay cash when the job is done. Your choice.' },
            { icon: '⭐', title: 'Build Trust', desc: 'Rate and review each other. Good neighbours rise to the top.' },
          ].map((item, i) => (
            <div key={i} style={{
              background: 'white', borderRadius: 18, padding: '20px 18px',
              border: '1px solid #f1f5f9', display: 'flex', gap: 14, alignItems: 'flex-start',
            }}>
              <div style={{ fontSize: 28, flexShrink: 0, marginTop: -2 }}>{item.icon}</div>
              <div>
                <h3 style={{ fontSize: 15, fontWeight: 800, color: '#1e293b', margin: '0 0 4px' }}>{item.title}</h3>
                <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.55, margin: 0 }}>{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ===== INSTALL APP ===== */}
      <section style={{
        textAlign: 'center', marginBottom: 40, padding: '32px 20px',
        background: '#f8fafc', borderRadius: 20, border: '1px solid #f1f5f9',
      }}>
        <div style={{ fontSize: 40, marginBottom: 10 }}>📱</div>
        <h2 style={{ marginBottom: 6, color: '#1e293b', fontSize: 20, fontWeight: 800 }}>Get the Sebenza App</h2>
        <p style={{ color: '#64748b', marginBottom: 20, maxWidth: 420, margin: '0 auto 20px', fontSize: 14 }}>
          Install Sebenza on your phone to stay connected with neighbours wherever you go.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <div style={{
            background: 'white', borderRadius: 14, padding: '14px 18px',
            border: '1px solid #e2e8f0', maxWidth: 260, textAlign: 'left',
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', marginBottom: 4 }}>🤖 Android</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>Chrome → tap menu ⋮ → "Add to Home screen"</div>
          </div>
          <div style={{
            background: 'white', borderRadius: 14, padding: '14px 18px',
            border: '1px solid #e2e8f0', maxWidth: 260, textAlign: 'left',
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', marginBottom: 4 }}>🍎 iPhone</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>Safari → tap Share → "Add to Home Screen"</div>
          </div>
        </div>
      </section>

      {/* ===== CTA FOOTER ===== */}
      <section style={{
        textAlign: 'center', padding: '40px 20px',
        background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
        borderRadius: 24, color: 'white', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'relative', zIndex: 1 }}>
          <h2 style={{ fontSize: 'clamp(1.4rem, 4vw, 1.8rem)', marginBottom: 8, fontWeight: 800 }}>
            Ready to meet your neighbours?
          </h2>
          <p style={{ opacity: 0.9, marginBottom: 24, fontSize: 15 }}>
            Ask for help. Offer a hand. Make a friend. It starts with one small step.
          </p>
          <Link to={registerLink} style={{
            background: 'white', color: '#6366f1', padding: '16px 40px',
            borderRadius: 16, fontWeight: 800, textDecoration: 'none',
            fontSize: 18, display: 'inline-flex', alignItems: 'center', gap: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.2)', transition: 'all 0.2s',
          }}>
            🤝 Join the Community
          </Link>
          <p style={{ opacity: 0.7, marginTop: 16, fontSize: 13 }}>
            No credit card required. Ever.
          </p>
        </div>
      </section>

      <footer style={{ textAlign: 'center', padding: '20px 16px 32px', color: '#94a3b8', fontSize: 13 }}>
        <Link to="/privacy" style={{ color: '#64748b', textDecoration: 'none', margin: '0 10px' }}>Privacy Policy</Link>
        ·
        <Link to="/terms" style={{ color: '#64748b', textDecoration: 'none', margin: '0 10px' }}>Terms of Service</Link>
        <div style={{ marginTop: 8 }}>© {new Date().getFullYear()} Sebenza</div>
      </footer>
    </div>
  );
}

export default Home;
