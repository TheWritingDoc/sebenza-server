import axios from 'axios';
import { API_ORIGIN } from './apiBase';

/**
 * Global axios setup, imported once at app entry.
 *
 * 1. Rewrites relative /api URLs to the API origin — a no-op on the web
 *    (same origin), but essential in the native shell where the bundle is
 *    served locally and relative calls would never reach the server.
 * 2. Attaches the JWT to every request from localStorage (so individual call
 *    sites don't each rebuild the auth header — and none get forgotten).
 * 3. Handles 401 / expired-token responses in ONE place: clears the stored
 *    session and bounces to /login. Before this, an expired 30-day token left
 *    the user "logged in" (the user object lives in localStorage) while every
 *    screen silently failed.
 */

let redirecting = false;

axios.interceptors.request.use((config) => {
  if (API_ORIGIN && typeof config.url === 'string' && config.url.startsWith('/api')) {
    config.url = API_ORIGIN + config.url;
  }
  const token = localStorage.getItem('token');
  if (token && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

axios.interceptors.response.use(
  (res) => res,
  (error) => {
    const status = error?.response?.status;
    const code = error?.response?.data?.code;
    const isAuthFailure = status === 401 || code === 'TOKEN_EXPIRED' || code === 'TOKEN_INVALID';

    // Don't redirect on the auth endpoints themselves (a wrong password there
    // is a normal 400/401 the form should show inline).
    const url = error?.config?.url || '';
    const isAuthEndpoint = /\/api\/(login|register|phone\/(start|verify))/.test(url);

    if (isAuthFailure && !isAuthEndpoint && !redirecting) {
      redirecting = true;
      try {
        localStorage.removeItem('token');
        localStorage.removeItem('sebenza_user');
      } catch (e) { /* ignore */ }
      const here = window.location.pathname;
      if (here !== '/login' && here !== '/' && here !== '/register') {
        window.location.assign('/login');
      } else {
        redirecting = false;
      }
    }
    return Promise.reject(error);
  }
);

export default axios;
