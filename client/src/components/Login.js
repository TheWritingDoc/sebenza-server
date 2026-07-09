import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Phone, Mail } from './Icons';

const API_URL = process.env.REACT_APP_API_URL || '';

function Login({ setUser }) {
  const [mode, setMode] = useState('phone'); // 'phone' | 'email' — phone is the low-barrier default
  const [formData, setFormData] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  // Phone flow
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [needName, setNeedName] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [stage, setStage] = useState('start'); // 'start' | 'code'
  const [code, setCode] = useState('');
  const [demoCode, setDemoCode] = useState('');
  const [info, setInfo] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    const el = document.getElementById(mode === 'email' ? 'login-email' : 'login-phone');
    if (el) el.focus();
  }, [mode]);

  const finishLogin = (data) => {
    localStorage.setItem('token', data.token);
    localStorage.setItem('sebenza_user', JSON.stringify(data.user));
    setUser(data.user);
    navigate('/dashboard');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await axios.post(`${API_URL}/api/login`, formData, { withCredentials: true });
      finishLogin(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const phoneStart = async (e) => {
    e.preventDefault();
    setLoading(true); setError(''); setInfo('');
    if (needName && !acceptTerms) { setError('Please accept the Terms and Privacy Policy'); setLoading(false); return; }
    try {
      const res = await axios.post(`${API_URL}/api/phone/start`, { phone, name, acceptTerms });
      if (res.data.demo && res.data.code) setDemoCode(res.data.code);
      setStage('code');
      setInfo(res.data.newUser ? 'Welcome! Enter the code to activate your account.' : 'Enter the code we sent to your phone.');
    } catch (err) {
      const code = err.response?.data?.error;
      if (code === 'NEW_USER_NAME_REQUIRED' || code === 'TERMS_REQUIRED') {
        setNeedName(true);
        setInfo('New number — add your name and accept the terms to create your account.');
      } else {
        setError(err.response?.data?.error || 'Could not send the code');
      }
    }
    setLoading(false);
  };

  const phoneVerify = async (e) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const res = await axios.post(`${API_URL}/api/phone/verify`, { phone, code });
      finishLogin(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Verification failed');
    }
    setLoading(false);
  };

  const tabCls = (active) =>
    `flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all ${
      active ? 'bg-white text-blue-700 shadow' : 'text-gray-500'
    }`;

  return (
    <div className="max-w-md mx-auto p-4 sm:p-6">
      <div className="bg-white rounded-2xl shadow-lg p-6 sm:p-8">
        <div className="text-center mb-5">
          <img src="/logo-icon.png" alt="Sebenza" className="mx-auto mb-3" style={{ width: 56, height: 56, borderRadius: 14 }} />
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900">Welcome</h2>
          <p className="text-gray-600 mt-1 text-sm">All you need is your name and cell number</p>
        </div>

        {/* Mode switch */}
        <div className="flex gap-1 bg-gray-100 rounded-2xl p-1 mb-5">
          <button type="button" onClick={() => { setMode('phone'); setError(''); }} className={tabCls(mode === 'phone')}>
            <Phone size={15} color="currentColor" /> Cell number
          </button>
          <button type="button" onClick={() => { setMode('email'); setError(''); }} className={tabCls(mode === 'email')}>
            <Mail size={15} color="currentColor" /> Email
          </button>
        </div>

        {error && (
          <div className="bg-red-100 text-red-700 p-3 rounded-xl mb-4 text-sm font-medium">{error}</div>
        )}
        {info && !error && (
          <div className="bg-blue-50 text-blue-700 p-3 rounded-xl mb-4 text-sm font-medium">{info}</div>
        )}

        {mode === 'phone' && stage === 'start' && (
          <form onSubmit={phoneStart} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Cell number</label>
              <input
                id="login-phone"
                type="tel"
                autoComplete="tel"
                className="w-full p-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all text-sm"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="071 234 5678"
                required
              />
            </div>
            {needName && (
              <>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Your name</label>
                  <input
                    type="text"
                    autoComplete="name"
                    className="w-full p-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all text-sm"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Thabo Mokoena"
                    required
                  />
                </div>
                <label className="flex items-start gap-3 bg-gray-50 rounded-xl p-3 cursor-pointer">
                  <input type="checkbox" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)}
                    className="mt-0.5 w-5 h-5 flex-shrink-0 accent-blue-600" />
                  <span className="text-xs text-gray-600 leading-relaxed">
                    I am 18 or older and agree to the{' '}
                    <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-blue-600 font-semibold underline">Terms</a>
                    {' '}and{' '}
                    <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-blue-600 font-semibold underline">Privacy Policy</a>.
                  </span>
                </label>
              </>
            )}
            <button
              type="submit"
              className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 disabled:bg-gray-400 transition-all text-sm"
              disabled={loading}
            >
              {loading ? 'Sending code…' : needName ? 'Create Account & Send Code' : 'Send Me a Code'}
            </button>
            <p className="text-xs text-gray-400 text-center">
              New here? Same button — we'll set you up in seconds. Add your email, photo and ID later to earn trust stars.
            </p>
          </form>
        )}

        {mode === 'phone' && stage === 'code' && (
          <form onSubmit={phoneVerify} className="space-y-4">
            {demoCode && (
              <div className="p-3 rounded-xl bg-amber-50 text-amber-700 text-center text-sm">
                Demo mode — your code is <strong>{demoCode}</strong>
              </div>
            )}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">6-digit code sent to {phone}</label>
              <input
                inputMode="numeric"
                maxLength={6}
                className="w-full p-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 text-center tracking-widest text-lg"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="000000"
                required
              />
            </div>
            <button
              type="submit"
              className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 disabled:bg-gray-400 transition-all text-sm"
              disabled={loading}
            >
              {loading ? 'Verifying…' : 'Verify & Sign In'}
            </button>
            <button
              type="button"
              onClick={(e) => { setStage('start'); setCode(''); setDemoCode(''); }}
              className="w-full text-blue-600 py-2 text-sm font-semibold"
            >
              Change number / resend
            </button>
          </form>
        )}

        {mode === 'email' && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Email</label>
              <input
                id="login-email"
                type="email"
                autoComplete="email"
                className="w-full p-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all text-sm"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="you@example.com"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  className="w-full p-3 pr-12 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all text-sm"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder="••••••••"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs font-semibold px-2 py-1 rounded-lg hover:bg-gray-100 transition-all"
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 disabled:bg-gray-400 transition-all text-sm"
              disabled={loading}
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        )}

        <div className="mt-4 text-center">
          <p className="text-xs text-gray-400">🔒 You'll stay signed in on this device for 30 days</p>
        </div>

        <p className="text-center mt-6 text-gray-600 text-sm">
          Prefer the full signup?{' '}
          <Link to="/register" className="text-blue-600 font-semibold hover:underline">
            Join with email
          </Link>
        </p>
      </div>
    </div>
  );
}

export default Login;
