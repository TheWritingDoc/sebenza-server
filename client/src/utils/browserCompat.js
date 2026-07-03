/**
 * Browser compatibility helpers for Sebenza
 * Targets: Chrome, Safari, Firefox, Edge, Opera, Samsung Internet, Huawei Browser
 */

// Feature detection for CSS env() (safe-area-inset)
export function supportsEnv() {
  return CSS.supports('padding-bottom: env(safe-area-inset-bottom, 0px)');
}

// Fallback for browsers without CSS env() support (older Huawei/Opera)
export function getSafeAreaBottom() {
  if (supportsEnv()) return 'env(safe-area-inset-bottom, 0px)';
  // Fallback: detect iPhone X+ style notch via screen ratio
  const isNotchDevice = window.screen.height / window.screen.width > 2.0;
  return isNotchDevice ? '34px' : '0px';
}

// Detect if browser supports backdrop-filter
export function supportsBackdropFilter() {
  return CSS.supports('backdrop-filter', 'blur(12px)') ||
         CSS.supports('-webkit-backdrop-filter', 'blur(12px)');
}

// Detect touch capability properly across browsers
export function isTouchableDevice() {
  return 'ontouchstart' in window ||
         navigator.maxTouchPoints > 0 ||
         (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
}

// Safe geolocation check with fallback
export function hasGeolocation() {
  return !!(navigator.geolocation && navigator.geolocation.getCurrentPosition);
}

// Request geolocation with timeout and error handling
export function safeGetCurrentPosition(options = {}) {
  return new Promise((resolve, reject) => {
    if (!hasGeolocation()) {
      reject(new Error('Geolocation not supported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      resolve,
      reject,
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000, ...options }
    );
  });
}

// Safe localStorage with quota detection
export function safeLocalStorage() {
  const storage = {
    get: (key) => {
      try { return localStorage.getItem(key); } catch { return null; }
    },
    set: (key, value) => {
      try {
        localStorage.setItem(key, value);
        return true;
      } catch (e) {
        // Quota exceeded — clear old gshop data and retry
        if (e.name === 'QuotaExceededError') {
          try {
            const keys = Object.keys(localStorage).filter(k => k.startsWith('sebenza_') || k.startsWith('gshop_'));
            keys.forEach(k => localStorage.removeItem(k));
            localStorage.setItem(key, value);
            return true;
          } catch { return false; }
        }
        return false;
      }
    },
    remove: (key) => {
      try { localStorage.removeItem(key); } catch { /* ignore */ }
    }
  };
  return storage;
}

// Detect Huawei browser / HMS WebView quirks
export function isHuaweiBrowser() {
  const ua = navigator.userAgent || '';
  return /Huawei|HMS|HuaweiBrowser|HarmonyOS/.test(ua);
}

// Detect Opera (including Opera Mini)
export function isOpera() {
  const ua = navigator.userAgent || '';
  return /OPR|Opera|OPiOS/.test(ua);
}

// Detect Samsung Internet
export function isSamsungInternet() {
  const ua = navigator.userAgent || '';
  return /SamsungBrowser/.test(ua);
}

// Apply browser-specific CSS fixes
export function applyBrowserFixes() {
  const doc = document.documentElement;

  // Mark browser class on html element for CSS targeting
  if (isHuaweiBrowser()) doc.classList.add('browser-huawei');
  if (isOpera()) doc.classList.add('browser-opera');
  if (isSamsungInternet()) doc.classList.add('browser-samsung');
  if (!supportsBackdropFilter()) doc.classList.add('no-backdrop-filter');
  if (!supportsEnv()) doc.classList.add('no-env');

  // Huawei/older browsers: polyfill CSS env() via inline style on body
  if (!supportsEnv()) {
    const safeBottom = getSafeAreaBottom();
    document.body.style.setProperty('--safe-bottom', safeBottom);
  }
}
