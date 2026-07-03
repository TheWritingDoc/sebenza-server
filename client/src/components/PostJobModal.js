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

function DigitalClockPicker({ value, onChange, hasError }) {
  const [hours, minutes] = value ? value.split(':').map(Number) : [12, 0];
  const safeHours = isNaN(hours) ? 12 : hours;
  const safeMinutes = isNaN(minutes) ? 0 : minutes;

  const pad = (n) => String(n).padStart(2, '0');

  const setHours = (h) => onChange(`${pad(((h % 24) + 24) % 24)}:${pad(safeMinutes)}`);
  const setMinutes = (m) => onChange(`${pad(safeHours)}:${pad(((m % 60) + 60) % 60)}`);

  const unitStyle = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
  };

  const arrowBtn = {
    width: 44,
    height: 32,
    borderRadius: 8,
    border: '1px solid #e2e8f0',
    background: '#f8fafc',
    color: '#64748b',
    fontSize: 16,
    fontWeight: 700,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    userSelect: 'none',
    WebkitUserSelect: 'none',
  };

  const digitStyle = {
    fontFamily: '"SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas, monospace',
    fontSize: 42,
    fontWeight: 700,
    color: hasError ? '#dc2626' : '#1e293b',
    lineHeight: 1,
    letterSpacing: 2,
    minWidth: 60,
    textAlign: 'center',
  };

  const colonStyle = {
    fontFamily: '"SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas, monospace',
    fontSize: 42,
    fontWeight: 700,
    color: '#94a3b8',
    lineHeight: 1,
    paddingBottom: 4,
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: '16px 0',
        borderRadius: 14,
        border: hasError ? '2px solid #ef4444' : '1px solid #e2e8f0',
        background: hasError ? '#fef2f2' : '#fafbfc',
      }}
    >
      <div style={unitStyle}>
        <button type="button" style={arrowBtn} onClick={() => setHours(safeHours + 1)}>▲</button>
        <span style={digitStyle}>{pad(safeHours)}</span>
        <button type="button" style={arrowBtn} onClick={() => setHours(safeHours - 1)}>▼</button>
      </div>
      <span style={colonStyle}>:</span>
      <div style={unitStyle}>
        <button type="button" style={arrowBtn} onClick={() => setMinutes(safeMinutes + 1)}>▲</button>
        <span style={digitStyle}>{pad(safeMinutes)}</span>
        <button type="button" style={arrowBtn} onClick={() => setMinutes(safeMinutes - 1)}>▼</button>
      </div>
    </div>
  );
}

