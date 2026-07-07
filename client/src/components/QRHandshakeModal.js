import React, { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { Html5Qrcode } from 'html5-qrcode';
import { modalOverlayStyle, modalContentStyle } from '../shared/constants';
import { scrollToRef } from '../shared/workflowFocus';
import useBodyScrollLock from '../shared/useBodyScrollLock';
import { socket } from '../App';

const API_URL = process.env.REACT_APP_API_URL || '';

/* ── Keyframe animations injected once ── */
const animationStyles = `
@keyframes pulse-ring {
  0% { transform: scale(1); opacity: 0.6; }
  100% { transform: scale(1.15); opacity: 0; }
}
@keyframes scan-line {
  0% { top: 0; }
  50% { top: 100%; }
  100% { top: 0; }
}
@keyframes pop-in {
  0% { transform: scale(0.5); opacity: 0; }
  60% { transform: scale(1.1); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}
@keyframes fade-in-up {
  0% { transform: translateY(20px); opacity: 0; }
  100% { transform: translateY(0); opacity: 1; }
}
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
@keyframes pulse-dot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.7); }
}
@keyframes spin-ring {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
@keyframes draw-ring {
  0% { stroke-dashoffset: 283; }
  100% { stroke-dashoffset: 0; }
}`;

/* ── Theme tokens ── */
const themes = {
  start: {
    primary: '#3b82f6',
    secondary: '#6366f1',
    gradient: 'linear-gradient(135deg, #3b82f6, #6366f1)',
    light: '#eff6ff',
    border: '#bfdbfe',
    text: '#1d4ed8',
    shadow: 'rgba(59,130,246,0.25)',
  },
  payment: {
    primary: '#22c55e',
    secondary: '#16a34a',
    gradient: 'linear-gradient(135deg, #22c55e, #16a34a)',
    light: '#f0fdf4',
    border: '#bbf7d0',
    text: '#166534',
    shadow: 'rgba(34,197,94,0.25)',
  },
  waiting: {
    primary: '#f59e0b',
    gradient: 'linear-gradient(135deg, #f59e0b, #d97706)',
    light: '#fffbeb',
    border: '#fde68a',
    text: '#b45309',
    shadow: 'rgba(245,158,11,0.25)',
  },
  error: {
    primary: '#ef4444',
    gradient: 'linear-gradient(135deg, #ef4444, #dc2626)',
    light: '#fee2e2',
    border: '#fecaca',
    text: '#991b1b',
    shadow: 'rgba(239,68,68,0.25)',
  },
};

/* ── Small UI helpers ── */
function StepIndicator({ step, theme }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: theme.primary }}>Step {step} of 2</span>
        <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>
          {step === 1 ? 'Show or scan QR' : 'Confirm with scan'}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          flex: 1, height: 4, borderRadius: 2,
          background: step >= 1 ? theme.gradient : '#e2e8f0',
          transition: 'background 0.3s',
        }} />
        <div style={{
          width: 10, height: 10, borderRadius: '50%',
          background: step >= 1 ? theme.primary : 'white',
          border: `2px solid ${step >= 1 ? theme.primary : '#cbd5e1'}`,
          transition: 'all 0.3s',
        }} />
        <div style={{
          flex: 1, height: 4, borderRadius: 2,
          background: step >= 2 ? theme.gradient : '#e2e8f0',
          transition: 'background 0.3s',
        }} />
        <div style={{
          width: 10, height: 10, borderRadius: '50%',
          background: step >= 2 ? theme.primary : 'white',
          border: `2px solid ${step >= 2 ? theme.primary : '#cbd5e1'}`,
          transition: 'all 0.3s',
        }} />
      </div>
    </div>
  );
}

