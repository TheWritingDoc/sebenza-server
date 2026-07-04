import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import SMSVerify from './SMSVerify';
import Verification from './Verification';
import {
  ShieldCheck, Mail, Camera, Phone, IdCard, Home as HomeIcon, Car,
  GraduationCap, Briefcase, Trophy, UserCircle, CheckCircle2
} from './Icons';

const API_URL = process.env.REACT_APP_API_URL || '';

// Identity trust ladder tops out at TEN stars.
export function TrustStars({ stars, size = 14, max = 10 }) {
  return (
    <span style={{ display: 'inline-flex', gap: 1, verticalAlign: 'middle' }} aria-label={`${stars} out of ${max} trust stars`}>
      {Array.from({ length: max }, (_, idx) => idx + 1).map(i => {
        const fill = stars >= i ? 'full' : stars >= i - 0.5 ? 'half' : 'empty';
        return (
          <span key={i} style={{ fontSize: size, lineHeight: 1, position: 'relative', color: '#e2e8f0' }}>
            ★
            {fill !== 'empty' && (
              <span style={{
                position: 'absolute', left: 0, top: 0, overflow: 'hidden',
                width: fill === 'half' ? '50%' : '100%', color: '#f59e0b',
              }}>★</span>
            )}
          </span>
        );
      })}
    </span>
  );
}

const ITEM_META = {
  account:       { Icon: CheckCircle2,  hint: 'Done — welcome to the community!' },
  email:         { Icon: Mail,          hint: 'Verify your email with a code' },
  photo:         { Icon: Camera,        hint: 'Add a clear photo of your face' },
  profile:       { Icon: UserCircle,    hint: 'Bio, skills and your main category' },
  phone:         { Icon: Phone,         hint: 'Verify with a one-time SMS code' },
  id:            { Icon: IdCard,        hint: 'ID card front + back + selfie — biggest boost' },
  address:       { Icon: HomeIcon,      hint: 'Utility bill or bank letter' },
  license:       { Icon: Car,           hint: "Photo of your driver's licence card" },
  qualification: { Icon: GraduationCap, hint: 'Certificate, trade ticket or diploma' },
  experience:    { Icon: Briefcase,     hint: 'Tell neighbours what you’ve done before' },
  firstJob:      { Icon: Trophy,        hint: 'Complete your first job on the app' },
};