function PostJobModal({ user, onClose, onPosted }) {
  const [step, setStep] = useState(1);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [budgetMin, setBudgetMin] = useState('');
  const [budgetMax, setBudgetMax] = useState('');
  const [isUrgent, setIsUrgent] = useState(false);
  const [estimatedDuration, setEstimatedDuration] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [proposedTime, setProposedTime] = useState(''); // datetime-local for scheduled
  // Default to '12:00' so the value matches what the clock picker displays.
  // With '' the picker still SHOWS 12:00 but submit fails "required" — a trap
  // where the user sees a set time yet can't post.
  const [proposedTimeOfDay, setProposedTimeOfDay] = useState('12:00'); // time-only for immediate
  const [timeIsNegotiable, setTimeIsNegotiable] = useState(true);
  const [applicationDeadline, setApplicationDeadline] = useState('');
  const [postingMode, setPostingMode] = useState('immediate'); // 'immediate' | 'scheduled'
  const [publishAt, setPublishAt] = useState('');
  const [images, setImages] = useState([]);
  const [imagePreviews, setImagePreviews] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const titleRef = useRef(null);
  const budgetMinRef = useRef(null);
  const budgetMaxRef = useRef(null);
  const sheetRef = useRef(null);

  const token = localStorage.getItem('token');

  useEffect(() => {
    // Ensure no input is auto-focused when modal opens (prevents keyboard popup)
    const timer = setTimeout(() => {
      if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
        document.activeElement.blur();
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [step]);

  useEffect(() => {
    // Scroll error message into view when validation fails
    if (error) {
      sheetRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [error]);

  const handleImageChange = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length + images.length > 5) { alert('Maximum 5 photos allowed'); return; }
    setLoading(true);
    try {
      const compressed = await compressImages(files, 1200, 0.85);
      setImages(prev => [...prev, ...compressed].slice(0, 5));
      const newPreviews = compressed.map(file => URL.createObjectURL(file));
      setImagePreviews(prev => [...prev, ...newPreviews].slice(0, 5));
    } catch {
      // Fallback: use original files
      setImages(prev => [...prev, ...files].slice(0, 5));
      const newPreviews = files.map(file => URL.createObjectURL(file));
      setImagePreviews(prev => [...prev, ...newPreviews].slice(0, 5));
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

  const validateStep1 = () => {
    const errs = {};
    if (!category) errs.category = true;
    if (!title.trim()) errs.title = true;
    const min = parseFloat(budgetMin);
    const max = parseFloat(budgetMax);
    if (isNaN(min) || min <= 0) errs.budget = true;
    if (!isNaN(max) && max > 0 && max < min) errs.budget = true;
    return errs;
  };

  const handleNext = () => {
    const errs = validateStep1();
    const errMsgs = [];
    if (errs.category) errMsgs.push('Pick a category');
    if (errs.title) errMsgs.push('Enter a job title');
    if (errs.budget) errMsgs.push('Enter a valid budget range');
    if (errMsgs.length) {
      setFieldErrors(errs);
      setError(errMsgs.join(' • '));
      return;
    }
    setFieldErrors({});
    setError('');
    setStep(2);
    // Scroll to top of form for next step
    setTimeout(() => {
      sheetRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }, 50);
  };

  const handleBack = () => {
    setError('');
    setFieldErrors({});
    setStep(1);
    // Scroll to top of form when going back
    setTimeout(() => {
      sheetRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }, 50);
  };

  const handleKeyDownStep1 = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleNext();
    }
  };

  const handleSubmit = async () => {
    const errs = {};
    if (!description.trim()) errs.description = true;
    if (postingMode === 'scheduled' && !proposedTime) errs.proposedTime = true;
    if (postingMode === 'immediate' && !proposedTimeOfDay) errs.proposedTime = true;
    const min = parseFloat(budgetMin);
    const max = parseFloat(budgetMax);
    if (isNaN(min) || min <= 0) errs.budget = true;
    if (!isNaN(max) && max > 0 && max < min) errs.budget = true;
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
      // Location is optional — server provides Port Elizabeth default if missing

      let finalProposedTime;
      if (postingMode === 'immediate' && proposedTimeOfDay) {
        const [h, m] = proposedTimeOfDay.split(':');
        const now = new Date();
        const dt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), parseInt(h), parseInt(m));
        if (dt.getTime() <= now.getTime()) {
          dt.setDate(dt.getDate() + 1); // Time has passed — schedule for tomorrow
        }
        finalProposedTime = dt.toISOString();
      } else {
        finalProposedTime = new Date(proposedTime).toISOString();
      }

      const formData = new FormData();
      formData.append('title', title);
      formData.append('description', description);
      formData.append('category', category);
      // Ensure budget values are sent as valid numbers
      formData.append('budget', String(min));
      formData.append('budgetMin', String(min));
      if (!isNaN(max) && max > 0) formData.append('budgetMax', String(max));
      formData.append('isUrgent', isUrgent);
      if (estimatedDuration) formData.append('estimatedDuration', estimatedDuration);
      formData.append('paymentMethod', paymentMethod);
      formData.append('proposedTime', finalProposedTime);
      formData.append('timeIsNegotiable', timeIsNegotiable);
      if (applicationDeadline) formData.append('applicationDeadline', new Date(applicationDeadline).toISOString());
      if (loc) {
        formData.append('lat', String(loc.lat));
        formData.append('lng', String(loc.lng));
      }
      if (postingMode === 'scheduled' && publishAt) {
        formData.append('publishAt', new Date(publishAt).toISOString());
      }
      images.forEach(img => formData.append('jobPostImages', img));

      const response = await axios.post(`${API_URL}/api/jobs`, formData,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'multipart/form-data'
          },
          withCredentials: true,
          onUploadProgress: (ev) => {
            const pct = ev.total ? Math.round((ev.loaded * 100) / ev.total) : 0;
            setUploadProgress(pct);
          }
        }
      );
      
      // Success - call onPosted with the response data
      if (response.data && response.data.job) {
        onPosted(response.data.job);
      } else {
        onPosted();
      }
    } catch (err) {
      console.error('Post job error:', err);
      const errorMsg = err.response?.data?.error || err.response?.data?.details || err.message || 'Failed to post job';
      setError(errorMsg);
      
      // If it's a validation error, show more details
      if (err.response?.data?.details) {
        setError(`${err.response.data.error}: ${err.response.data.details}`);
      }
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
    padding: isMobile ? '20px 16px 24px' : 'clamp(16px, 4vw, 28px)',
    width: isMobile ? '100vw' : '92vw',
    maxWidth: 480,
    maxHeight: isMobile ? '95vh' : '92vh',
    height: isMobile ? 'auto' : 'auto',
    overflowY: 'auto',
    boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
    display: 'flex',
    flexDirection: 'column',
  };

  const inputBase = {
    width: '100%',
    padding: '14px 16px',
    borderRadius: 16,
    border: '1.5px solid #e2e8f0',
    fontSize: 16,
    outline: 'none',
    boxSizing: 'border-box',
    minHeight: 52,
    background: '#fafbfc',
    transition: 'border-color 0.2s, box-shadow 0.2s',
  };

  const inputFocus = {
    borderColor: '#6366f1',
    boxShadow: '0 0 0 3px rgba(99,102,241,0.12)',
    background: 'white',
  };

  const labelBase = {
    display: 'block',
    fontSize: 13,
    fontWeight: 800,
    color: '#1e293b',
    marginBottom: 8,
    letterSpacing: '-0.01em',
  };

  const sectionTitle = {
    fontSize: 'clamp(20px, 5vw, 24px)',
    fontWeight: 800,
    color: '#1e293b',
    margin: '0 0 4px',
    lineHeight: 1.2,
  };

  const sectionSub = {
    fontSize: 14,
    color: '#64748b',
    margin: 0,
    marginBottom: 20,
  };

  const progressDot = (active) => ({
    width: active ? 24 : 8,
    height: 8,
    borderRadius: 4,
    background: active ? '#6366f1' : '#e2e8f0',
    transition: 'all 0.3s',
  });

  const stickyFooter = {
    position: 'sticky',
    bottom: 0,
    background: 'white',
    padding: '12px 0 0',
    borderTop: '1px solid #f1f5f9',
    marginTop: 'auto',
    display: 'flex',
    gap: 10,
    zIndex: 5,
  };

  return (
    <div style={overlaySx} onClick={onClose}>
      <div ref={sheetRef} style={sheetSx} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 44, height: 44, borderRadius: 14, background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>🔨</div>
            <div>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#1e293b' }}>Ask Your Neighbours</h3>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: '#94a3b8' }}>Step {step} of 2</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={progressDot(step === 1)} />
            <div style={progressDot(step === 2)} />
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                border: '1px solid #e2e8f0',
                background: 'white',
                color: '#64748b',
                fontSize: 18,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {error && (
          <div style={{ background: '#fef2f2', color: '#991b1b', padding: '12px 14px', borderRadius: 14, fontSize: 13, fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>⚠️</span> {error}
          </div>
        )}

        {/* ─── STEP 1: What & How Much ─── */}
        {step === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <h2 style={sectionTitle}>What do you need help with?</h2>
              <p style={sectionSub}>Pick a quick task — your neighbours are ready to help!</p>
            </div>

            {/* Category — visual emoji grid */}
            <div>
              <label style={{ ...labelBase, color: fieldErrors.category ? '#dc2626' : '#1e293b' }}>Pick a task * {fieldErrors.category && <span style={{ color: '#dc2626', fontSize: 12 }}>— required</span>}</label>
              <div style={{
                display: 'grid',
                gridTemplateColumns: isMobile ? 'repeat(3, 1fr)' : 'repeat(4, 1fr)',
                gap: 10,
                padding: fieldErrors.category ? 4 : 0,
                borderRadius: 20,
                border: fieldErrors.category ? '2px solid #fecaca' : '2px solid transparent',
                background: fieldErrors.category ? '#fef2f2' : 'transparent',
              }}>
                {jobCategories.map(cat => {
                  const active = category === cat;
                  const gradient = categoryGradients[cat] || categoryGradients.Other;
                  return (
                    <button key={cat} onClick={() => {
                      setCategory(cat);
                      setError('');
                      setFieldErrors(prev => ({ ...prev, category: false }));
                      // Auto-suggest a title if empty
                      if (!title.trim()) {
                        const suggestions = suggestedTitles[cat] || ['Help needed'];
                        setTitle(suggestions[0]);
                      }
                      // Auto-suggest a price if empty
                      if (!budgetMin && !budgetMax) {
                        const hint = categoryPriceHints[cat];
                        if (hint) {
                          setBudgetMin(hint.min.toString());
                          setBudgetMax(hint.max.toString());
                        }
                      }
                    }} style={{
                      padding: '14px 6px',
                      borderRadius: 16,
                      border: '2px solid',
                      borderColor: active ? '#6366f1' : '#e2e8f0',
                      background: active ? '#eef2ff' : 'white',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 6,
                      minHeight: 80,
                      transition: 'all 0.15s',
                    }}>
                      <div style={{
                        width: 44, height: 44, borderRadius: 14,
                        background: gradient,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 24,
                        boxShadow: active ? '0 4px 12px rgba(99,102,241,0.2)' : '0 2px 6px rgba(0,0,0,0.04)',
                      }}>{categoryEmojis[cat]}</div>
                      <span style={{
                        fontSize: 11, fontWeight: 700, color: active ? '#6366f1' : '#475569',
                        lineHeight: 1.2, textAlign: 'center',
                      }}>{cat}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Title with quick suggestions */}
            <div>
              <label style={{ ...labelBase, color: fieldErrors.title ? '#dc2626' : '#1e293b' }}>What exactly? * {fieldErrors.title && <span style={{ color: '#dc2626', fontSize: 12 }}>— required</span>}</label>
              <input
                ref={titleRef}
                value={title}
                onChange={e => { setTitle(e.target.value); setError(''); setFieldErrors(prev => ({ ...prev, title: false })); }}
                onKeyDown={handleKeyDownStep1}
                placeholder="e.g. Someone to walk my dog today"
                style={{ ...inputBase, borderColor: fieldErrors.title ? '#ef4444' : '#e2e8f0', background: fieldErrors.title ? '#fef2f2' : '#fafbfc' }}
                onFocus={e => { e.target.style.borderColor = fieldErrors.title ? '#ef4444' : '#6366f1'; e.target.style.boxShadow = fieldErrors.title ? '0 0 0 3px rgba(239,68,68,0.12)' : '0 0 0 3px rgba(99,102,241,0.12)'; e.target.style.background = 'white'; }}
                onBlur={e => { e.target.style.borderColor = fieldErrors.title ? '#ef4444' : '#e2e8f0'; e.target.style.boxShadow = 'none'; e.target.style.background = fieldErrors.title ? '#fef2f2' : '#fafbfc'; }}
              />
              {category && suggestedTitles[category] && (
                <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  {suggestedTitles[category].map((s, i) => (
                    <button key={i} onClick={() => setTitle(s)} style={{
                      padding: '6px 12px', borderRadius: 20, border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      background: title === s ? '#6366f1' : '#f1f5f9', color: title === s ? 'white' : '#64748b',
                      transition: 'all 0.15s', whiteSpace: 'nowrap',
                    }}>{s}</button>
                  ))}
                </div>
              )}
            </div>

            {/* Budget range with quick chips */}
            <div>
              <label style={{ ...labelBase, color: fieldErrors.budget ? '#dc2626' : '#1e293b' }}>What is your budget range? (R) * {fieldErrors.budget && <span style={{ color: '#dc2626', fontSize: 12 }}>— required</span>}</label>
              {category && categoryPriceHints[category] && (
                <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>Quick pick:</span>
                  {[categoryPriceHints[category].min, categoryPriceHints[category].avg, categoryPriceHints[category].max].map((amt, i) => (
                    <button key={i} onClick={() => { setBudgetMin(amt.toString()); setBudgetMax(amt.toString()); }} style={{
                      padding: '7px 14px', borderRadius: 12, border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                      background: parseFloat(budgetMin) === amt && parseFloat(budgetMax) === amt ? '#22c55e' : '#dcfce7', color: parseFloat(budgetMin) === amt && parseFloat(budgetMax) === amt ? 'white' : '#166534',
                      transition: 'all 0.15s',
                    }}>R{amt}</button>
                  ))}
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>{categoryPriceHints[category].unit}</span>
                </div>
              )}
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <span style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', fontSize: 16, fontWeight: 700, color: '#6366f1' }}>R</span>
                  <input
                    ref={budgetMinRef}
                    type="number"
                    value={budgetMin}
                    onChange={e => { setBudgetMin(e.target.value); setError(''); setFieldErrors(prev => ({ ...prev, budget: false })); }}
                    onKeyDown={handleKeyDownStep1}
                    placeholder="Min"
                    style={{ ...inputBase, paddingLeft: 36, borderColor: fieldErrors.budget ? '#ef4444' : '#e2e8f0', background: fieldErrors.budget ? '#fef2f2' : '#fafbfc' }}
                    onFocus={e => { e.target.style.borderColor = fieldErrors.budget ? '#ef4444' : '#6366f1'; e.target.style.boxShadow = fieldErrors.budget ? '0 0 0 3px rgba(239,68,68,0.12)' : '0 0 0 3px rgba(99,102,241,0.12)'; e.target.style.background = 'white'; }}
                    onBlur={e => { e.target.style.borderColor = fieldErrors.budget ? '#ef4444' : '#e2e8f0'; e.target.style.boxShadow = 'none'; e.target.style.background = fieldErrors.budget ? '#fef2f2' : '#fafbfc'; }}
                  />
                </div>
                <div style={{ position: 'relative', flex: 1 }}>
                  <span style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', fontSize: 16, fontWeight: 700, color: '#6366f1' }}>R</span>
                  <input
                    ref={budgetMaxRef}
                    type="number"
                    value={budgetMax}
                    onChange={e => { setBudgetMax(e.target.value); setError(''); setFieldErrors(prev => ({ ...prev, budget: false })); }}
                    onKeyDown={handleKeyDownStep1}
                    placeholder="Max"
                    style={{ ...inputBase, paddingLeft: 36, borderColor: fieldErrors.budget ? '#ef4444' : '#e2e8f0', background: fieldErrors.budget ? '#fef2f2' : '#fafbfc' }}
                    onFocus={e => { e.target.style.borderColor = fieldErrors.budget ? '#ef4444' : '#6366f1'; e.target.style.boxShadow = fieldErrors.budget ? '0 0 0 3px rgba(239,68,68,0.12)' : '0 0 0 3px rgba(99,102,241,0.12)'; e.target.style.background = 'white'; }}
                    onBlur={e => { e.target.style.borderColor = fieldErrors.budget ? '#ef4444' : '#e2e8f0'; e.target.style.boxShadow = 'none'; e.target.style.background = fieldErrors.budget ? '#fef2f2' : '#fafbfc'; }}
                  />
                </div>
              </div>
            </div>

            {/* Estimated Duration */}
            <div>
              <label style={labelBase}>Estimated Duration <span style={{ fontWeight: 500, color: '#94a3b8' }}>(optional)</span></label>
              <select
                value={estimatedDuration}
                onChange={e => { setEstimatedDuration(e.target.value); setError(''); }}
                style={{ ...inputBase, appearance: 'none', WebkitAppearance: 'none', backgroundImage: 'url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%236366f1%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 16px top 50%', backgroundSize: '12px auto', paddingRight: 40 }}
                onFocus={e => { e.target.style.borderColor = '#6366f1'; e.target.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.12)'; e.target.style.background = 'white'; }}
                onBlur={e => { e.target.style.borderColor = '#e2e8f0'; e.target.style.boxShadow = 'none'; e.target.style.background = '#fafbfc'; }}
              >
                <option value="">Select duration...</option>
                <option value="<1hr">Less than 1 hour</option>
                <option value="1-3hrs">1 – 3 hours</option>
                <option value="3-5hrs">3 – 5 hours</option>
                <option value="5+hrs">5+ hours</option>
              </select>
            </div>

            {/* Urgent toggle */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 14px', borderRadius: 16, border: isUrgent ? '2px solid #ef4444' : '1.5px solid #e2e8f0', background: isUrgent ? '#fef2f2' : '#fafbfc' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 20 }}>🚨</span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: isUrgent ? '#dc2626' : '#1e293b' }}>Urgent Job</div>
                  <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500 }}>Highlight this job for faster responses</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsUrgent(v => !v)}
                style={{
                  position: 'relative',
                  width: 48,
                  height: 26,
                  borderRadius: 13,
                  border: 'none',
                  background: isUrgent ? '#ef4444' : '#cbd5e1',
                  cursor: 'pointer',
                  transition: 'background 0.2s ease',
                  padding: 0,
                  flexShrink: 0,
                }}
                aria-pressed={isUrgent}
              >
                <span
                  style={{
                    position: 'absolute',
                    top: 3,
                    left: isUrgent ? 25 : 3,
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    background: '#fff',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                    transition: 'left 0.2s ease',
                    display: 'block',
                  }}
                />
              </button>
            </div>

            {/* Spacer to push footer down */}
            <div style={{ flex: 1, minHeight: 20 }} />

            <div style={stickyFooter}>
              <button onClick={onClose} style={{
                padding: '14px 20px', borderRadius: 16, border: 'none', fontSize: 15, fontWeight: 700, cursor: 'pointer',
                background: '#f1f5f9', color: '#475569', minHeight: 52,
              }}>Cancel</button>
              <button onClick={handleNext} style={{
                flex: 1, padding: '14px 20px', borderRadius: 16, border: 'none', fontSize: 15, fontWeight: 800, cursor: 'pointer',
                background: 'linear-gradient(135deg, #6366f1, #4f46e5)', color: 'white', minHeight: 52,
                boxShadow: '0 4px 16px rgba(99,102,241,0.3)',
              }}>Next →</button>
            </div>
          </div>
        )}

        {/* ─── STEP 2: When, Details & Photos ─── */}
        {step === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <h2 style={sectionTitle}>Tell us more</h2>
              <p style={sectionSub}>Add timing, description and optional photos</p>
            </div>

            {/* Quick summary from step 1 */}
            <div style={{ background: '#f8fafc', borderRadius: 16, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10, border: '1px solid #e2e8f0' }}>
              <span style={{ fontSize: 20 }}>{categoryEmojis[category]}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
                <div style={{ fontSize: 12, color: '#22c55e', fontWeight: 700 }}>
                  R{budgetMin}{budgetMax && budgetMax !== budgetMin ? ` – R${budgetMax}` : ''}
                  {isUrgent && <span style={{ marginLeft: 8, background: '#ef4444', color: 'white', fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 10 }}>URGENT</span>}
                </div>
              </div>
              <button onClick={handleBack} style={{
                padding: '6px 12px', borderRadius: 10, border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                background: '#e2e8f0', color: '#475569',
              }}>Edit</button>
            </div>

            {/* Work time */}
            <div>
              <label style={{ ...labelBase, color: fieldErrors.proposedTime ? '#dc2626' : '#1e293b' }}>
                {postingMode === 'immediate' ? 'What time do you need it done? *' : 'When do you need it done? *'}
                {fieldErrors.proposedTime && <span style={{ color: '#dc2626', fontSize: 12 }}> — required</span>}
              </label>
              {postingMode === 'immediate' ? (
                <DigitalClockPicker
                  value={proposedTimeOfDay}
                  onChange={v => { setProposedTimeOfDay(v); setError(''); setFieldErrors(prev => ({ ...prev, proposedTime: false })); }}
                  hasError={fieldErrors.proposedTime}
                />
              ) : (
                <input
                  type="datetime-local"
                  value={proposedTime}
                  onChange={e => { setProposedTime(e.target.value); setError(''); setFieldErrors(prev => ({ ...prev, proposedTime: false })); }}
                  style={{ ...inputBase, borderColor: fieldErrors.proposedTime ? '#ef4444' : '#e2e8f0', background: fieldErrors.proposedTime ? '#fef2f2' : '#fafbfc' }}
                  onFocus={e => { e.target.style.borderColor = fieldErrors.proposedTime ? '#ef4444' : '#6366f1'; e.target.style.boxShadow = fieldErrors.proposedTime ? '0 0 0 3px rgba(239,68,68,0.12)' : '0 0 0 3px rgba(99,102,241,0.12)'; e.target.style.background = 'white'; }}
                  onBlur={e => { e.target.style.borderColor = fieldErrors.proposedTime ? '#ef4444' : '#e2e8f0'; e.target.style.boxShadow = 'none'; e.target.style.background = fieldErrors.proposedTime ? '#fef2f2' : '#fafbfc'; }}
                />
              )}
              {postingMode === 'immediate' && proposedTimeOfDay && (
                <p style={{ fontSize: 11, color: '#94a3b8', margin: '6px 0 0', fontWeight: 500 }}>
                  {(() => {
                    const [h, m] = proposedTimeOfDay.split(':');
                    const now = new Date();
                    const dt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), parseInt(h), parseInt(m));
                    const isTomorrow = dt.getTime() <= now.getTime();
                    return isTomorrow ? `Scheduled for tomorrow at ${proposedTimeOfDay}` : `Scheduled for today at ${proposedTimeOfDay}`;
                  })()}
                </p>
              )}
            </div>

            {/* Posting schedule toggle */}
            <div>
              <label style={labelBase}>Posting Schedule</label>
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button
                  type="button"
                  onClick={() => { setPostingMode('immediate'); setPublishAt(''); setProposedTime(''); setFieldErrors(prev => ({ ...prev, publishAt: false, proposedTime: false })); }}
                  style={{
                    flex: 1,
                    padding: '10px 0',
                    borderRadius: 10,
                    border: postingMode === 'immediate' ? '2px solid #6366f1' : '1px solid #e2e8f0',
                    background: postingMode === 'immediate' ? '#eef2ff' : '#f8fafc',
                    color: postingMode === 'immediate' ? '#4f46e5' : '#64748b',
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                >
                  ⚡ Post Now
                </button>
                <button
                  type="button"
                  onClick={() => { setPostingMode('scheduled'); setProposedTimeOfDay(''); setFieldErrors(prev => ({ ...prev, publishAt: false, proposedTime: false })); }}
                  style={{
                    flex: 1,
                    padding: '10px 0',
                    borderRadius: 10,
                    border: postingMode === 'scheduled' ? '2px solid #6366f1' : '1px solid #e2e8f0',
                    background: postingMode === 'scheduled' ? '#eef2ff' : '#f8fafc',
                    color: postingMode === 'scheduled' ? '#4f46e5' : '#64748b',
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                >
                  📅 Schedule
                </button>
              </div>
              <p style={{ fontSize: 11, color: '#94a3b8', margin: '6px 0 0', fontWeight: 500 }}>
                {postingMode === 'immediate'
                  ? 'Job goes live immediately. Applications close 24h from now.'
                  : 'Schedule up to 24h ahead. Applications close 24h from publish time.'}
              </p>

              {postingMode === 'scheduled' && (
                <div style={{ marginTop: 12 }}>
                  <label style={{ ...labelBase, color: fieldErrors.publishAt ? '#dc2626' : '#1e293b', fontSize: 12 }}>
                    Publish At * {fieldErrors.publishAt && <span style={{ color: '#dc2626', fontSize: 12 }}>— required</span>}
                  </label>
                  <input
                    type="datetime-local"
                    value={publishAt}
                    min={(() => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); })()}
                    max={(() => { const d = new Date(Date.now() + 24 * 60 * 60 * 1000); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); })()}
                    onChange={e => { setPublishAt(e.target.value); setError(''); setFieldErrors(prev => ({ ...prev, publishAt: false })); }}
                    style={{ ...inputBase, borderColor: fieldErrors.publishAt ? '#ef4444' : '#e2e8f0', background: fieldErrors.publishAt ? '#fef2f2' : '#fafbfc' }}
                    onFocus={e => { e.target.style.borderColor = fieldErrors.publishAt ? '#ef4444' : '#6366f1'; e.target.style.boxShadow = fieldErrors.publishAt ? '0 0 0 3px rgba(239,68,68,0.12)' : '0 0 0 3px rgba(99,102,241,0.12)'; e.target.style.background = 'white'; }}
                    onBlur={e => { e.target.style.borderColor = fieldErrors.publishAt ? '#ef4444' : '#e2e8f0'; e.target.style.boxShadow = 'none'; e.target.style.background = fieldErrors.publishAt ? '#fef2f2' : '#fafbfc'; }}
                  />
                  {proposedTime && publishAt && new Date(publishAt) >= new Date(proposedTime) && (
                    <p style={{ fontSize: 11, color: '#dc2626', margin: '6px 0 0', fontWeight: 600 }}>
                      ⚠ Publish time must be before the job time
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Time negotiable toggle */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#1e293b' }}>
                ⏰ {timeIsNegotiable ? 'Time is flexible — open to offers' : 'Time is fixed — non-negotiable'}
              </span>
              <button
                type="button"
                onClick={() => setTimeIsNegotiable(v => !v)}
                style={{
                  position: 'relative',
                  width: 48,
                  height: 26,
                  borderRadius: 13,
                  border: 'none',
                  background: timeIsNegotiable ? '#6366f1' : '#cbd5e1',
                  cursor: 'pointer',
                  transition: 'background 0.2s ease',
                  padding: 0,
                  flexShrink: 0,
                }}
                aria-pressed={timeIsNegotiable}
              >
                <span
                  style={{
                    position: 'absolute',
                    top: 3,
                    left: timeIsNegotiable ? 25 : 3,
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    background: '#fff',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                    transition: 'left 0.2s ease',
                    display: 'block',
                  }}
                />
              </button>
            </div>

            {/* Application deadline */}
            <div>
              <label style={labelBase}>Applications close at <span style={{ fontWeight: 500, color: '#94a3b8' }}>(optional)</span></label>
              <input
                type="datetime-local"
                value={applicationDeadline}
                onChange={e => { setApplicationDeadline(e.target.value); setError(''); }}
                style={inputBase}
                onFocus={e => { e.target.style.borderColor = '#6366f1'; e.target.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.12)'; e.target.style.background = 'white'; }}
                onBlur={e => { e.target.style.borderColor = '#e2e8f0'; e.target.style.boxShadow = 'none'; e.target.style.background = '#fafbfc'; }}
              />
              <p style={{ fontSize: 11, color: '#94a3b8', margin: '6px 0 0', fontWeight: 500 }}>Leave blank for 24h default</p>
            </div>

            {/* Description */}
            <div>
              <label style={{ ...labelBase, color: fieldErrors.description ? '#dc2626' : '#1e293b' }}>Description * {fieldErrors.description && <span style={{ color: '#dc2626', fontSize: 12 }}>— required</span>}</label>
              <textarea
                value={description}
                onChange={e => { setDescription(e.target.value); setError(''); setFieldErrors(prev => ({ ...prev, description: false })); }}
                placeholder="Describe what you need help with..."
                rows={3}
                style={{ ...inputBase, resize: 'none', minHeight: 80, borderColor: fieldErrors.description ? '#ef4444' : '#e2e8f0', background: fieldErrors.description ? '#fef2f2' : '#fafbfc' }}
                onFocus={e => { e.target.style.borderColor = fieldErrors.description ? '#ef4444' : '#6366f1'; e.target.style.boxShadow = fieldErrors.description ? '0 0 0 3px rgba(239,68,68,0.12)' : '0 0 0 3px rgba(99,102,241,0.12)'; e.target.style.background = 'white'; }}
                onBlur={e => { e.target.style.borderColor = fieldErrors.description ? '#ef4444' : '#e2e8f0'; e.target.style.boxShadow = 'none'; e.target.style.background = fieldErrors.description ? '#fef2f2' : '#fafbfc'; }}
              />
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
                  flex: 1, border: '2px dashed #cbd5e1', borderRadius: 16, padding: '12px 8px',
                  textAlign: 'center', cursor: images.length >= 5 ? 'not-allowed' : 'pointer',
                  opacity: images.length >= 5 ? 0.5 : 1, transition: 'all 0.2s', background: '#f8fafc', minHeight: 72,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                }}>
                  <input type="file" accept="image/*" capture="environment" onChange={handleImageChange} disabled={images.length >= 5} style={{ display: 'none' }} />
                  <div style={{ fontSize: 22, marginBottom: 2 }}>📷</div>
                  <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>Camera</span>
                </label>
                <label style={{
                  flex: 1, border: '2px dashed #cbd5e1', borderRadius: 16, padding: '12px 8px',
                  textAlign: 'center', cursor: images.length >= 5 ? 'not-allowed' : 'pointer',
                  opacity: images.length >= 5 ? 0.5 : 1, transition: 'all 0.2s', background: '#f8fafc', minHeight: 72,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                }}>
                  <input type="file" accept="image/*" multiple onChange={handleImageChange} disabled={images.length >= 5} style={{ display: 'none' }} />
                  <div style={{ fontSize: 22, marginBottom: 2 }}>🖼️</div>
                  <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>Gallery</span>
                </label>
              </div>
              {imagePreviews.length > 0 && (
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  {imagePreviews.map((preview, idx) => (
                    <div key={idx} style={{ position: 'relative', width: 64, height: 64, borderRadius: 12, overflow: 'hidden' }}>
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

            {/* Spacer */}
            <div style={{ flex: 1, minHeight: 10 }} />

            {loading && uploadProgress > 0 && (
              <div style={{ padding: '0 20px 12px' }}>
                <div style={{ height: 6, background: '#e2e8f0', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${uploadProgress}%`, height: '100%', background: '#6366f1', transition: 'width 0.2s', borderRadius: 3 }} />
                </div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 4, fontWeight: 600 }}>Uploading... {uploadProgress}%</div>
              </div>
            )}
            <div style={stickyFooter}>
              <button onClick={handleBack} disabled={loading} style={{
                padding: '14px 20px', borderRadius: 16, border: 'none', fontSize: 15, fontWeight: 700, cursor: 'pointer',
                background: '#f1f5f9', color: '#475569', minHeight: 52,
              }}>← Back</button>
              <button onClick={handleSubmit} disabled={loading} style={{
                flex: 1, padding: '14px 20px', borderRadius: 16, border: 'none', fontSize: 15, fontWeight: 800, cursor: 'pointer',
                background: 'linear-gradient(135deg, #6366f1, #4f46e5)', color: 'white', minHeight: 52,
                boxShadow: '0 4px 16px rgba(99,102,241,0.3)', opacity: loading ? 0.6 : 1,
              }}>{loading ? '⏳ Posting...' : 'Ask the Community'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default PostJobModal;