function PartnerCard({ isPoster, isPaymentMode }) {
  const youLabel = 'You';
  const partnerLabel = isPaymentMode
    ? 'Other Party'
    : isPoster
      ? 'Helper'
      : 'Neighbour';
  const partnerInitial = partnerLabel.charAt(0);
  const yourInitial = youLabel.charAt(0);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14,
      padding: '12px 16px', borderRadius: 16, background: '#f8fafc',
      border: '1px solid #e2e8f0', marginBottom: 16,
    }}>
      {/* You */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        <div style={{
          width: 40, height: 40, borderRadius: '50%',
          background: 'linear-gradient(135deg, #94a3b8, #64748b)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'white', fontWeight: 800, fontSize: 16,
        }}>{yourInitial}</div>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#475569' }}>{youLabel}</span>
      </div>

      {/* Arrow / Handshake */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#94a3b8' }}>
        <span style={{ fontSize: 18 }}>⇄</span>
      </div>

      {/* Partner */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        <div style={{
          width: 40, height: 40, borderRadius: '50%',
          background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'white', fontWeight: 800, fontSize: 16,
        }}>{partnerInitial}</div>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#475569' }}>{partnerLabel}</span>
      </div>
    </div>
  );
}

function CornerBrackets({ size = 260, colors = ['#3b82f6', '#6366f1', '#22c55e', '#f59e0b'] }) {
  const len = 24;
  const thick = 3;
  const styleBase = { position: 'absolute', width: len, height: len, borderStyle: 'solid', borderWidth: thick };
  return (
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none' }}>
      {/* top-left */}
      <div style={{ ...styleBase, top: -6, left: -6, borderColor: `${colors[0]} transparent transparent ${colors[0]}`, borderTopLeftRadius: 8 }} />
      {/* top-right */}
      <div style={{ ...styleBase, top: -6, right: -6, borderColor: `${colors[1]} ${colors[1]} transparent transparent`, borderTopRightRadius: 8 }} />
      {/* bottom-right */}
      <div style={{ ...styleBase, bottom: -6, right: -6, borderColor: `transparent ${colors[2]} ${colors[2]} transparent`, borderBottomRightRadius: 8 }} />
      {/* bottom-left */}
      <div style={{ ...styleBase, bottom: -6, left: -6, borderColor: `transparent transparent ${colors[3]} ${colors[3]}`, borderBottomLeftRadius: 8 }} />
    </div>
  );
}

function CircularProgressRing({ color, size = 80, stroke = 4 }) {
  const radius = (size - stroke) / 2;
  const circ = 2 * Math.PI * radius;
  return (
    <svg width={size} height={size} style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', animation: 'pop-in 0.6s ease-out' }}>
      <circle
        cx={size / 2} cy={size / 2} r={radius}
        fill="none" stroke={color} strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circ}
        style={{ animation: 'draw-ring 1s ease-out forwards', opacity: 0.35 }}
      />
    </svg>
  );
}

function SpinnerOverlay() {
  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 10,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(2px)', borderRadius: 20,
    }}>
      <div style={{
        width: 48, height: 48, borderRadius: '50%',
        border: '4px solid rgba(255,255,255,0.2)',
        borderTopColor: '#ffffff',
        animation: 'spin-ring 0.8s linear infinite',
      }} />
      <div style={{ marginTop: 12, fontSize: 13, fontWeight: 700, color: 'white' }}>Processing…</div>
    </div>
  );
}

