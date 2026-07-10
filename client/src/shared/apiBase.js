/**
 * Single source of truth for where the API lives.
 *
 * - Web (served by the API server itself): same origin → '' (relative URLs).
 * - Native shell (Capacitor, local bundle): the WebView origin is
 *   https://localhost, so relative /api calls would hit the bundle, not the
 *   server. We point at the production API instead.
 * - REACT_APP_API_URL overrides both (local dev against a remote API, etc.).
 */
const isNative = !!(window.Capacitor && (
  typeof window.Capacitor.isNativePlatform === 'function'
    ? window.Capacitor.isNativePlatform()
    : window.Capacitor.isNative
));

const PROD_API = 'https://sebenza-server.onrender.com';

export const API_ORIGIN = process.env.REACT_APP_API_URL || (isNative ? PROD_API : '');

/** Origin for socket.io connections (never empty). */
export const SOCKET_ORIGIN = API_ORIGIN || window.location.origin;
