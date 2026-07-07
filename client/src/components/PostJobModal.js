import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import { categoryEmojis, categoryGradients, categoryPriceHints, jobCategories, modalOverlayStyle } from '../shared/constants';
import { compressImages } from '../utils/imageCompression';

const API_URL = process.env.REACT_APP_API_URL || '';

const suggestedTitles = {
  'House Cleaning': ['Clean my house', 'Help clean my apartment', 'Deep clean needed'],
  'Yard Work': ['Mow my lawn', 'Clean up my yard', 'Rake leaves and tidy up'],
  'Car Wash': ['Wash my car', 'Car needs a good clean', 'Quick car wash at home'],
  'Dog Walking': ['Walk my dog', 'Dog walker needed today', 'Take my dog for a walk'],
  'Laundry': ['Wash and fold my clothes', 'Laundry help needed', 'Iron my shirts'],
  'Braai / BBQ': ['Braai master needed', 'Help me braai for guests', 'Grill at my party'],
  'Haircut': ['Need a haircut at home', 'Trim my hair please', 'Home barber needed'],
  'Errands': ['Run errands for me', 'Pick up groceries', 'Deliver a package'],
  'Pet Wash': ['Wash my dog', 'Dog bath at home', 'Groom my pet'],
  'Shoe Cleaning': ['Clean my sneakers', 'Shoe shine needed', 'Wash my work shoes'],
  'Moving Help': ['Help me move furniture', 'Moving boxes need lifting', 'Assist with small move'],
  'Furniture Assembly': ['Assemble my bookshelf', 'Put together my table', 'Build my IKEA furniture'],
  'Gardening': ['Water my plants', 'Plant flowers in my garden', 'Weed my garden beds'],
  'Babysitting': ['Babysit my kids tonight', 'Watch my toddler', 'Child minder needed'],
  'Cooking': ['Cook a meal for me', 'Meal prep help', 'Bake a cake for my party'],
  'Plumbing': ['Fix leaking tap', 'Unblock my drain', 'Toilet needs fixing'],
  'Electrical': ['Fix a light switch', 'Install a new plug', 'Check my wiring'],
  'Tech Help': ['Set up my TV', 'Fix my WiFi', 'Help with my laptop'],
  'Tutoring': ['Math tutor needed', 'Help my child with homework', 'Teach me guitar basics'],
  'Other': ['Help with a small task', 'Need a hand with something', 'Odd job around the house'],
};

// ── South African time helpers ──
// Africa/Johannesburg is UTC+2 all year (no DST), so SA wall-clock time can be
// derived without Intl timezone gymnastics: shift the epoch and read UTC parts.
const SA_OFFSET_MS = 2 * 60 * 60 * 1000;
const pad = (n) => String(n).padStart(2, '0');

function saNowParts() {
  const shifted = new Date(Date.now() + SA_OFFSET_MS);
  return {
    hours: shifted.getUTCHours(),
    minutes: shifted.getUTCMinutes(),
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
  };
}

// Convert an SA wall-clock time (today + addDays) to a real instant.
function saTimeToInstant(hours, minutes, addDays = 0) {
  const n = saNowParts();
  return new Date(Date.UTC(n.year, n.month, n.day + addDays, hours, minutes) - SA_OFFSET_MS);
}