function QRHandshakeModal({ jobId, userId, isPoster, onClose, onScanned, handshakeMode = 'start', job }) {
  useBodyScrollLock();
  const isPaymentMode = handshakeMode === 'payment';
  const theme = isPaymentMode ? themes.payment : themes.start;

  // ── Mode selection ──
  // Start mode: poster defaults to scan, helper defaults to show
  // Payment mode: everyone defaults to scan, but tabs allow switching
  const defaultMode = isPaymentMode ? 'scan' : (isPoster ? 'scan' : 'show');
  const [mode, setMode] = useState(defaultMode);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [scanError, setScanError] = useState('');
  const [scanning, setScanning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showManualConfirm, setShowManualConfirm] = useState(false);

  // result: null = normal UI, otherwise shows success screen
  // { phase: 'scan_success'|'show_scanned'|'payment_success',
  //   title, message, subtext, icon }
  const [result, setResult] = useState(null);

  const scannerRef = useRef(null);
  const scannedRef = useRef(false);
  const modalScrollRef = useRef(null);
  const scannerId = `qr-scanner-${handshakeMode}-${String(jobId)}`;

  // Join the job socket room so real-time events reach us even if detail view isn't open
  useEffect(() => {
    if (!socket || !jobId || !userId) return;
    socket.emit('register', userId);
    socket.emit('join_job_room', { jobId, userId });
    return () => {
      socket.emit('leave_job_room', { jobId });
    };
  }, [jobId, userId]);

  const handshakePayload = `sebenza-handshake|${jobId}|${userId}|${handshakeMode}`;

  // Generate QR code
  useEffect(() => {
    QRCode.toDataURL(handshakePayload, {
      width: 280,
      margin: 2,
      color: { dark: '#1e293b', light: '#ffffff' }
    }).then(setQrDataUrl).catch(console.error);
  }, [handshakePayload]);

  // Listen to socket events for "I was scanned" notifications
  useEffect(() => {
    if (!socket || !jobId) return;

    const onHandshakeComplete = (data) => {
      if (String(data.jobId) !== String(jobId)) return;
      // Only show if user is currently SHOWING their QR
      if (mode !== 'show') return;

      if (data.jobStarted) {
        setResult({
          phase: 'show_scanned',
          icon: '🎉',
          title: 'Job Started!',
          message: 'The job is now in progress.',
          subtext: 'Redirecting you to the job workup…',
          color: '#166534',
          bg: '#f0fdf4',
          border: '#bbf7d0',
        });
        // Redirect to workup after a short delay
        setTimeout(() => {
          window.location.href = `/jobs/workhub/${String(jobId)}`;
        }, 2500);
      } else {
        setResult({
          phase: 'show_scanned',
          icon: '⏳',
          title: 'Handshake Recorded',
          message: 'The other party scanned your QR.',
          subtext: 'Awaiting your scan to fully start the job.',
          color: '#166534',
          bg: '#f0fdf4',
          border: '#bbf7d0',
        });
      }
    };

    const onPaymentConfirmed = (data) => {
      if (String(data.jobId) !== String(jobId)) return;

      if (data.confirmed) {
        setResult({
          phase: 'payment_success',
          icon: '🎉',
          title: 'Payment Confirmed!',
          message: data.message || 'Funds have been released.',
          subtext: data.waitTimeMinutes
            ? `Wait time: ${data.waitTimeMinutes} min. You can close this window.`
            : 'The job is now complete. You can close this window.',
          color: '#166534',
          bg: '#f0fdf4',
          border: '#bbf7d0',
        });
      }
    };

    socket.on('device_handshake_complete', onHandshakeComplete);
    socket.on('payment_confirmed', onPaymentConfirmed);

    return () => {
      socket.off('device_handshake_complete', onHandshakeComplete);
      socket.off('payment_confirmed', onPaymentConfirmed);
    };
  }, [socket, jobId, mode]);

  // Camera scanner lifecycle
  useEffect(() => {
    if (mode !== 'scan' || result) return;

    setScanning(true);
    setScanError('');
    scannedRef.current = false;

    const scanner = new Html5Qrcode(scannerId);
    scannerRef.current = scanner;

    const config = { fps: 10, qrbox: { width: 220, height: 220 } };

    const startScanner = async () => {
      try {
        await scanner.start(
          { facingMode: 'environment' },
          config,
          (decodedText) => { handleScan(decodedText); },
          () => {}
        );
      } catch (envErr) {
        console.warn('Rear camera failed, trying any camera:', envErr);
        try {
          const cameras = await Html5Qrcode.getCameras();
          if (cameras && cameras.length > 0) {
            await scanner.start(cameras[0].id, config, (decodedText) => { handleScan(decodedText); }, () => {});
          } else {
            throw new Error('No cameras found');
          }
        } catch (fallbackErr) {
          console.error('Camera start error:', fallbackErr);
          setScanError('Could not start camera. Please ensure camera permissions are granted and you are on HTTPS.');
          setScanning(false);
        }
      }
    };

    startScanner();

    return () => {
      if (scannerRef.current) {
        try { scannerRef.current.stop().catch(() => {}); } catch (e) { /* scanner never started (camera denied) — stop() throws synchronously */ }
        scannerRef.current = null;
      }
      setScanning(false);
      setSubmitting(false);
    };
  }, [mode, result]);

    const handleManualComplete = async () => {
      if (scannedRef.current || submitting) return;
      scannedRef.current = true;
      setSubmitting(true);
      setScanError('');
      if (scannerRef.current) {
        try { scannerRef.current.stop().catch(() => {}); } catch (e) { /* scanner never started (camera denied) — stop() throws synchronously */ }
        scannerRef.current = null;
      }
      setScanning(false);
      
      try {
        // Enhanced error handling with timeout
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Manual completion timeout. Please try again.')), 30000);
        });
        
        const response = await Promise.race([
          onScanned({ jobId: String(jobId), scannedUserId: '', manual: true }),
          timeoutPromise
        ]);
        
        // For payment mode, show payment success; for start mode, redirect to workup
        if (isPaymentMode) {
          setResult({
            phase: 'payment_success',
            icon: '🎉',
            title: 'Payment Confirmed!',
            message: response.message || 'Job manually marked as complete.',
            subtext: response.waitTimeMinutes
              ? `Wait time: ${response.waitTimeMinutes} min. You can close this window.`
              : 'The job is now complete. You can close this window.',
            color: '#166534',
            bg: '#f0fdf4',
            border: '#bbf7d0',
          });
        } else if (response.jobStarted) {
          setResult({
            phase: 'scan_success',
            icon: '🎉',
            title: 'Job Started!',
            message: 'The job is now in progress.',
            subtext: 'Redirecting you to the job workup…',
            color: '#166534',
            bg: '#f0fdf4',
            border: '#bbf7d0',
          });
          setTimeout(() => {
            window.location.href = `/jobs/workhub/${String(jobId)}`;
          }, 2500);
        } else {
          setResult({
            phase: 'scan_success',
            icon: '⏳',
            title: 'Scan Recorded!',
            message: response.message || 'Handshake recorded.',
            subtext: 'Awaiting the other party to confirm.',
            color: '#166534',
            bg: '#f0fdf4',
            border: '#bbf7d0',
          });
        }
        
        // Ensure both parties receive the same events as QR scan
        if (socket && jobId) {
          const room = `job_${jobId}`;
          socket.emit('job_updated', { 
            jobId: String(jobId), 
            type: 'manual_completion',
            timestamp: Date.now(),
            manual: true
          });
          
          console.log(`[Client] Manual completion completed, ensuring socket sync for job ${jobId}`);
        }
        
      } catch (err) {
        console.error('[QR] manual complete failed:', err);
        setSubmitting(false);
        setScanError(err.response?.data?.error || err.message || 'Manual completion failed. Please try again.');
        scannedRef.current = false;
        
        // Enhanced error recovery - reset state if error persists
        if (err.message?.includes('timeout')) {
          setTimeout(() => {
            setScanError('');
            setSubmitting(false);
            scannedRef.current = false;
          }, 2000);
        }
      }
    };

  const handleScan = async (decodedText) => {
    if (!decodedText || scannerRef.current == null || scannedRef.current || submitting) return;

    const parts = decodedText.split('|');
    if (parts.length < 3 || (parts[0] !== 'sebenza-handshake' && parts[0] !== 'gshop-handshake')) {
      setScanError('Invalid QR code. Please scan the correct handshake QR.');
      return;
    }

    const [, scannedJobId, scannedUserId, scannedMode] = parts;

    if (String(scannedJobId) !== String(jobId)) {
      setScanError('This QR code is for a different job.');
      return;
    }
    if (String(scannedUserId) === String(userId)) {
      setScanError('You scanned your own QR code. Please scan the other party\'s code.');
      return;
    }
    if (scannedMode && scannedMode !== handshakeMode) {
      setScanError(scannedMode === 'payment'
        ? 'This is a payment QR code. Please use the payment confirmation flow.'
        : 'This is a start-job QR code. Please use the job start flow.');
      return;
    }

    scannedRef.current = true;
    setSubmitting(true);
    setScanError('');

    if (scannerRef.current) {
      try { scannerRef.current.stop().catch(() => {}); } catch (e) { /* scanner never started (camera denied) — stop() throws synchronously */ }
      scannerRef.current = null;
    }
    setScanning(false);

    try {
      const response = await onScanned({ jobId: scannedJobId, scannedUserId });

      // Show success state inside the modal instead of just closing
      if (isPaymentMode) {
        // Single scan confirms payment immediately
        setResult({
          phase: 'payment_success',
          icon: '🎉',
          title: 'Payment Confirmed!',
          message: response.message || 'Funds have been released.',
          subtext: response.waitTimeMinutes
            ? `Wait time: ${response.waitTimeMinutes} min. You can close this window.`
            : 'The job is now complete. You can close this window.',
          color: '#166534',
          bg: '#f0fdf4',
          border: '#bbf7d0',
        });
      } else {
        // START MODE: Check if job actually started (both parties scanned)
        if (response.jobStarted) {
          setResult({
            phase: 'scan_success',
            icon: '🎉',
            title: 'Job Started!',
            message: 'The job is now in progress.',
            subtext: 'Redirecting you to the job workup…',
            color: '#166534',
            bg: '#f0fdf4',
            border: '#bbf7d0',
          });
          // Redirect to workup after a short delay so user sees the success message
          setTimeout(() => {
            window.location.href = `/jobs/workhub/${String(jobId)}`;
          }, 2500);
        } else {
          setResult({
            phase: 'scan_success',
            icon: '⏳',
            title: 'Scan Recorded!',
            message: response.message || 'Handshake recorded.',
            subtext: 'Awaiting the other party to scan your QR. Keep this window open.',
            color: '#166534',
            bg: '#f0fdf4',
            border: '#bbf7d0',
          });
        }
      }
    } catch (err) {
      console.error('[QR] onScanned failed:', err);
      setSubmitting(false);
      setScanError(err.response?.data?.error || err.message || 'Handshake failed. Please try again.');
      scannedRef.current = false;
    }
  };

  // Auto-close on success after 6 seconds
  useEffect(() => {
    if (!result) return;
    const timer = setTimeout(() => { onClose(); }, 6000);
    return () => clearTimeout(timer);
  }, [result, onClose]);

  const renderResult = () => {
    if (!result) return null;

    const resultTheme = result.phase.includes('error')
      ? themes.error
      : isPaymentMode ? themes.payment : themes.start;

    // Override for start-mode success
    const finalTheme = ((result.phase === 'scan_success' || result.phase === 'show_scanned') && result.icon === '🎉')
      ? themes.start
      : resultTheme;

    const gradientBg = result.phase.includes('error')
      ? 'linear-gradient(180deg, #fef2f2 0%, #ffffff 100%)'
      : isPaymentMode
        ? 'linear-gradient(180deg, #f0fdf4 0%, #ffffff 100%)'
        : 'linear-gradient(180deg, #eff6ff 0%, #ffffff 100%)';

    return (
      <div style={{
        textAlign: 'center', padding: '32px 16px',
        background: gradientBg, borderRadius: 20,
        animation: 'fade-in-up 0.5s ease-out',
      }}>
        {/* Icon with ring */}
        <div style={{ position: 'relative', display: 'inline-block', marginBottom: 20 }}>
          <div style={{ fontSize: 56, lineHeight: 1, animation: 'pop-in 0.6s ease-out', position: 'relative', zIndex: 1 }}>
            {result.icon}
          </div>
          <CircularProgressRing color={finalTheme.primary} size={90} stroke={3} />
        </div>

        <h3 style={{
          margin: '0 0 8px', fontSize: 22, fontWeight: 800,
          color: '#1e293b', animation: 'fade-in-up 0.5s ease-out 0.1s both',
        }}>{result.title}</h3>
        <p style={{
          margin: '0 0 4px', fontSize: 15, color: '#475569', fontWeight: 600,
          animation: 'fade-in-up 0.5s ease-out 0.2s both',
        }}>{result.message}</p>
        <p style={{
          margin: '0 0 24px', fontSize: 13, color: '#94a3b8',
          animation: 'fade-in-up 0.5s ease-out 0.25s both',
        }}>{result.subtext}</p>

        {result.phase === 'payment_success' && (
          <div style={{
            background: finalTheme.light, borderRadius: 16, padding: '14px 18px',
            marginBottom: 24, border: `1px solid ${finalTheme.border}`,
            boxShadow: `0 4px 12px ${finalTheme.shadow}`,
            animation: 'fade-in-up 0.5s ease-out 0.3s both',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 16 }}>➤</span>
              <span style={{ fontSize: 13, fontWeight: 800, color: finalTheme.text }}>What to do next</span>
            </div>
            <div style={{ fontSize: 12, color: finalTheme.text, lineHeight: 1.6, paddingLeft: 24 }}>
              View the completion summary to see work photos, leave a review, and check payment details.
            </div>
          </div>
        )}

        {result.phase === 'scan_success' && (
          <div style={{
            background: finalTheme.light, borderRadius: 16, padding: '14px 18px',
            marginBottom: 24, border: `1px solid ${finalTheme.border}`,
            boxShadow: `0 4px 12px ${finalTheme.shadow}`,
            animation: 'fade-in-up 0.5s ease-out 0.3s both',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 16 }}>➤</span>
              <span style={{ fontSize: 13, fontWeight: 800, color: finalTheme.text }}>What to do next</span>
            </div>
            <div style={{ fontSize: 12, color: finalTheme.text, lineHeight: 1.6, paddingLeft: 24 }}>
              The job is now in progress. You can track it in your Active jobs. When the work is done, come back to mark it complete and confirm payment.
            </div>
          </div>
        )}

        <button onClick={onClose} style={{
          padding: '12px 32px', borderRadius: 14, border: 'none', fontSize: 15, fontWeight: 700, cursor: 'pointer',
          background: isPaymentMode ? themes.payment.gradient : themes.start.gradient,
          color: 'white', minHeight: 48,
          boxShadow: `0 4px 16px ${isPaymentMode ? themes.payment.shadow : themes.start.shadow}`,
          animation: 'fade-in-up 0.5s ease-out 0.35s both',
        }}>
          {'Close Window'}
        </button>

        <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 10, animation: 'fade-in-up 0.5s ease-out 0.4s both' }}>
          Closing automatically in a few seconds…
        </p>
      </div>
    );
  };

  // Determine current step for indicator
  const currentStep = isPaymentMode ? 2 : (mode === 'show' ? 1 : 2);

  useEffect(() => {
    const t = scrollToRef(modalScrollRef, { delay: 60, block: 'start' });
    return () => clearTimeout(t);
  }, [mode, result, currentStep]);

  // Header config
  const headerTitle = isPaymentMode ? '💰 Confirm Payment (QR Scan)' : '📱 Start the Job';
  const headerGradient = isPaymentMode
    ? 'linear-gradient(135deg, #22c55e, #16a34a)'
    : 'linear-gradient(135deg, #3b82f6, #6366f1)';

  return (
    <>
      <style>{animationStyles}</style>
      <div style={{ ...modalOverlayStyle, padding: window.innerWidth < 640 ? 0 : modalOverlayStyle.padding }} onClick={() => { if (result) onClose(); }}>
        <div style={{
          ...modalContentStyle(400),
          maxHeight: window.innerWidth < 640 ? '100dvh' : '90vh',
          ...(window.innerWidth < 640 ? { width: '100vw', maxWidth: '100vw', height: '100dvh', borderRadius: 0 } : {}),
          overflowY: 'auto', padding: 0
        }} onClick={e => e.stopPropagation()}>
          {/* Enhanced Header */}
          <div style={{
            background: headerGradient,
            padding: '18px 20px 14px',
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            color: 'white',
            marginBottom: result ? 0 : 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <h3 style={{ margin: 0, fontSize: 'clamp(18px, 4vw, 20px)', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 24 }}>{isPaymentMode ? '💰' : '📱'}</span>
              {headerTitle}
            </h3>
            <button
              onClick={onClose}
              aria-label="Close"
              style={{
                width: 40,
                height: 40,
                borderRadius: '50%',
                border: '1px solid rgba(255,255,255,0.35)',
                background: 'rgba(255,255,255,0.15)',
                color: 'white',
                fontSize: 20,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              ✕
            </button>
          </div>

          <div ref={modalScrollRef} style={{ padding: '20px 20px 0' }}>
            {/* Role instruction banner */}
            {!result && (
              <div style={{
                marginBottom: 16, padding: 10, borderRadius: 12,
                background: isPaymentMode ? themes.payment.light : (isPoster ? themes.start.light : themes.payment.light),
                border: `1px solid ${isPaymentMode ? themes.payment.border : (isPoster ? themes.start.border : themes.payment.border)}`,
                fontSize: 12, fontWeight: 600,
                color: isPaymentMode ? themes.payment.text : (isPoster ? themes.start.text : themes.payment.text),
              }}>
                {isPaymentMode
                  ? (mode === 'scan'
                      ? '💰 Scan your neighbour\'s QR code to confirm payment — only ONE of you needs to scan.'
                      : '💰 Show your QR code so your neighbour can scan it — only ONE scan is needed to confirm payment.')
                  : (mode === 'scan'
                      ? 'Scan your neighbour\'s QR code to start the job — only ONE of you needs to scan.'
                      : 'Show your QR code so your neighbour can scan it — only ONE scan is needed to start the job.')}
              </div>
            )}

            {/* Partner card + step indicator removed from above the QR: they
                pushed the code/scanner below the fold on phones, forcing users
                to scroll to line up a scan. QR must be visible immediately. */}

            {/* Result overlay */}
            {result ? renderResult() : (
              <>
                {(() => {
                  // Both modes: show tabs so either party can scan or show
                  const scanLabel = isPaymentMode ? 'Scan QR' : 'Scan Helper QR';
                  const showLabel = isPaymentMode ? 'Show My QR' : 'Show My QR';
                  return (
                    <div style={{ display: 'flex', gap: 6, marginBottom: 20, background: '#f1f5f9', padding: 4, borderRadius: 16 }}>
                      <button onClick={() => { setMode('scan'); setScanError(''); }} style={{
                        flex: 1, padding: '10px 14px', borderRadius: 12, border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                        background: mode === 'scan' ? 'white' : 'transparent',
                        color: mode === 'scan' ? theme.secondary : '#64748b',
                        boxShadow: mode === 'scan' ? '0 2px 8px rgba(0,0,0,0.06)' : 'none',
                        transition: 'all 0.2s',
                      }}>{scanLabel}</button>
                      <button onClick={() => { setMode('show'); setScanError(''); }} style={{
                        flex: 1, padding: '10px 14px', borderRadius: 12, border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                        background: mode === 'show' ? 'white' : 'transparent',
                        color: mode === 'show' ? theme.secondary : '#64748b',
                        boxShadow: mode === 'show' ? '0 2px 8px rgba(0,0,0,0.06)' : 'none',
                        transition: 'all 0.2s',
                      }}>{showLabel}</button>
                    </div>
                  );
                })()}

                {mode === 'show' && (
                  <div style={{ textAlign: 'center' }}>
                    {/* Partner card mini */}
                    <div style={{
                      display: 'inline-flex', alignItems: 'center', gap: 10,
                      padding: '10px 18px', borderRadius: 50, background: theme.light,
                      border: `1px solid ${theme.border}`, marginBottom: 20,
                    }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: '50%',
                        background: theme.gradient,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: 'white', fontWeight: 800, fontSize: 14,
                      }}>
                        {(isPaymentMode ? 'Other Party' : isPoster ? 'Helper' : 'Neighbour').charAt(0)}
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 700, color: theme.text }}>
                        You're meeting: {isPaymentMode ? 'Other Party' : isPoster ? 'Helper' : 'Neighbour'}
                      </span>
                    </div>

                    <div style={{ fontSize: 13, color: '#475569', marginBottom: 16, fontWeight: 600 }}>
                      {isPaymentMode
                        ? 'Show this code to the other party so they can scan you for payment confirmation.'
                        : (isPoster ? 'Show this code to your helper if they need to scan you.' : 'Show this code to your neighbour.')}
                    </div>

                    {/* QR wrapper with pulse + brackets */}
                    <div style={{ position: 'relative', display: 'inline-block' }}>
                      {/* Pulse ring */}
                      <div style={{
                        position: 'absolute', inset: -10, borderRadius: 30,
                        border: `2px solid ${theme.primary}`,
                        animation: 'pulse-ring 2s ease-out infinite',
                        opacity: 0.6, pointerEvents: 'none',
                      }} />
                      <div style={{
                        position: 'relative', display: 'inline-block', padding: 16,
                        background: 'white', borderRadius: 20,
                        boxShadow: `0 8px 30px ${theme.shadow}`,
                        border: '1px solid #e2e8f0',
                      }}>
                        {qrDataUrl ? (
                          <img src={qrDataUrl} alt="Handshake QR" style={{ width: 260, height: 260, display: 'block', borderRadius: 8 }} />
                        ) : (
                          <div style={{
                            width: 260, height: 260, borderRadius: 8,
                            background: 'linear-gradient(90deg, #e2e8f0 25%, #f1f5f9 50%, #e2e8f0 75%)',
                            backgroundSize: '200% 100%',
                            animation: 'shimmer 1.5s infinite',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: '#94a3b8', fontWeight: 700,
                          }}>Generating…</div>
                        )}
                        <CornerBrackets size={260} colors={[
                          theme.primary, theme.secondary,
                          isPaymentMode ? '#16a34a' : '#3b82f6',
                          isPaymentMode ? '#f59e0b' : '#6366f1',
                        ]} />
                      </div>
                    </div>

                    <div style={{ marginTop: 14, fontSize: 12, color: '#94a3b8', fontWeight: 500 }}>
                      📱 Hold your phone steady so they can scan easily
                    </div>
                    <div style={{ marginTop: 8, fontSize: 11, color: '#cbd5e1', fontFamily: 'monospace' }}>
                      Job ID: <span style={{ color: '#94a3b8' }}>{String(jobId)?.slice(-8)}</span>
                    </div>
                  </div>
                )}

                {mode === 'scan' && (
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 13, color: '#475569', marginBottom: 16, fontWeight: 600 }}>
                      {submitting
                        ? 'Processing handshake…'
                        : 'Point your camera at the helper\'s QR code.'}
                    </div>

                    {/* Scanner container with overlays */}
                    <div style={{ position: 'relative', maxWidth: 320, margin: '0 auto' }}>
                      <div id={scannerId} style={{
                        width: '100%',
                        maxWidth: 320,
                        height: 320,
                        margin: '0 auto',
                        borderRadius: 20,
                        overflow: 'hidden',
                        border: `2px solid ${theme.border}`,
                        background: '#0f172a',
                        opacity: submitting ? 0.5 : 1,
                        pointerEvents: submitting ? 'none' : 'auto',
                        transition: 'opacity 0.2s',
                        position: 'relative',
                      }} />

                      {/* Corner brackets overlay */}
                      {!submitting && (
                        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', borderRadius: 20, overflow: 'hidden' }}>
                          <CornerBrackets size={320} colors={[
                            theme.primary, theme.secondary,
                            isPaymentMode ? '#16a34a' : '#3b82f6',
                            isPaymentMode ? '#f59e0b' : '#6366f1',
                          ]} />
                        </div>
                      )}

                      {/* Scanning line */}
                      {!submitting && scanning && (
                        <div style={{
                          position: 'absolute', left: '10%', right: '10%',
                          height: 2, background: theme.primary,
                          boxShadow: `0 0 8px ${theme.primary}`,
                          animation: 'scan-line 2.5s ease-in-out infinite',
                          pointerEvents: 'none',
                        }} />
                      )}

                      {/* Spinner overlay on submit */}
                      {submitting && <SpinnerOverlay />}
                    </div>

                    {scanning && !submitting && (
                      <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                        <span style={{
                          width: 8, height: 8, borderRadius: '50%', background: theme.primary,
                          animation: 'pulse-dot 1.2s ease-in-out infinite',
                        }} />
                        <span style={{
                          width: 8, height: 8, borderRadius: '50%', background: theme.primary,
                          animation: 'pulse-dot 1.2s ease-in-out 0.3s infinite',
                        }} />
                        <span style={{
                          width: 8, height: 8, borderRadius: '50%', background: theme.primary,
                          animation: 'pulse-dot 1.2s ease-in-out 0.6s infinite',
                        }} />
                        <span style={{ fontSize: 12, color: theme.primary, fontWeight: 700, marginLeft: 4 }}>Scanning…</span>
                      </div>
                    )}
                    {submitting && (
                      <div style={{ marginTop: 14, fontSize: 12, color: theme.primary, fontWeight: 700 }}>
                        {isPaymentMode ? '⏳ Confirming payment, please wait…' : '⏳ Starting job, please wait…'}
                      </div>
                    )}
                    {scanError && (
                      <div style={{
                        marginTop: 14, padding: 12, borderRadius: 12,
                        background: themes.error.light, color: themes.error.text,
                        fontSize: 12, fontWeight: 600, border: `1px solid ${themes.error.border}`,
                      }}>
                        ⚠️ {scanError}
                      </div>
                    )}

                    {/* Manual fallback — available in BOTH modes for when the camera misbehaves */}
                    {!showManualConfirm ? (
                      <button
                        onClick={() => setShowManualConfirm(true)}
                        style={{
                          marginTop: 14, padding: '10px 20px', borderRadius: 12, border: '1.5px dashed #cbd5e1',
                          background: '#f8fafc', color: '#64748b', fontSize: 12, fontWeight: 700,
                          cursor: 'pointer', width: '100%',
                        }}
                      >
                        {isPaymentMode ? '✋ Confirm Payment Manually (camera issues?)' : '✋ Start Job Manually (camera issues?)'}
                      </button>
                    ) : (
                      <div style={{
                        marginTop: 14, padding: 14, borderRadius: 14,
                        background: '#fef2f2', border: '1.5px solid #fca5a5',
                      }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#991b1b', marginBottom: 8 }}>
                          {isPaymentMode
                            ? '⚠️ Manually confirm payment for this job?'
                            : '⚠️ Manually confirm you\'ve met in person and start the job?'}
                        </div>
                        <div style={{ fontSize: 12, color: '#7f1d1d', marginBottom: 12 }}>
                          This skips the QR scan. Only use it when the camera won't work.
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            onClick={handleManualComplete}
                            disabled={submitting}
                            style={{
                              flex: 1, padding: '10px', borderRadius: 10, border: 'none',
                              fontSize: 13, fontWeight: 700, cursor: submitting ? 'not-allowed' : 'pointer',
                              background: '#ef4444', color: 'white', opacity: submitting ? 0.6 : 1,
                            }}
                          >
                            {submitting ? '⏳ Confirming…' : (isPaymentMode ? 'Yes, Confirm Payment' : 'Yes, Start Job')}
                          </button>
                          <button
                            onClick={() => setShowManualConfirm(false)}
                            disabled={submitting}
                            style={{
                              padding: '10px 16px', borderRadius: 10, border: 'none',
                              fontSize: 13, fontWeight: 700, cursor: 'pointer',
                              background: '#f1f5f9', color: '#475569',
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* Bottom Close */}
            {!result && (
              <div style={{ position: 'sticky', bottom: 0, background: 'white', borderTop: '1px solid #e2e8f0', padding: '12px 0 14px', marginTop: 12, zIndex: 5 }}>
                <button
                  onClick={onClose}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    borderRadius: 12,
                    border: 'none',
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: 'pointer',
                    background: '#f1f5f9',
                    color: '#475569',
                    minHeight: 44,
                  }}
                >
                  Cancel
                </button>
              </div>
            )}

          </div>
        </div>
      </div>
    </>
  );
}

export default QRHandshakeModal;
