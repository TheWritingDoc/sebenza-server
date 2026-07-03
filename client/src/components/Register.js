import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || '';

const SA_CITIES = [
  { name: 'Johannesburg', lat: -26.2041, lng: 28.0473 },
  { name: 'Cape Town', lat: -33.9249, lng: 18.4241 },
  { name: 'Durban', lat: -29.8587, lng: 31.0218 },
  { name: 'Pretoria', lat: -25.7479, lng: 28.2293 },
  { name: 'Gqeberha (PE)', lat: -33.9608, lng: 25.6022 },
  { name: 'Bloemfontein', lat: -29.0852, lng: 26.1596 },
  { name: 'East London', lat: -33.0153, lng: 27.9116 },
  { name: 'Kimberley', lat: -28.7282, lng: 24.7499 },
];

const ACCOUNT_TYPES = [
  { key: 'individual', icon: '🙋', title: 'Just Me', desc: 'I work on my own — odd jobs, errands, helping out' },
  { key: 'team', icon: '👥', title: 'Small Team', desc: '2+ of us work together — e.g. garden crew, movers' },
  { key: 'business', icon: '🏢', title: 'Business', desc: 'Registered pro — plumber, electrician, builder' },
];

function Register({ setUser }) {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({ name: '', email: '', password: '' });
  const [accountType, setAccountType] = useState('individual');
  const [businessName, setBusinessName] = useState('');
  const [teamSize, setTeamSize] = useState(2);
  const [location, setLocation] = useState(null);
  const [locationMode, setLocationMode] = useState('detecting');
  const [selectedCity, setSelectedCity] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const referralCode = searchParams.get('ref') || '';

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setLocation({ lat: position.coords.latitude, lng: position.coords.longitude });
          setLocationMode('gps');
        },
        () => { setLocationMode('manual'); },
        { timeout: 8000 }
      );
    } else {
      setLocationMode('manual');
    }
  }, []);

  const handleCitySelect = (cityName) => {
    const city = SA_CITIES.find(c => c.name === cityName);
    if (city) {
      setLocation({ lat: city.lat, lng: city.lng });
      setSelectedCity(cityName);
    }
  };

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email);

  const canProceed = () => {
    if (step === 1) return formData.name.trim().length >= 2 && emailOk && formData.password.length >= 6;
    if (step === 2) return accountType === 'individual' || businessName.trim().length >= 2;
    if (step === 3) return !!location;
    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!location) { setError('Please select your city'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await axios.post(`${API_URL}/api/register`, {
        ...formData,
        location,
        ref: referralCode,
        accountType,
        businessName: accountType === 'individual' ? '' : businessName,
        teamSize: accountType === 'team' ? teamSize : 1
      }, {
        withCredentials: true
      });
      localStorage.setItem('token', res.data.token);
      localStorage.setItem('sebenza_user', JSON.stringify(res.data.user));
      setUser(res.data.user);
      navigate('/dashboard');
    } catch (err) {
      const data = err.response?.data;
      const detail = Array.isArray(data?.details) ? data.details[0]?.msg : null;
      setError(detail || data?.error || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const progress = (step / 3) * 100;

  return (
    <div className="max-w-lg mx-auto p-4 sm:p-6">
      <div className="bg-white rounded-2xl shadow-lg p-5 sm:p-8">
        <div className="text-center mb-6">
          <img src="/logo-icon.png" alt="Sebenza" className="mx-auto mb-3" style={{ width: 56, height: 56, borderRadius: 14 }} />
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900">Create Account</h2>
          <p className="text-gray-600 mt-1 text-sm">Join Sebenza — find help and work nearby</p>
        </div>

        {/* Progress */}
        <div className="mb-6">
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-blue-600 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
          <div className="flex justify-between text-xs text-gray-400 mt-1">
            <span className={step >= 1 ? 'text-blue-600 font-semibold' : ''}>Account</span>
            <span className={step >= 2 ? 'text-blue-600 font-semibold' : ''}>Who's working</span>
            <span className={step >= 3 ? 'text-blue-600 font-semibold' : ''}>Location</span>
          </div>
        </div>

        {error && <div className="bg-red-100 text-red-700 p-3 rounded-xl mb-4 text-sm">{error}</div>}

        {/* STEP 1: Just the essentials */}
        {step === 1 && (
          <div className="space-y-4 animate-fadeIn">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Your Name</label>
              <input type="text" autoComplete="name" className="w-full p-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 text-sm"
                value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})}
                placeholder="e.g. Thabo Mokoena" required />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Email</label>
              <input type="email" autoComplete="email" className="w-full p-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 text-sm"
                value={formData.email} onChange={(e) => setFormData({...formData, email: e.target.value})}
                placeholder="you@example.com" required />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Password</label>
              <input type="password" autoComplete="new-password" className="w-full p-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 text-sm"
                value={formData.password} onChange={(e) => setFormData({...formData, password: e.target.value})}
                placeholder="Min 6 characters" required minLength="6" />
            </div>

            <div className="bg-amber-50 rounded-xl p-3 text-xs text-amber-800">
              ⭐ That's all you need to start! Add your photo, phone and ID later to earn <strong>trust stars</strong> and win more jobs.
            </div>

            <button type="button"
              onClick={() => canProceed() && setStep(2)}
              disabled={!canProceed()}
              className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 disabled:bg-gray-300 transition-all text-sm">
              Next →
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* Hidden inputs so form submission carries data when Enter is pressed in step 3 */}
          <input type="hidden" name="name" value={formData.name} />
          <input type="hidden" name="email" value={formData.email} />
          <input type="hidden" name="password" value={formData.password} />

          {/* STEP 2: Account type */}
          {step === 2 && (
            <div className="space-y-4 animate-fadeIn">
              <label className="block text-sm font-semibold text-gray-700">How will you use Sebenza?</label>
              <div className="space-y-2">
                {ACCOUNT_TYPES.map(t => (
                  <button key={t.key} type="button" onClick={() => setAccountType(t.key)}
                    className={`w-full flex items-center gap-3 p-4 rounded-2xl border-2 text-left transition-all ${
                      accountType === t.key ? 'border-blue-500 bg-blue-50' : 'border-gray-100 bg-white hover:border-gray-200'
                    }`}>
                    <span className="text-2xl flex-shrink-0">{t.icon}</span>
                    <span className="flex-1">
                      <span className={`block text-sm font-bold ${accountType === t.key ? 'text-blue-700' : 'text-gray-900'}`}>{t.title}</span>
                      <span className="block text-xs text-gray-500 mt-0.5">{t.desc}</span>
                    </span>
                    <span className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                      accountType === t.key ? 'border-blue-500 bg-blue-500' : 'border-gray-300'
                    }`}>
                      {accountType === t.key && <span className="w-2 h-2 bg-white rounded-full" />}
                    </span>
                  </button>
                ))}
              </div>

              {accountType !== 'individual' && (
                <div className="space-y-3 animate-fadeIn">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">
                      {accountType === 'team' ? 'Team Name' : 'Business Name'}
                    </label>
                    <input type="text" className="w-full p-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 text-sm"
                      value={businessName} onChange={(e) => setBusinessName(e.target.value)}
                      placeholder={accountType === 'team' ? 'e.g. Soweto Garden Crew' : 'e.g. Mokoena Plumbing (Pty) Ltd'} />
                  </div>
                  {accountType === 'team' && (
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">How many of you?</label>
                      <div className="flex gap-2">
                        {[2, 3, 4, 5].map(n => (
                          <button key={n} type="button" onClick={() => setTeamSize(n)}
                            className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition-all ${
                              teamSize === n ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'
                            }`}>{n}{n === 5 ? '+' : ''}</button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-3">
                <button type="button" onClick={() => setStep(1)}
                  className="flex-1 bg-gray-100 text-gray-700 py-3 rounded-xl font-semibold hover:bg-gray-200 transition-all text-sm">
                  ← Back
                </button>
                <button type="button" onClick={() => setStep(3)}
                  disabled={!canProceed()}
                  className="flex-[2] bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 disabled:bg-gray-300 transition-all text-sm">
                  Next →
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: Location + confirm */}
          {step === 3 && (
            <div className="space-y-4 animate-fadeIn">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Location</label>
                {locationMode === 'detecting' && (
                  <div className="bg-blue-50 text-blue-700 p-3 rounded-xl text-sm">📍 Detecting your location...</div>
                )}
                {locationMode === 'gps' && (
                  <div className="bg-green-100 text-green-700 p-3 rounded-xl text-sm flex items-center gap-2">
                    <span>✅</span> Location detected automatically
                  </div>
                )}
                {locationMode === 'manual' && (
                  <div>
                    <div className="bg-yellow-50 text-yellow-800 p-2 rounded-xl mb-2 text-xs">
                      📍 GPS unavailable — select your city:
                    </div>
                    <select className="w-full p-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 text-sm"
                      value={selectedCity} onChange={(e) => handleCitySelect(e.target.value)}>
                      <option value="">-- Select your city --</option>
                      {SA_CITIES.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                    </select>
                    {selectedCity && <p className="text-green-600 text-xs mt-1">✅ Location set to {selectedCity}</p>}
                  </div>
                )}
              </div>

              {/* Summary */}
              <div className="bg-gray-50 rounded-xl p-4 space-y-2">
                <h3 className="font-semibold text-gray-900 text-sm">Quick check</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="text-gray-500">Name</div>
                  <div className="text-gray-900 font-medium">{formData.name}</div>
                  <div className="text-gray-500">Email</div>
                  <div className="text-gray-900 font-medium break-all">{formData.email}</div>
                  <div className="text-gray-500">Account</div>
                  <div className="text-blue-600 font-medium">
                    {accountType === 'individual' ? '🙋 Just Me' : accountType === 'team' ? `👥 ${businessName}` : `🏢 ${businessName}`}
                  </div>
                  <div className="text-gray-500">Location</div>
                  <div className="text-gray-900 font-medium">{selectedCity || (locationMode === 'gps' ? 'GPS detected' : 'Not set yet')}</div>
                </div>
              </div>

              <div className="flex gap-3">
                <button type="button" onClick={() => setStep(2)}
                  className="flex-1 bg-gray-100 text-gray-700 py-3 rounded-xl font-semibold hover:bg-gray-200 transition-all text-sm">
                  ← Back
                </button>
                <button type="submit"
                  className="flex-[2] bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 disabled:bg-gray-400 transition-all text-sm"
                  disabled={loading || !canProceed()}>
                  {loading ? 'Creating...' : '🎉 Create Account'}
                </button>
              </div>
            </div>
          )}
        </form>

        <p className="text-center mt-6 text-gray-600 text-sm">
          Already have an account?{' '}
          <Link to="/login" className="text-blue-600 font-semibold hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}

export default Register;
