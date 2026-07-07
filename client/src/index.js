import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { applyBrowserFixes } from './utils/browserCompat';

// Apply browser-specific CSS fixes before render
applyBrowserFixes();

// Add ngrok-skip-browser-warning header to all fetch requests
// This prevents ngrok's interstitial warning page from blocking API calls
const originalFetch = window.fetch;
window.fetch = function(...args) {
  const [url, config = {}] = args;
  config.headers = {
    ...config.headers,
    'ngrok-skip-browser-warning': 'true'
  };
  return originalFetch(url, config);
};

// Also add header to XMLHttpRequest for components that use it
const originalXHROpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function(method, url, ...rest) {
  this.addEventListener('readystatechange', function() {
    if (this.readyState === 1) { // OPENED
      try { this.setRequestHeader('ngrok-skip-browser-warning', 'true'); } catch(e) {}
    }
  });
  return originalXHROpen.call(this, method, url, ...rest);
};

// Disable service worker caching to prevent blank-screen stale bundle issues after deploys.
// Also proactively unregister existing workers + stale caches once on load.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
      if (window.caches?.keys) {
        const keys = await window.caches.keys();
        await Promise.all(keys.map((k) => window.caches.delete(k)));
      }
      console.log('SW disabled and stale caches cleared');
    } catch (err) {
      console.log('SW cleanup failed:', err);
    }
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
            <p style={{ margin: 0, color: '#475569', fontSize: 14 }}>Please reload this screen. If it repeats, Jason will patch it immediately.</p>
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