function DocUpload({ docType, label, onDone }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const token = localStorage.getItem('token');

  const pick = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const submit = async () => {
    if (!file) { setMessage('Please add a photo of your document'); return; }
    setLoading(true);
    setMessage('');
    try {
      const data = new FormData();
      data.append('trustDoc', file);
      data.append('docType', docType);
      data.append('title', title);
      await axios.post(`${API_URL}/api/users/trust-docs`, data, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'multipart/form-data' }
      });
      setMessage('✅ Uploaded! Your trust score has been updated.');
      setTimeout(onDone, 1200);
    } catch (err) {
      setMessage(err.response?.data?.error || 'Upload failed');
    }
    setLoading(false);
  };

  return (
    <div className="space-y-4">
      {message && (
        <div className={`p-3 rounded-xl text-center text-sm font-medium ${message.startsWith('✅') ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
          {message}
        </div>
      )}
      {docType === 'qualification' && (
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">What is it? <span className="text-gray-400 font-normal">(optional)</span></label>
          <input value={title} onChange={e => setTitle(e.target.value)}
            className="w-full p-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 text-sm"
            placeholder="e.g. Plumbing Trade Certificate" />
        </div>
      )}
      <div className="border-2 border-dashed border-gray-300 rounded-xl p-5 text-center hover:border-blue-500 transition-colors">
        <input type="file" accept="image/*" onChange={pick} className="hidden" id={`doc-${docType}`} />
        <label htmlFor={`doc-${docType}`} className="cursor-pointer block">
          {preview ? (
            <img src={preview} alt="Document preview" className="w-full max-h-44 object-contain rounded-lg mb-2" />
          ) : (
            <>
              <div className="text-3xl mb-1">📄</div>
              <p className="text-gray-600 text-sm font-medium">Tap to add a photo of your {label.toLowerCase()}</p>
            </>
          )}
          <p className="text-gray-400 text-xs mt-1">{preview ? 'Tap to change' : 'JPG or PNG, up to 15MB'}</p>
        </label>
      </div>
      <button onClick={submit} disabled={loading || !file}
        className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 disabled:bg-gray-300 transition-all text-sm">
        {loading ? 'Uploading...' : 'Submit Document'}
      </button>
    </div>
  );
}

function ProfileStep({ user, setUser, onDone }) {
  const stored = (() => { try { return JSON.parse(localStorage.getItem('sebenza_user') || '{}'); } catch { return {}; } })();
  const me = { ...stored, ...(user || {}) };
  const [bio, setBio] = useState(me.bio || '');
  const [skills, setSkills] = useState(Array.isArray(me.skills) ? me.skills.join(', ') : '');
  const [category, setCategory] = useState(me.primaryCategory || '');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const token = localStorage.getItem('token');

  const submit = async () => {
    if (!bio.trim() || !skills.trim() || !category.trim()) {
      setMessage('Please fill in your bio, at least one skill, and your main category.');
      return;
    }
    setLoading(true); setMessage('');
    try {
      const id = me._id || me.id;
      const res = await axios.put(`${API_URL}/api/users/${id}`, {
        bio, skills, primaryCategory: category
      }, { headers: { Authorization: `Bearer ${token}` } });
      if (setUser) {
        const updated = { ...me, bio: res.data.bio, skills: res.data.skills, primaryCategory: res.data.primaryCategory };
        setUser(updated);
        localStorage.setItem('sebenza_user', JSON.stringify(updated));
      }
      setMessage('✅ Profile saved! Your trust score has been updated.');
      setTimeout(onDone, 1100);
    } catch (err) {
      setMessage(err.response?.data?.error || 'Could not save your profile');
    }
    setLoading(false);
  };

  return (
    <div className="space-y-4">
      {message && (
        <div className={`p-3 rounded-xl text-center text-sm font-medium ${message.startsWith('✅') ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
          {message}
        </div>
      )}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1">About you *</label>
        <textarea value={bio} onChange={e => setBio(e.target.value)} rows={3} maxLength={600}
          className="w-full p-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 text-sm"
          placeholder="e.g. Reliable painter and handyman from Gqeberha, 8 years experience." />
      </div>
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1">Your skills * <span className="text-gray-400 font-normal">(comma separated)</span></label>
        <input value={skills} onChange={e => setSkills(e.target.value)}
          className="w-full p-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 text-sm"
          placeholder="Painting, Tiling, Garden care" />
      </div>
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1">Main category *</label>
        <input value={category} onChange={e => setCategory(e.target.value)}
          className="w-full p-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 text-sm"
          placeholder="e.g. Painting" />
      </div>
      <button onClick={submit} disabled={loading}
        className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 disabled:bg-gray-300 transition-all text-sm">
        {loading ? 'Saving...' : 'Save Profile'}
      </button>
    </div>
  );
}

function SelfieUpload({ user, setUser, onDone }) {
  const [preview, setPreview] = useState(null);
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const token = localStorage.getItem('token');

  const pick = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const submit = async () => {
    if (!file) { setMessage('Please take or choose a photo of yourself'); return; }
    setLoading(true); setMessage('');
    try {
      const data = new FormData();
      data.append('profileImage', file);
      const res = await axios.post(`${API_URL}/api/users/profile-image`, data, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'multipart/form-data' }
      });
      if (setUser && user) {
        const updated = { ...user, profileImage: res.data.imageUrl };
        setUser(updated);
        localStorage.setItem('sebenza_user', JSON.stringify(updated));
      }
      setMessage('✅ Photo added! Your trust score has been updated.');
      setTimeout(onDone, 1100);
    } catch (err) {
      setMessage(err.response?.data?.error || 'Upload failed');
    }
    setLoading(false);
  };

  return (
    <div className="space-y-4">
      {message && (
        <div className={`p-3 rounded-xl text-center text-sm font-medium ${message.startsWith('✅') ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
          {message}
        </div>
      )}
      <div className="border-2 border-dashed border-gray-300 rounded-xl p-5 text-center hover:border-blue-500 transition-colors">
        <input type="file" accept="image/*" capture="user" onChange={pick} className="hidden" id="selfie-input" />
        <label htmlFor="selfie-input" className="cursor-pointer block">
          {preview ? (
            <img src={preview} alt="Your face" className="w-32 h-32 object-cover rounded-full mx-auto mb-2" />
          ) : (
            <>
              <div className="text-3xl mb-1">🤳</div>
              <p className="text-gray-600 text-sm font-medium">Tap to take a photo of yourself</p>
            </>
          )}
          <p className="text-gray-400 text-xs mt-1">{preview ? 'Tap to retake' : 'A clear face photo helps neighbours recognise you'}</p>
        </label>
      </div>
      <button onClick={submit} disabled={loading || !file}
        className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 disabled:bg-gray-300 transition-all text-sm">
        {loading ? 'Uploading...' : 'Save My Photo'}
      </button>
    </div>
  );
}

function ExperienceForm({ onDone }) {
  const [title, setTitle] = useState('');
  const [place, setPlace] = useState('');
  const [years, setYears] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const token = localStorage.getItem('token');

  const submit = async () => {
    if (!title.trim()) { setMessage('Please describe the work you did'); return; }
    setLoading(true);
    setMessage('');
    try {
      await axios.post(`${API_URL}/api/users/work-experience`, { title, place, years }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setMessage('✅ Experience added!');
      setTimeout(onDone, 1000);
    } catch (err) {
      setMessage(err.response?.data?.error || 'Failed to save');
    }
    setLoading(false);
  };

  return (
    <div className="space-y-4">
      {message && (
        <div className={`p-3 rounded-xl text-center text-sm font-medium ${message.startsWith('✅') ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
          {message}
        </div>
      )}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1">What did you do? *</label>
        <input value={title} onChange={e => setTitle(e.target.value)}
          className="w-full p-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 text-sm"
          placeholder="e.g. Gardener for a complex in Sandton" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Where? <span className="text-gray-400 font-normal">(opt)</span></label>
          <input value={place} onChange={e => setPlace(e.target.value)}
            className="w-full p-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 text-sm"
            placeholder="Company / area" />
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">How long? <span className="text-gray-400 font-normal">(opt)</span></label>
          <input value={years} onChange={e => setYears(e.target.value)}
            className="w-full p-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 text-sm"
            placeholder="e.g. 3 years" />
        </div>
      </div>
      <button onClick={submit} disabled={loading}
        className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 disabled:bg-gray-300 transition-all text-sm">
        {loading ? 'Saving...' : 'Add Experience'}
      </button>
    </div>
  );
}

function EmailStep({ onDone }) {
  const [stage, setStage] = useState('send'); // 'send' | 'code'
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [demoCode, setDemoCode] = useState('');
  const token = localStorage.getItem('token');

  const sendCode = async () => {
    setLoading(true); setMessage('');
    try {
      const res = await axios.post(`${API_URL}/api/users/send-email-code`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.data.alreadyVerified) { onDone(); return; }
      if (res.data.demo && res.data.code) setDemoCode(res.data.code);
      setStage('code');
      setMessage(res.data.demo ? '' : '✅ Code sent — check your inbox.');
    } catch (err) {
      setMessage(err.response?.data?.error || 'Could not send the code');
    }
    setLoading(false);
  };

  const verify = async () => {
    if (code.replace(/\D/g, '').length !== 6) { setMessage('Enter the 6-digit code'); return; }
    setLoading(true); setMessage('');
    try {
      await axios.post(`${API_URL}/api/users/verify-email-code`, { code }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setMessage('✅ Email verified!');
      setTimeout(onDone, 900);
    } catch (err) {
      setMessage(err.response?.data?.error || 'Verification failed');
    }
    setLoading(false);
  };

  return (
    <div className="space-y-4">
      {message && (
        <div className={`p-3 rounded-xl text-center text-sm font-medium ${message.startsWith('✅') ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
          {message}
        </div>
      )}
      {stage === 'send' ? (
        <button onClick={sendCode} disabled={loading}
          className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 disabled:bg-gray-300 transition-all text-sm">
          {loading ? 'Sending...' : 'Send me a code'}
        </button>
      ) : (
        <>
          {demoCode && (
            <div className="p-3 rounded-xl bg-amber-50 text-amber-700 text-center text-sm">
              Demo mode — your code is <strong>{demoCode}</strong>
            </div>
          )}
          <input inputMode="numeric" value={code} onChange={e => setCode(e.target.value)}
            className="w-full p-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 text-center tracking-widest text-lg"
            placeholder="000000" maxLength={6} />
          <button onClick={verify} disabled={loading}
            className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 disabled:bg-gray-300 transition-all text-sm">
            {loading ? 'Verifying...' : 'Verify Email'}
          </button>
          <button onClick={sendCode} disabled={loading}
            className="w-full text-blue-600 py-2 text-sm font-semibold">
            Resend code
          </button>
        </>
      )}
    </div>
  );
}

function PhoneStep({ user, onDone }) {
  const stored = (() => { try { return JSON.parse(localStorage.getItem('sebenza_user') || localStorage.getItem('gshop_user') || '{}'); } catch { return {}; } })();
  const [phone, setPhone] = useState(stored.phone || user?.phone || '');
  const [confirmed, setConfirmed] = useState(!!(stored.phone || user?.phone));

  if (!confirmed) {
    return (
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Your phone number</label>
          <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
            className="w-full p-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 text-sm"
            placeholder="071 234 5678" />
        </div>
        <button onClick={() => phone.replace(/\D/g, '').length >= 9 && setConfirmed(true)}
          disabled={phone.replace(/\D/g, '').length < 9}
          className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 disabled:bg-gray-300 transition-all text-sm">
          Continue
        </button>
      </div>
    );
  }
  return <SMSVerify phone={phone.replace(/[\s\-()]/g, '')} onVerified={onDone} />;
}

function TrustCenter({ user, setUser }) {
  const [trust, setTrust] = useState(null);
  const [active, setActive] = useState(null); // null = checklist, else item key
  const token = localStorage.getItem('token');

  const fetchTrust = useCallback(async () => {
    try {
      const res = await axios.get(`${API_URL}/api/users/me/trust`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setTrust(res.data);
    } catch (err) {
      console.error('Trust fetch failed:', err);
    }
  }, [token]);

  useEffect(() => { fetchTrust(); }, [fetchTrust]);

  const closeStep = () => { setActive(null); fetchTrust(); };

  const handlePhoneVerified = () => {
    if (setUser && user) {
      const updated = { ...user, phoneVerified: true };
      setUser(updated);
      localStorage.setItem('sebenza_user', JSON.stringify(updated));
      localStorage.removeItem('gshop_user');
    }
    closeStep();
  };

  if (!trust) {
    return (
      <div className="max-w-lg mx-auto p-6 text-center">
        <div className="text-2xl mb-2">⏳</div>
        <p className="text-gray-600 text-sm">Loading your trust profile...</p>
      </div>
    );
  }

  // ── Focused single-task views ──
  if (active) {
    const item = trust.checklist.find(c => c.key === active);
    const meta = ITEM_META[active] || {};
    return (
      <div className="max-w-lg mx-auto p-4">
        <div className="bg-white rounded-2xl shadow-lg p-5 sm:p-6">
          <button onClick={closeStep} className="text-sm font-semibold text-gray-500 mb-4 flex items-center gap-1">
            ← Back to Trust Centre
          </button>
          <div className="text-center mb-5">
            <div className="mb-2 flex justify-center">
              {meta.Icon ? <meta.Icon size={40} color="#4f46e5" strokeWidth={1.7} /> : null}
            </div>
            <h2 className="text-xl font-bold text-gray-900">{item?.label}</h2>
            <p className="text-gray-500 text-sm mt-1">{meta.hint}</p>
          </div>

          {active === 'email' && <EmailStep onDone={closeStep} />}
          {active === 'profile' && <ProfileStep user={user} setUser={setUser} onDone={closeStep} />}
          {active === 'phone' && <PhoneStep user={user} onDone={handlePhoneVerified} />}
          {active === 'id' && <Verification embedded onStatusChange={closeStep} />}
          {active === 'address' && <DocUpload docType="address" label="Proof of address" onDone={closeStep} />}
          {active === 'license' && <DocUpload docType="drivers_license" label="Driver's licence" onDone={closeStep} />}
          {active === 'qualification' && <DocUpload docType="qualification" label="Qualification" onDone={closeStep} />}
          {active === 'experience' && <ExperienceForm onDone={closeStep} />}
          {active === 'photo' && <SelfieUpload user={user} setUser={setUser} onDone={closeStep} />}
        </div>
      </div>
    );
  }

  // ── Checklist hub ──
  return (
    <div className="max-w-lg mx-auto p-4">
      {/* Score header */}
      <div className="bg-white rounded-2xl shadow-lg p-6 mb-4 text-center">
        <div className="mb-2 flex justify-center"><ShieldCheck size={42} color="#4f46e5" strokeWidth={1.7} /></div>
        <h2 className="text-xl sm:text-2xl font-bold text-gray-900">Trust Centre</h2>
        <p className="text-gray-500 text-sm mt-1 mb-4">The more you verify, the more jobs you win</p>

        <div className="mb-1"><TrustStars stars={trust.stars} size={22} /></div>
        <div className="text-xs text-gray-400 font-semibold mb-1">{trust.stars} / 10 stars</div>
        <div className="text-sm font-bold text-amber-600 mb-3">{trust.level}</div>

        <div className="h-3 bg-gray-100 rounded-full overflow-hidden max-w-xs mx-auto">
          <div className="h-full rounded-full transition-all duration-700"
            style={{ width: `${trust.score}%`, background: 'linear-gradient(90deg, #f59e0b, #22c55e)' }} />
        </div>
        <div className="text-xs text-gray-400 mt-1 font-semibold">{trust.score}/100 trust points</div>
      </div>

      {/* Checklist */}
      <div className="space-y-2">
        {trust.checklist.map(item => {
          const meta = ITEM_META[item.key] || {};
          const clickable = !item.done && item.action;
          return (
            <button key={item.key}
              onClick={() => clickable && setActive(item.key === 'photo' ? 'photo' : item.action)}
              disabled={!clickable}
              className={`w-full flex items-center gap-3 p-4 rounded-2xl border-2 text-left transition-all ${
                item.done ? 'bg-green-50 border-green-100' : clickable ? 'bg-white border-gray-100 hover:border-blue-300 active:scale-[0.99]' : 'bg-gray-50 border-gray-100 opacity-70'
              }`}>
              <span className="flex-shrink-0 flex items-center justify-center" style={{ width: 34, height: 34, borderRadius: 10, background: item.done ? '#dcfce7' : '#eef2ff' }}>
                {item.done
                  ? <CheckCircle2 size={18} color="#16a34a" />
                  : meta.Icon ? <meta.Icon size={18} color="#4f46e5" /> : null}
              </span>
              <span className="flex-1 min-w-0">
                <span className={`block text-sm font-bold ${item.done ? 'text-green-800' : 'text-gray-900'}`}>{item.label}</span>
                <span className="block text-xs text-gray-500 mt-0.5">{item.done ? 'Completed' : meta.hint}</span>
              </span>
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full flex-shrink-0 ${item.done ? 'bg-green-100 text-green-700' : 'bg-amber-50 text-amber-600'}`}>
                +{item.points}
              </span>
              {clickable && <span className="text-gray-300 font-bold flex-shrink-0">›</span>}
            </button>
          );
        })}
      </div>

      <p className="text-center text-xs text-gray-400 mt-4 px-4">
        Your documents are stored securely and only used to verify your identity. Star ratings show on your public profile.
      </p>
    </div>
  );
}

export default TrustCenter;
