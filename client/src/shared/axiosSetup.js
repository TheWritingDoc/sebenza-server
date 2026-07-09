import axios from 'axios';

/**
 * Global axios setup, imported once at app entry.
 *
 * 1. Attaches the JWT to every request from localStorage (so individual call
 *    sites don't each rebuild the auth header — and none get forgotten).
 * 2. Handles 401 / expired-token responses in ONE place: clears the stored
 *    session and bounces to /login. Before this, an expired 30-day token left
 *    the user "logged in" (the user object lives in localStorage) while every
 *    screen silently failed.
 */

let redirecting = false;

axios.interceptors.request.use((config) => {
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
        localStorage.removeItem('gshop_user');
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