// Live SA clock + future-only time picker. Picking a time that already passed
// today automatically schedules it for tomorrow — the past is unpickable.
function SATimePicker({ value, onChange, hasError }) {
  const [now, setNow] = useState(saNowParts());
  useEffect(() => {
    const t = setInterval(() => setNow(saNowParts()), 10000);
    return () => clearInterval(t);
  }, []);

  const [hours, minutes] = value ? value.split(':').map(Number) : [12, 0];
  const safeHours = isNaN(hours) ? 12 : hours;
  const safeMinutes = isNaN(minutes) ? 0 : minutes;

  const setHours = (h) => onChange(`${pad(((h % 24) + 24) % 24)}:${pad(safeMinutes)}`);
  const setMinutes = (m) => {
    // step through quarter hours for fewer taps
    const next = ((m % 60) + 60) % 60;
    onChange(`${pad(safeHours)}:${pad(next)}`);
  };

  const pickedInstant = saTimeToInstant(safeHours, safeMinutes);
  const isTomorrow = pickedInstant.getTime() <= Date.now();

  const arrowBtn = {
    width: 48, height: 36, borderRadius: 10, border: '1px solid #e2e8f0',
    background: '#f8fafc', color: '#475569', fontSize: 17, fontWeight: 700,
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    userSelect: 'none', WebkitUserSelect: 'none',
  };
  const digitStyle = {
    fontFamily: '"SF Mono", Monaco, "Roboto Mono", Consolas, monospace',
    fontSize: 44, fontWeight: 700, color: hasError ? '#dc2626' : '#1e293b',
    lineHeight: 1, letterSpacing: 2, minWidth: 64, textAlign: 'center',
  };

  return (
    <div style={{
      borderRadius: 16, border: hasError ? '2px solid #ef4444' : '1px solid #e2e8f0',
      background: hasError ? '#fef2f2' : '#fafbfc', padding: '12px 0 14px',
    }}>
      <div style={{ textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 10 }}>
        🇿🇦 Now in South Africa: <span style={{ color: '#0f172a', fontFamily: 'monospace', fontSize: 14 }}>{pad(now.hours)}:{pad(now.minutes)}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <button type="button" style={arrowBtn} onClick={() => setHours(safeHours + 1)}>▲</button>
          <span style={digitStyle}>{pad(safeHours)}</span>
          <button type="button" style={arrowBtn} onClick={() => setHours(safeHours - 1)}>▼</button>
        </div>
        <span style={{ ...digitStyle, minWidth: 'auto', color: '#94a3b8' }}>:</span>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <button type="button" style={arrowBtn} onClick={() => setMinutes(safeMinutes + 15)}>▲</button>
          <span style={digitStyle}>{pad(safeMinutes)}</span>
          <button type="button" style={arrowBtn} onClick={() => setMinutes(safeMinutes - 15)}>▼</button>
        </div>
      </div>
      <div style={{
        textAlign: 'center', marginTop: 10, fontSize: 12, fontWeight: 700,
        color: isTomorrow ? '#b45309' : '#166534',
      }}>
        {isTomorrow ? `⏭ That time has passed today — scheduled for TOMORROW ${pad(safeHours)}:${pad(safeMinutes)}` : `✅ Today at ${pad(safeHours)}:${pad(safeMinutes)}`}
      </div>
    </div>
  );
}

function Toggle({ on, onFlip, activeColor = '#6366f1' }) {
  return (
    <button type="button" onClick={onFlip} aria-pressed={on} style={{
      position: 'relative', width: 48, height: 26, borderRadius: 13, border: 'none',
      background: on ? activeColor : '#cbd5e1', cursor: 'pointer',
      transition: 'background 0.2s ease', padding: 0, flexShrink: 0,
    }}>
      <span style={{
        position: 'absolute', top: 3, left: on ? 25 : 3, width: 20, height: 20,
        borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        transition: 'left 0.2s ease', display: 'block',
      }} />
    </button>
  );
}

