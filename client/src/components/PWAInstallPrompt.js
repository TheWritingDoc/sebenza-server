import React, { useState, useEffect } from 'react';

function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [platform, setPlatform] = useState('other');
  const [showIosHelp, setShowIosHelp] = useState(false);

  useEffect(() => {
    // Detect platform
    const ua = navigator.userAgent || navigator.vendor || window.opera;
    if (/android/i.test(ua)) setPlatform('android');
    else if (/iPad|iPhone|iPod/.test(ua) && !window.MSStream) setPlatform('ios');
    else setPlatform('other');

    // Check if already installed
    if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) {
      setIsInstalled(true);
      return;
    }

    // Check if user dismissed recently (within 7 days)
    const dismissedAt = localStorage.getItem('pwa_dismissed_at');
    if (dismissedAt && Date.now() - parseInt(dismissedAt) < 7 * 24 * 60 * 60 * 1000) {
      return;
    }

    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowPrompt(true);
    };

    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', () => {
      setIsInstalled(true);
      setShowPrompt(false);
      setDeferredPrompt(null);
    });

    // For iOS or browsers without beforeinstallprompt, show manual prompt after delay
    const timer = setTimeout(() => {
      if (!deferredPrompt && !isInstalled && !dismissedAt) {
        setShowPrompt(true);
      }
    }, 3000);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      clearTimeout(timer);
    };
  }, []);

  const handleInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setIsInstalled(true);
      }
      setDeferredPrompt(null);
      setShowPrompt(false);
    }
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    localStorage.setItem('pwa_dismissed_at', Date.now().toString());
  };

  if (isInstalled || !showPrompt) return null;

  // iOS Safari instructions
  if (platform === 'ios' && !deferredPrompt) {
    return (
      <div style={{
        position: 'fixed', bottom: 16, left: 16, right: 16, zIndex: 9999,
        background: 'linear-gradient(135deg, #1e293b, #0f172a)',
        borderRadius: 20, padding: '16px 20px',
        boxShadow: '0 10px 40px rgba(0,0,0,0.3)',
        border: '1px solid #334155'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ fontSize: 32 }}>📲</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'white' }}>
              Install Sebenza on iPhone
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
              Tap <strong style={{color:'white'}}>Share → Add to Home Screen</strong> to install
            </div>
          </div>
          <button onClick={handleDismiss} style={{
            padding: '10px 12px', borderRadius: 12, border: 'none',
            background: 'rgba(255,255,255,0.1)', color: '#94a3b8',
            fontSize: 13, fontWeight: 700, cursor: 'pointer'
          }}>✕</button>
        </div>
      </div>
    );
  }

  // Android or other with native install prompt
  return (
    <div style={{
      position: 'fixed', bottom: 16, left: 16, right: 16, zIndex: 9999,
      background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
      borderRadius: 20, padding: '16px 20px',
      boxShadow: '0 10px 40px rgba(99,102,241,0.35)',
      display: 'flex', alignItems: 'center', gap: 14,
      animation: 'slideUp 0.4s ease'
    }}>
      <style>{`
        @keyframes slideUp {
          from { transform: translateY(100px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
      <div style={{ fontSize: 32 }}>🚀</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'white' }}>
          Install Sebenza App
        </div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)', marginTop: 2 }}>
          {platform === 'android'
            ? 'Install for quick access and offline use'
            : 'Add to your home screen for quick access'}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        {deferredPrompt && (
          <button onClick={handleInstall} style={{
            padding: '10px 16px', borderRadius: 12, border: 'none',
            background: 'white', color: '#4f46e5',
            fontSize: 13, fontWeight: 800, cursor: 'pointer'
          }}>
            Install
          </button>
        )}
        <button onClick={handleDismiss} style={{
          padding: '10px 12px', borderRadius: 12, border: 'none',
          background: 'rgba(255,255,255,0.2)', color: 'white',
          fontSize: 13, fontWeight: 700, cursor: 'pointer'
        }}>
          ✕
        </button>
      </div>
    </div>
  );
}

export default PWAInstallPrompt;
