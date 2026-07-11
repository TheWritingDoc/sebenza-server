import React, { useState, useEffect, Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Link, useLocation, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import Home from './components/Home';
import Login from './components/Login';
import Register from './components/Register';
import PWAInstallPrompt from './components/PWAInstallPrompt';
import InvitePage from './components/InvitePage';
import NotificationSystem from './components/NotificationSystem';
import './index.css';
import './shared/axiosSetup'; // global JWT header + 401 → /login interceptor
import { SOCKET_ORIGIN } from './shared/apiBase';
import { Home as HomeIcon, Briefcase, ClipboardList, UserCircle, Plus, Bell } from './components/Icons';
import useHardwareBackClose from './shared/useHardwareBackClose';

// Safely read a JSON value from localStorage; clears the key if it's corrupt
// so a bad entry can't white-screen the whole app on boot.
function safeParse(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    try { localStorage.removeItem(key); } catch (_) { /* ignore */ }
    return null;
  }
}

// Lazy-load heavy page components to reduce initial bundle size
const Dashboard = lazy(() => import('./components/Dashboard'));
const Profile = lazy(() => import('./components/Profile'));
const MapView = lazy(() => import('./components/MapView'));
const TrustCenter = lazy(() => import('./components/TrustCenter'));
const EscrowTransactions = lazy(() => import('./components/EscrowTransactions'));
const WorkHistory = lazy(() => import('./components/WorkHistory'));
const CreateService = lazy(() => import('./components/CreateService'));
const ProviderPortfolio = lazy(() => import('./components/ProviderPortfolio'));
const PublicProfile = lazy(() => import('./components/PublicProfile'));
const Chat = lazy(() => import('./components/Chat'));
const JobBoard = lazy(() => import('./components/JobBoard'));
const TeamManager = lazy(() => import('./components/TeamManager'));
const PrivacyPolicy = lazy(() => import('./components/LegalPages').then(m => ({ default: m.PrivacyPolicy })));
const TermsOfService = lazy(() => import('./components/LegalPages').then(m => ({ default: m.TermsOfService })));

const API_URL = process.env.REACT_APP_API_URL || '';

export let socket = null;