function PostJobModal({ user, onClose, onPosted }) {
  const [step, setStep] = useState(1);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [price, setPrice] = useState('');
  const [isUrgent, setIsUrgent] = useState(false);
  const [estimatedDuration, setEstimatedDuration] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  // Default to the next full hour in SA time so the picker always starts valid
  // and in the future.
  const [proposedTimeOfDay, setProposedTimeOfDay] = useState(() => {
    const n = saNowParts();
    return `${pad((n.hours + 1) % 24)}:00`;
  });
  const [timeIsNegotiable, setTimeIsNegotiable] = useState(true);
  const [postingMode, setPostingMode] = useState('immediate'); // 'immediate' | 'scheduled'
  const [publishAt, setPublishAt] = useState('');
  const [images, setImages] = useState([]);
  const [imagePreviews, setImagePreviews] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const sheetRef = useRef(null);
  const titleSectionRef = useRef(null);

  const token = localStorage.getItem('token');
  const hint = category ? categoryPriceHints[category] : null;

  useEffect(() => {
    // No keyboard popup on step change; scroll to top so the user starts at
    // the first field of the new step.
    const timer = setTimeout(() => {
      if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
        document.activeElement.blur();
      }
      sheetRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }, 50);
    return () => clearTimeout(timer);
  }, [step]);

  useEffect(() => {
    if (error) sheetRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [error]);

  const handleImageChange = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length + images.length > 5) { alert('Maximum 5 photos allowed'); return; }
    setLoading(true);
    try {
      const compressed = await compressImages(files, 1200, 0.85);
      setImages(prev => [...prev, ...compressed].slice(0, 5));
      setImagePreviews(prev => [...prev, ...compressed.map(f => URL.createObjectURL(f))].slice(0, 5));
    } catch {
      setImages(prev => [...prev, ...files].slice(0, 5));
      setImagePreviews(prev => [...prev, ...files.map(f => URL.createObjectURL(f))].slice(0, 5));
    } finally {
      setLoading(false);
    }
  };

  const removeImage = (idx) => {
    setImages(prev => prev.filter((_, i) => i !== idx));
    setImagePreviews(prev => prev.filter((_, i) => i !== idx));
  };

  const getLocation = () => new Promise((resolve) => {
    if (user?.location?.lat && user?.location?.lng) {
      resolve({ lat: user.location.lat, lng: user.location.lng });
      return;
    }
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve(null),
        { timeout: 8000 }
      );
    } else {
      resolve(null);
    }
  });

  const handleNext = () => {
    const errs = {};
    const errMsgs = [];
    if (!category) { errs.category = true; errMsgs.push('Pick a category'); }
    if (!title.trim()) { errs.title = true; errMsgs.push('Enter a job title'); }
    const p = parseFloat(price);
    if (isNaN(p) || p <= 0) { errs.price = true; errMsgs.push('Set a price'); }
    if (errMsgs.length) {
      setFieldErrors(errs);
      setError(errMsgs.join(' • '));
      return;
    }
    setFieldErrors({});
    setError('');
    setStep(2);
  };

  const handleBack = () => {
    setError('');
    setFieldErrors({});
    setStep(1);
  };

  const handleSubmit = async () => {
    const errs = {};
    if (!proposedTimeOfDay) errs.proposedTime = true;
    const p = parseFloat(price);
    if (isNaN(p) || p <= 0) errs.price = true;
    if (postingMode === 'scheduled' && !publishAt) errs.publishAt = true;
    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      setError('Please fill in all required fields');
      return;
    }
    setFieldErrors({});
    setLoading(true);
    setError('');
    try {
      const loc = await getLocation();

      // SA wall-clock → instant; past times roll to tomorrow (future-only).
      const [h, m] = proposedTimeOfDay.split(':').map(Number);
      let workInstant = saTimeToInstant(h, m);
      if (workInstant.getTime() <= Date.now()) {
        workInstant = saTimeToInstant(h, m, 1);
      }

      const formData = new FormData();
      formData.append('title', title);
      // Description field was removed from the form — the title carries the
      // whole message now, and the server requires description to be set.
      formData.append('description', title);
      formData.append('category', category);
      formData.append('budget', String(p));
      formData.append('budgetMin', String(p));
      formData.append('isUrgent', isUrgent);
      if (estimatedDuration) formData.append('estimatedDuration', estimatedDuration);
      formData.append('paymentMethod', paymentMethod);
      formData.append('proposedTime', workInstant.toISOString());
      formData.append('timeIsNegotiable', timeIsNegotiable);
      if (loc) {
        formData.append('lat', String(loc.lat));
        formData.append('lng', String(loc.lng));
      }
      if (postingMode === 'scheduled' && publishAt) {
        formData.append('publishAt', new Date(publishAt).toISOString());
      }
      images.forEach(img => formData.append('images', img));

      const response = await axios.post(`${API_URL}/api/jobs`, formData, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'multipart/form-data' },
        withCredentials: true,
        onUploadProgress: (ev) => {
          const pct = ev.total ? Math.round((ev.loaded * 100) / ev.total) : 0;
          setUploadProgress(pct);
        }
      });

      if (response.data && response.data.job) {
        onPosted(response.data.job);
      } else {
        onPosted();
      }
    } catch (err) {
      console.error('Post job error:', err);
      const errorMsg = err.response?.data?.error || err.response?.data?.details || err.message || 'Failed to post job';
      setError(err.response?.data?.details ? `${err.response.data.error}: ${err.response.data.details}` : errorMsg);
    }
    setLoading(false);
  };

  // ── Styles ──
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;

  const overlaySx = {
    ...modalOverlayStyle,
    padding: isMobile ? 0 : 'clamp(12px, 3vw, 20px)',
    alignItems: isMobile ? 'flex-end' : 'center',
  };

  const sheetSx = {
    background: 'white',
    borderRadius: isMobile ? '24px 24px 0 0' : 28,
    padding: isMobile ? '16px 16px 20px' : 'clamp(16px, 4vw, 28px)',
    width: isMobile ? '100vw' : '92vw',
    maxWidth: 480,
    maxHeight: isMobile ? '95dvh' : '92vh',
    overflowY: 'auto',
    boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
    display: 'flex',
    flexDirection: 'column',
    boxSizing: 'border-box',
  };

  const inputBase = {
    width: '100%', padding: '14px 16px', borderRadius: 16,
    border: '1.5px solid #e2e8f0', fontSize: 16, outline: 'none',
    boxSizing: 'border-box', minHeight: 52, background: '#fafbfc',
    transition: 'border-color 0.2s, box-shadow 0.2s',
  };

  const labelBase = {
    display: 'block', fontSize: 13, fontWeight: 800, color: '#1e293b',
    marginBottom: 8, letterSpacing: '-0.01em',
  };

  const chipBtn = (active, activeColor = '#6366f1', activeBg = '#eef2ff') => ({
    padding: '9px 14px', borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: 'pointer',
    border: active ? `2px solid ${activeColor}` : '1.5px solid #e2e8f0',
    background: active ? activeBg : 'white',
    color: active ? activeColor : '#475569',
    transition: 'all 0.15s',
  });

  const progressDot = (active) => ({
    width: active ? 24 : 8, height: 8, borderRadius: 4,
    background: active ? '#6366f1' : '#e2e8f0', transition: 'all 0.3s',
  });

  const stickyFooter = {
    position: 'sticky', bottom: 0, background: 'white',
    padding: '12px 0 0', borderTop: '1px solid #f1f5f9',
    marginTop: 'auto', display: 'flex', gap: 10, zIndex: 5,
  };

  const primaryBtn = {
    flex: 1, padding: '14px 20px', borderRadius: 16, border: 'none',
    fontSize: 15, fontWeight: 800, cursor: 'pointer',
    background: 'linear-gradient(135deg, #6366f1, #4f46e5)', color: 'white',
    minHeight: 52, boxShadow: '0 4px 16px rgba(99,102,241,0.3)',
  };

  const secondaryBtn = {
    padding: '14px 20px', borderRadius: 16, border: 'none', fontSize: 15,
    fontWeight: 700, cursor: 'pointer', background: '#f1f5f9', color: '#475569', minHeight: 52,
  };

  return (
    <div style={overlaySx} onClick={onClose}>
      <div ref={sheetRef} style={sheetSx} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 40, height: 40, borderRadius: 13, background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19, flexShrink: 0 }}>🔨</div>
            <div>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: '#1e293b' }}>
                {step === 1 ? 'What do you need?' : 'When & photos'}
              </h3>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: '#94a3b8' }}>Step {step} of 2</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={progressDot(step === 1)} />
            <div style={progressDot(step === 2)} />
            <button type="button" onClick={onClose} aria-label="Close" style={{
              width: 36, height: 36, borderRadius: '50%', border: '1px solid #e2e8f0',
              background: 'white', color: '#64748b', fontSize: 18, fontWeight: 700,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>✕</button>
          </div>
        </div>

        {error && (
          <div style={{ background: '#fef2f2', color: '#991b1b', padding: '12px 14px', borderRadius: 14, fontSize: 13, fontWeight: 600, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>⚠️</span> {error}
          </div>
        )}

        {/* ─── STEP 1: Task + Price ─── */}
        {step === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Category grid */}
            <div>
              <label style={{ ...labelBase, color: fieldErrors.category ? '#dc2626' : '#1e293b' }}>Pick a task *</label>
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8,
                borderRadius: 16,
                border: fieldErrors.category ? '2px solid #fecaca' : '2px solid transparent',
                background: fieldErrors.category ? '#fef2f2' : 'transparent',
                padding: fieldErrors.category ? 4 : 0,
              }}>
                {jobCategories.map(cat => {
                  const active = category === cat;
                  const gradient = categoryGradients[cat] || categoryGradients.Other;
                  return (
                    <button key={cat} onClick={() => {
                      setCategory(cat);
                      setError('');
                      setFieldErrors(prev => ({ ...prev, category: false }));
                      if (!title.trim()) {
                        setTitle((suggestedTitles[cat] || ['Help needed'])[0]);
                      }
                      // Pre-fill with the SA-market average — the user still
                      // controls the final price below.
                      const ph = categoryPriceHints[cat];
                      if (ph && !price) setPrice(String(ph.avg));
                      // Guide the eye to the next field
                      setTimeout(() => titleSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
                    }} style={{
                      padding: '10px 4px', borderRadius: 14,
                      border: active ? '2px solid #6366f1' : '2px solid #e2e8f0',
                      background: active ? '#eef2ff' : 'white', cursor: 'pointer',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                      minHeight: 68, transition: 'all 0.15s',
                    }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: 12, background: gradient,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
                      }}>{categoryEmojis[cat]}</div>
                      <span style={{ fontSize: 10, fontWeight: 700, color: active ? '#6366f1' : '#475569', lineHeight: 1.15, textAlign: 'center' }}>{cat}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Title */}
            <div ref={titleSectionRef}>
              <label style={{ ...labelBase, color: fieldErrors.title ? '#dc2626' : '#1e293b' }}>What exactly? *</label>
              <input
                value={title}
                onChange={e => { setTitle(e.target.value); setError(''); setFieldErrors(prev => ({ ...prev, title: false })); }}
                placeholder="e.g. Someone to walk my dog today"
                style={{ ...inputBase, borderColor: fieldErrors.title ? '#ef4444' : '#e2e8f0', background: fieldErrors.title ? '#fef2f2' : '#fafbfc' }}
              />
              {category && suggestedTitles[category] && (
                <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  {suggestedTitles[category].map((s, i) => (
                    <button key={i} onClick={() => setTitle(s)} style={{
                      padding: '6px 12px', borderRadius: 20, border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      background: title === s ? '#6366f1' : '#f1f5f9', color: title === s ? 'white' : '#64748b', whiteSpace: 'nowrap',
                    }}>{s}</button>
                  ))}
                </div>
              )}
            </div>

            {/* Single price with SA market guidance */}
            <div>
              <label style={{ ...labelBase, color: fieldErrors.price ? '#dc2626' : '#1e293b' }}>Your price (R) *</label>
              {hint && (
                <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                  {[
                    { amt: hint.min, tag: 'Budget' },
                    { amt: hint.avg, tag: 'SA average' },
                    { amt: hint.max, tag: 'Premium' },
                  ].map(({ amt, tag }) => (
                    <button key={tag} onClick={() => { setPrice(String(amt)); setFieldErrors(prev => ({ ...prev, price: false })); }} style={{
                      ...chipBtn(parseFloat(price) === amt, '#166534', '#dcfce7'),
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, flex: 1, minWidth: 80,
                    }}>
                      <span style={{ fontSize: 15, fontWeight: 900 }}>R{amt}</span>
                      <span style={{ fontSize: 10, fontWeight: 600, opacity: 0.8 }}>{tag}</span>
                    </button>
                  ))}
                </div>
              )}
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', fontSize: 18, fontWeight: 800, color: '#6366f1' }}>R</span>
                <input
                  type="number"
                  inputMode="numeric"
                  value={price}
                  onChange={e => { setPrice(e.target.value); setError(''); setFieldErrors(prev => ({ ...prev, price: false })); }}
                  placeholder="0"
                  style={{ ...inputBase, paddingLeft: 38, fontSize: 20, fontWeight: 800, borderColor: fieldErrors.price ? '#ef4444' : '#e2e8f0', background: fieldErrors.price ? '#fef2f2' : '#fafbfc' }}
                />
              </div>
              {hint && (
                <p style={{ fontSize: 11, color: '#94a3b8', margin: '6px 0 0', fontWeight: 600 }}>
                  💡 SA market for {category}: R{hint.min}–R{hint.max} {hint.unit}
                </p>
              )}
            </div>

            {/* Urgent toggle — one compact row */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 14px', borderRadius: 14, border: isUrgent ? '2px solid #ef4444' : '1.5px solid #e2e8f0', background: isUrgent ? '#fef2f2' : '#fafbfc' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 18 }}>🚨</span>
                <span style={{ fontSize: 13, fontWeight: 800, color: isUrgent ? '#dc2626' : '#1e293b' }}>Urgent job</span>
              </div>
              <Toggle on={isUrgent} onFlip={() => setIsUrgent(v => !v)} activeColor="#ef4444" />
            </div>

            <div style={stickyFooter}>
              <button onClick={onClose} style={secondaryBtn}>Cancel</button>
              <button onClick={handleNext} style={primaryBtn}>Next →</button>
            </div>
          </div>
        )}

        {/* ─── STEP 2: Time, payment, photos ─── */}
        {step === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Summary from step 1 */}
            <div style={{ background: '#f8fafc', borderRadius: 14, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10, border: '1px solid #e2e8f0' }}>
              <span style={{ fontSize: 20 }}>{categoryEmojis[category]}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
                <div style={{ fontSize: 13, color: '#16a34a', fontWeight: 800 }}>
                  R{price}
                  {isUrgent && <span style={{ marginLeft: 8, background: '#ef4444', color: 'white', fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 10 }}>URGENT</span>}
                </div>
              </div>
              <button onClick={handleBack} style={{
                padding: '0 14px', minHeight: 40, borderRadius: 10, border: 'none',
                fontSize: 13, fontWeight: 700, cursor: 'pointer', background: '#e2e8f0', color: '#475569', flexShrink: 0,
              }}>Edit</button>
            </div>

            {/* SA time picker */}
            <div>
              <label style={{ ...labelBase, color: fieldErrors.proposedTime ? '#dc2626' : '#1e293b' }}>What time must it be done? *</label>
              <SATimePicker
                value={proposedTimeOfDay}
                onChange={v => { setProposedTimeOfDay(v); setError(''); setFieldErrors(prev => ({ ...prev, proposedTime: false })); }}
                hasError={fieldErrors.proposedTime}
              />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>
                  ⏰ {timeIsNegotiable ? 'Time is flexible' : 'Time is fixed'}
                </span>
                <Toggle on={timeIsNegotiable} onFlip={() => setTimeIsNegotiable(v => !v)} />
              </div>
            </div>

            {/* Duration chips */}
            <div>
              <label style={labelBase}>How long will it take? <span style={{ fontWeight: 500, color: '#94a3b8' }}>(optional)</span></label>
              <div style={{ display: 'flex', gap: 6 }}>
                {[['<1hr', '<1 hr'], ['1-3hrs', '1–3 hrs'], ['3-5hrs', '3–5 hrs'], ['5+hrs', '5+ hrs']].map(([val, label]) => (
                  <button key={val} onClick={() => setEstimatedDuration(estimatedDuration === val ? '' : val)} style={{ ...chipBtn(estimatedDuration === val), flex: 1, padding: '9px 4px' }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Payment */}
            <div>
              <label style={labelBase}>Payment</label>
              <div style={{ display: 'flex', gap: 6, background: '#f1f5f9', padding: 4, borderRadius: 16 }}>
                <button onClick={() => setPaymentMethod('escrow')} style={{
                  flex: 1, padding: '12px', borderRadius: 14, border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                  background: paymentMethod === 'escrow' ? 'white' : 'transparent',
                  color: paymentMethod === 'escrow' ? '#6366f1' : '#64748b',
                  boxShadow: paymentMethod === 'escrow' ? '0 2px 8px rgba(0,0,0,0.06)' : 'none', minHeight: 48,
                }}>🔒 Escrow</button>
                <button onClick={() => setPaymentMethod('cash')} style={{
                  flex: 1, padding: '12px', borderRadius: 14, border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                  background: paymentMethod === 'cash' ? 'white' : 'transparent',
                  color: paymentMethod === 'cash' ? '#22c55e' : '#64748b',
                  boxShadow: paymentMethod === 'cash' ? '0 2px 8px rgba(0,0,0,0.06)' : 'none', minHeight: 48,
                }}>💵 Cash</button>
              </div>
            </div>

            {/* Photos */}
            <div>
              <label style={labelBase}>Photos <span style={{ fontWeight: 500, color: '#94a3b8' }}>(optional)</span></label>
              <div style={{ display: 'flex', gap: 8 }}>
                <label style={{
                  flex: 1, border: '2px dashed #cbd5e1', borderRadius: 14, padding: '10px 8px',
                  textAlign: 'center', cursor: images.length >= 5 ? 'not-allowed' : 'pointer',
                  opacity: images.length >= 5 ? 0.5 : 1, background: '#f8fafc', minHeight: 60,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                }}>
                  <input type="file" accept="image/*" capture="environment" onChange={handleImageChange} disabled={images.length >= 5} style={{ display: 'none' }} />
                  <div style={{ fontSize: 20 }}>📷</div>
                  <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>Camera</span>
                </label>
                <label style={{
                  flex: 1, border: '2px dashed #cbd5e1', borderRadius: 14, padding: '10px 8px',
                  textAlign: 'center', cursor: images.length >= 5 ? 'not-allowed' : 'pointer',
                  opacity: images.length >= 5 ? 0.5 : 1, background: '#f8fafc', minHeight: 60,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                }}>
                  <input type="file" accept="image/*" multiple onChange={handleImageChange} disabled={images.length >= 5} style={{ display: 'none' }} />
                  <div style={{ fontSize: 20 }}>🖼️</div>
                  <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>Gallery</span>
                </label>
              </div>
              {imagePreviews.length > 0 && (
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  {imagePreviews.map((preview, idx) => (
                    <div key={idx} style={{ position: 'relative', width: 60, height: 60, borderRadius: 12, overflow: 'hidden' }}>
                      <img src={preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      <button onClick={() => removeImage(idx)} style={{
                        position: 'absolute', top: -2, right: -2, width: 20, height: 20,
                        background: '#ef4444', color: 'white', border: '2px solid white',
                        borderRadius: '50%', fontSize: 9, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Post now vs schedule — compact */}
            <div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => { setPostingMode('immediate'); setPublishAt(''); setFieldErrors(prev => ({ ...prev, publishAt: false })); }} style={{ ...chipBtn(postingMode === 'immediate'), flex: 1 }}>
                  ⚡ Post now
                </button>
                <button type="button" onClick={() => { setPostingMode('scheduled'); setFieldErrors(prev => ({ ...prev, publishAt: false })); }} style={{ ...chipBtn(postingMode === 'scheduled'), flex: 1 }}>
                  📅 Schedule
                </button>
              </div>
              {postingMode === 'scheduled' && (
                <input
                  type="datetime-local"
                  value={publishAt}
                  min={(() => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); })()}
                  max={(() => { const d = new Date(Date.now() + 24 * 60 * 60 * 1000); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); })()}
                  onChange={e => { setPublishAt(e.target.value); setError(''); setFieldErrors(prev => ({ ...prev, publishAt: false })); }}
                  style={{ ...inputBase, marginTop: 8, borderColor: fieldErrors.publishAt ? '#ef4444' : '#e2e8f0', background: fieldErrors.publishAt ? '#fef2f2' : '#fafbfc' }}
                />
              )}
              <p style={{ fontSize: 11, color: '#94a3b8', margin: '6px 0 0', fontWeight: 500 }}>
                {postingMode === 'immediate' ? 'Goes live now. Applications close in 24h.' : 'Publishes at the chosen time (max 24h ahead).'}
              </p>
            </div>

            {loading && uploadProgress > 0 && (
              <div>
                <div style={{ height: 6, background: '#e2e8f0', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${uploadProgress}%`, height: '100%', background: '#6366f1', transition: 'width 0.2s', borderRadius: 3 }} />
                </div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 4, fontWeight: 600 }}>Uploading... {uploadProgress}%</div>
              </div>
            )}

            <div style={stickyFooter}>
              <button onClick={handleBack} disabled={loading} style={secondaryBtn}>← Back</button>
              <button onClick={handleSubmit} disabled={loading} style={{ ...primaryBtn, opacity: loading ? 0.6 : 1 }}>
                {loading ? '⏳ Posting...' : 'Ask the Community'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default PostJobModal;
