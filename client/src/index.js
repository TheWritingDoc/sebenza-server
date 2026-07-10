import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { applyBrowserFixes } from './utils/browserCompat';

// Apply browser-specific CSS fixes before render
applyBrowserFixes();

// Register the service worker: network-first HTML (never a stale shell after
// a deploy) + cache-first hashed assets (offline / metered-data friendly).
// The SW itself deletes caches from old versions on activate.
if ('serviceWorker' in navigator && !window.Capacitor) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch((err) => {
      console.log('SW registration failed:', err);
    });
  });
}

// Self-heal chunk-load/cache mismatch crashes that can appear as blank screen.
window.addEventListener('error', (event) => {
  const msg = String(event?.message || '');
  if (/Loading chunk [\d]+ failed|ChunkLoadError|Failed to fetch dynamically imported module/i.test(msg)) {
    const key = 'sebenza_chunk_reload_once';
    if (!sessionStorage.getItem(key)) {
      sessionStorage.setItem(key, '1');
      window.location.reload(true);
    }
  }
});

// Global back-button handler for mobile hardware back button.
// Every open overlay pushes ONE close handler + ONE dummy history entry, so
// hardware back closes overlays top-down before it ever navigates or exits
// the app. When an overlay is closed through its own UI (✕ / Done), the
// matching dummy entry is consumed so history never accumulates dead entries
// (dead entries made back "do nothing", then exit the app unexpectedly).
(function setupHardwareBackButton() {
  if (typeof window === 'undefined') return;

  const backStack = []; // LIFO of close functions, one dummy history entry each
  let suppressPops = 0; // popstate events we triggered ourselves (entry cleanup)
  let pendingConsume = 0;
  let consumeScheduled = false;

  window.__sebenzaBackStack = backStack;

  window.pushBackHandler = (closeFn) => {
    backStack.push(closeFn);
    if (window.history && window.history.pushState) {
      window.history.pushState({ __sebenzaBack: true, ts: Date.now() }, '');
    }
  };

  // Batch history cleanup: several overlays can close in the same tick
  // (e.g. job completion closes WorkHub + QR + summary); one go(-n) handles all.
  const scheduleConsume = () => {
    if (consumeScheduled) return;
    consumeScheduled = true;
    setTimeout(() => {
      consumeScheduled = false;
      const n = pendingConsume;
      pendingConsume = 0;
      if (n > 0 && window.history.state && window.history.state.__sebenzaBack) {
        suppressPops += 1; // go(-n) fires a single popstate
        window.history.go(-n);
      }
    }, 0);
  };

  window.popBackHandler = (closeFn) => {
    const idx = backStack.lastIndexOf(closeFn);
    if (idx !== -1) {
      backStack.splice(idx, 1);
      pendingConsume += 1;
      scheduleConsume();
    }
  };

  // ── Exit guard (native app only) ──
  // The Android wrapper's default back behavior is: WebView canGoBack ?
  // goBack : EXIT APP. We keep one sentinel entry at the bottom of history so
  // back never exits directly. When the sentinel is consumed on the home
  // screen we show "press back again to exit" and leave history empty for
  // 2 seconds — a second press within that window lets the native exit
  // happen; otherwise the sentinel is re-armed.
  const isNativeApp = !!(window.Capacitor && (
    typeof window.Capacitor.isNativePlatform === 'function'
      ? window.Capacitor.isNativePlatform()
      : window.Capacitor.isNative
  )) || /; wv\)/.test(navigator.userAgent); // Android WebView UA (wrapper without bridge)
  let guardArmed = false;

  const armExitGuard = () => {
    if (guardArmed) return;
    guardArmed = true;
    window.history.pushState({ __sebenzaExitGuard: true }, '');
  };

  const showExitToast = () => {
    const el = document.createElement('div');
    el.textContent = 'Press back again to exit Sebenza';
    el.style.cssText = 'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);background:rgba(15,23,42,0.92);color:white;padding:10px 18px;border-radius:999px;font-size:13px;font-weight:600;z-index:100001;font-family:inherit;pointer-events:none;';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1900);
  };

  if (isNativeApp) {
    // Arm once the app has booted (after the router settles on its first route).
    setTimeout(armExitGuard, 800);
  }

  window.addEventListener('popstate', (e) => {
    if (suppressPops > 0) {
      suppressPops -= 1;
      return;
    }
    if (backStack.length > 0) {
      const closeFn = backStack.pop();
      if (typeof closeFn === 'function') {
        try { closeFn(); } catch (err) { console.error('[BackButton] close error:', err); }
      }
      // The dummy entry for this overlay was consumed by this very back press;
      // remaining overlays still own their entries — nothing to re-push. The
      // overlay's effect cleanup will call popBackHandler, which no-ops because
      // the fn is already off the stack.
      e.stopImmediatePropagation?.();
      return;
    }

    if (!isNativeApp || !guardArmed) return;

    if (window.history.state && window.history.state.__sebenzaExitGuard) {
      // Popped a real page entry and landed ON the guard — normal in-app back,
      // let the router handle it.
      return;
    }

    // The guard itself was consumed — bottom of the app's history.
    guardArmed = false;
    const path = window.location.pathname;
    const onHome = path === '/dashboard' || path === '/' || path === '/login';
    if (onHome) {
      // Double-tap to exit: for 2s history stays empty so the next native back
      // press exits the app; after that the guard re-arms.
      showExitToast();
      e.stopImmediatePropagation?.();
      setTimeout(armExitGuard, 2000);
    } else {
      // Back pressed on a section reached without history (e.g. deep link):
      // go to the home screen instead of exiting.
      e.stopImmediatePropagation?.();
      window.history.replaceState(null, '', '/dashboard');
      armExitGuard();
      // Let the router re-render the new URL.
      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    }
  });
})();

class RootErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || 'Unexpected UI error' };
  }
  componentDidCatch(error, errorInfo) {
    console.error('Root render error:', error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', padding: 20 }}>
          <div style={{ maxWidth: 480, width: '100%', background: 'white', border: '1px solid #e2e8f0', borderRadius: 14, padding: 18 }}>
            <h2 style={{ margin: '0 0 8px', fontSize: 20 }}>We hit a display error</h2>
            <p style={{ margin: 0, color: '#475569', fontSize: 14 }}>Please reload this screen. If it keeps happening, close and reopen the app.</p>
            {this.state.message ? <p style={{ marginTop: 10, color: '#64748b', fontSize: 12 }}>Details: {this.state.message}</p> : null}
            <button onClick={() => window.location.reload()} style={{ marginTop: 14, background: '#0ea5e9', color: 'white', border: 'none', borderRadius: 10, padding: '10px 14px', fontWeight: 700, cursor: 'pointer' }}>
              Reload App
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </React.StrictMode>
);