function BottomNav({ user }) {
  const location = useLocation();
  const navigate = useNavigate();
  if (!user) return null;

  const isActive = (path) => location.pathname === path;

  const navItems = [
    { path: '/dashboard', icon: HomeIcon, label: 'Home' },
    { path: '/jobs',      icon: Briefcase, label: 'Community' },
    { path: '/work', icon: ClipboardList, label: 'My Work' },
    { path: '/profile',   icon: UserCircle, label: 'Profile' },
  ];

  return (
    <>
      {/* Floating Action Button */}
      <button
        onClick={() => navigate('/jobs?post=1')}
        className="mobile-fab"
        aria-label="Create post"
      >
        <Plus size={28} strokeWidth={2.5} color="white" />
      </button>

      {/* Bottom Navigation */}
      <nav className="mobile-bottom-nav">
        {navItems.map(item => {
          const active = isActive(item.path);
          const Icon = item.icon;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`mobile-nav-item ${active ? 'active' : ''}`}
            >
              <span className="mobile-nav-icon-wrap">
                <Icon
                  size={active ? 24 : 22}
                  strokeWidth={active ? 2.5 : 2}
                  className="mobile-nav-svg"
                />
                {active && <span className="mobile-nav-dot" />}
              </span>
              <span className="mobile-nav-label">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [viewingPortfolio, setViewingPortfolio] = useState(null);
  const [activeChat, setActiveChat] = useState(null);
  const [socketState, setSocketState] = useState(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 640);

  useEffect(() => {
    const storedUser = safeParse('sebenza_user');
    if (storedUser) setUser(storedUser);
    setLoading(false);
  }, []);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Global mobile keyboard handling: scroll focused inputs into view
  useEffect(() => {
    const isTouchable = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (!isTouchable) return;

    const handleFocusIn = (e) => {
      const tag = e.target.tagName;
      const type = e.target.type || '';
      const isTextInput = (tag === 'INPUT' && ['text','number','email','tel','password','search','url'].includes(type)) || tag === 'TEXTAREA';
      const isSpecialInput = tag === 'INPUT' && ['datetime-local','date','time'].includes(type);
      if ((isTextInput || isSpecialInput) && window.innerWidth < 768) {
        // Delay to allow virtual keyboard to open, then scroll input into center view
        setTimeout(() => {
          e.target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 350);
      }
    };

    document.addEventListener('focusin', handleFocusIn);
    return () => document.removeEventListener('focusin', handleFocusIn);
  }, []);

  // Connect Socket.IO when user logs in
  useEffect(() => {
    if (!user) {
      if (socket) { socket.disconnect(); socket = null; }
      setSocketState(null);
      return;
    }

    // Connect (or reconnect) with authenticated token
    if (!socket || !socket.connected) {
      const token = localStorage.getItem('token') || sessionStorage.getItem('token') || '';
      socket = io(SOCKET_ORIGIN, {
        transports: ['websocket', 'polling'],
        auth: { token }
      });
      setSocketState(socket);
    }

    const userId = user.id || user._id;
    socket.emit('register', userId);

    // Request browser notification permission for background alerts
    if (user && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }

    // CRITICAL: Re-register when socket reconnects after network hiccup
    // Without this, the server can't emit notifications to this device
    const onConnect = () => {
      console.log('[Socket] Reconnected, re-registering user:', userId);
      socket.emit('register', userId);
    };
    socket.on('connect', onConnect);

    return () => {
      socket.off('connect', onConnect);
    };
  }, [user]);

  // Hardware back-button: app-level overlays register once on open.
  useHardwareBackClose(notifOpen, () => setNotifOpen(false));
  useHardwareBackClose(!!activeChat, () => setActiveChat(null));
  useHardwareBackClose(!!viewingPortfolio, () => setViewingPortfolio(null));

  const handleLogin = (userData) => {
    setUser(userData);
    localStorage.setItem('sebenza_user', JSON.stringify(userData));
  };

  const handleLogout = () => {
    if (socket) { socket.disconnect(); socket = null; }
    setUser(null);
    localStorage.removeItem('sebenza_user');
    localStorage.removeItem('token');
    window.location.href = '/';
  };

  const handleServiceCreated = (newService) => { /* no-op */ };

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <Router>
      <div className="App">
        {/* Notification system */}
        {user && <NotificationSystem user={user} socket={socketState} panelOpen={notifOpen} onTogglePanel={setNotifOpen} hideBell={isMobile} />}

        {/* Desktop Navbar */}
        {user && (
          <nav className="navbar desktop-only">
            <div className="nav-brand" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <img src="/logo-icon.png" alt="Sebenza" style={{ height: '38px', width: '38px', borderRadius: '10px', objectFit: 'cover' }} />
              <span style={{ fontSize: '20px', fontWeight: 800, color: '#1e293b', letterSpacing: '-0.02em' }}>Sebenza</span>
            </div>
            <div className="nav-links">
              <Link to="/dashboard">Dashboard</Link>
              <Link to="/map">Map</Link>
              <Link to="/jobs">Job Board</Link>
              <Link to="/transactions">My Work</Link>
              <Link to="/profile">Profile</Link>
              <button onClick={handleLogout} className="btn-logout">Logout</button>
            </div>
          </nav>
        )}

        {/* Mobile Header */}
        {user && (
          <div className="mobile-header" style={{ justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
              <div style={{
                width: '36px', height: '36px', borderRadius: '50%', flexShrink: 0,
                background: (user.profileImage || user.avatar) ? `url(${API_URL}${user.profileImage || user.avatar}) center/cover` : 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '14px', color: 'white', fontWeight: 600
              }}>
                {!(user.profileImage || user.avatar) && user.name?.charAt(0).toUpperCase()}
              </div>
              <img src="/logo-icon.png" alt="Sebenza" style={{ height: '38px', width: '38px', borderRadius: '10px', objectFit: 'cover' }} />
              {user.verified && <span className="verified-badge" style={{ flexShrink: 0 }}>✓</span>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '15px', fontWeight: 700, color: '#4f46e5' }}>R{user.randBalance ?? 0}</div>
                {user.escrowRand > 0 && <div style={{ fontSize: '10px', color: '#f59e0b' }}>R{user.escrowRand} held</div>}
              </div>
              <button onClick={() => setNotifOpen(o => !o)} style={{
                width: '44px', height: '44px', borderRadius: '12px', border: 'none', background: 'white',
                boxShadow: '0 2px 8px rgba(0,0,0,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', position: 'relative', flexShrink: 0
              }} aria-label="Notifications">
                <Bell size={20} color="#4f46e5" strokeWidth={2} />
              </button>
              <button onClick={handleLogout} style={{background:'#ef4444',color:'white',border:'none',padding:'0 14px',minHeight:'44px',borderRadius:'10px',fontSize:'13px',fontWeight:'600',cursor:'pointer',whiteSpace:'nowrap',flexShrink:0}}>Logout</button>
            </div>
          </div>
        )}

        <div className="content-wrapper">
          <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}><div style={{ textAlign: 'center' }}><div style={{ width: 40, height: 40, border: '4px solid #e2e8f0', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 12px' }} /><div style={{ fontSize: 14, color: '#64748b', fontWeight: 600 }}>Loading...</div></div></div>}>
            <Routes>
              <Route path="/" element={user ? <Navigate to="/dashboard" /> : <Home />} />
              <Route path="/login" element={user ? <Navigate to="/dashboard" /> : <Login setUser={handleLogin} />} />
              <Route path="/register" element={user ? <Navigate to="/dashboard" /> : <Register setUser={handleLogin} />} />
              <Route path="/dashboard" element={user ? <Dashboard user={user} setUser={handleLogin} onViewPortfolio={setViewingPortfolio} /> : <Navigate to="/login" />} />
              <Route path="/map" element={user ? <MapView user={user} onViewPortfolio={setViewingPortfolio} /> : <Navigate to="/login" />} />
              <Route path="/profile" element={user ? <Profile user={user} setUser={setUser} /> : <Navigate to="/login" />} />
              <Route path="/verification" element={user ? <TrustCenter user={user} setUser={setUser} /> : <Navigate to="/login" />} />
              <Route path="/jobs" element={<JobBoard user={user} onViewPortfolio={setViewingPortfolio} />} />
              <Route path="/jobs/workhub/:jobId" element={user ? <JobBoard user={user} onViewPortfolio={setViewingPortfolio} /> : <Navigate to="/login" />} />
              <Route path="/transactions" element={user ? <EscrowTransactions onOpenChat={setActiveChat} /> : <Navigate to="/login" />} />
              <Route path="/work" element={user ? <WorkHistory /> : <Navigate to="/login" />} />
              <Route path="/create-service" element={user ? <CreateService user={user} onServiceCreated={handleServiceCreated} /> : <Navigate to="/login" />} />
              <Route path="/user/:id" element={<PublicProfile />} />
              <Route path="/team" element={user ? <TeamManager user={user} /> : <Navigate to="/login" />} />
              <Route path="/invite" element={<InvitePage />} />
              <Route path="/privacy" element={<PrivacyPolicy />} />
              <Route path="/terms" element={<TermsOfService />} />
              <Route path="*" element={<Navigate to={user ? '/dashboard' : '/'} replace />} />
            </Routes>
          </Suspense>
        </div>

        <BottomNav user={user} />

        <Suspense fallback={<div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.35)', zIndex: 10060, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ background: 'white', borderRadius: 14, padding: '10px 14px', fontSize: 13, fontWeight: 700, color: '#334155' }}>Loading profile…</div></div>}>
          {viewingPortfolio && (
            <ProviderPortfolio
              providerId={viewingPortfolio.id}
              providerName={viewingPortfolio.name}
              onClose={() => setViewingPortfolio(null)}
            />
          )}
        </Suspense>

        <Suspense fallback={null}>
          {activeChat && (
            <Chat
              transactionId={activeChat.transactionId}
              otherUser={activeChat.otherUser}
              onClose={() => setActiveChat(null)}
            />
          )}
        </Suspense>

        <PWAInstallPrompt />
      </div>
    </Router>
  );
}

export default App;

