import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, X, Trash2, CheckCircle2 } from './Icons';
import useHardwareBackClose from '../shared/useHardwareBackClose';

const API_URL = process.env.REACT_APP_API_URL || '';

const TYPE_CONFIG = {
  job_posted:           { color: '#3b82f6', icon: '📝', bg: '#eff6ff', route: '/jobs', actionLabel: 'View', actionType: 'secondary' },
  service_listed:       { color: '#8b5cf6', icon: '💼', bg: '#f5f3ff', route: '/map', actionLabel: 'View on Map', actionType: 'primary' },
  application_received: { color: '#3b82f6', icon: '💼', bg: '#eff6ff', route: '/jobs', actionLabel: 'Review', actionType: 'primary' },
  application_approved: { color: '#22c55e', icon: '✅', bg: '#f0fdf4', route: '/jobs', actionLabel: 'Confirm Now →', actionType: 'primary' },
  negotiation_updated:  { color: '#f97316', icon: '🤝', bg: '#fff7ed', route: '/jobs', actionLabel: 'View', actionType: 'secondary' },
  offer_accepted:       { color: '#22c55e', icon: '✅', bg: '#f0fdf4', route: '/jobs', actionLabel: 'View', actionType: 'primary' },
  offer_rejected:       { color: '#ef4444', icon: '❌', bg: '#fef2f2', route: '/jobs', actionLabel: 'View', actionType: 'secondary' },
  schedule_confirmed:   { color: '#22c55e', icon: '📅', bg: '#f0fdf4', route: '/transactions', actionLabel: 'View', actionType: 'primary' },
  schedule_declined:    { color: '#f97316', icon: '📅', bg: '#fff7ed', route: '/jobs', actionLabel: 'View', actionType: 'secondary' },
  job_started:          { color: '#22c55e', icon: '🚀', bg: '#f0fdf4', route: '/transactions', actionLabel: 'View Job', actionType: 'primary' },
  photos_uploaded:      { color: '#a855f7', icon: '📸', bg: '#faf5ff', route: '/transactions', actionLabel: 'View', actionType: 'primary' },
  completion_requested: { color: '#f97316', icon: '🔔', bg: '#fff7ed', route: '/transactions', actionLabel: 'Confirm', actionType: 'primary' },
  job_completed:        { color: '#22c55e', icon: '🏆', bg: '#f0fdf4', route: '/work', actionLabel: 'View', actionType: 'primary' },
  job_cancelled:        { color: '#ef4444', icon: '🚫', bg: '#fef2f2', route: '/jobs', actionLabel: 'View', actionType: 'secondary' },
  application_rejected: { color: '#ef4444', icon: '❌', bg: '#fef2f2', route: '/jobs', actionLabel: 'View', actionType: 'secondary' },
  application_withdrawn:{ color: '#64748b', icon: '🚪', bg: '#f8fafc', route: '/jobs', actionLabel: 'View', actionType: 'secondary' },
  rating_received:      { color: '#eab308', icon: '⭐', bg: '#fefce8', route: '/profile', actionLabel: 'View', actionType: 'primary' },
  review_submitted:     { color: '#eab308', icon: '⭐', bg: '#fefce8', route: '/transactions', actionLabel: 'View', actionType: 'primary' },
  chat_message:         { color: '#3b82f6', icon: '💬', bg: '#eff6ff', route: '/transactions', actionLabel: 'Open', actionType: 'primary' },
  payment_confirmed:    { color: '#22c55e', icon: '💰', bg: '#f0fdf4', route: '/work', actionLabel: 'View Summary', actionType: 'primary' },
  doorbell_rung:        { color: '#f59e0b', icon: '🔔', bg: '#fffbeb', route: '/jobs', actionLabel: 'Open', actionType: 'primary' },
  job_pending_payment:  { color: '#8b5cf6', icon: '💳', bg: '#f5f3ff', route: '/jobs', actionLabel: 'Scan QR', actionType: 'primary' },
  qr_handshake_ready:   { color: '#3b82f6', icon: '📱', bg: '#eff6ff', route: '/jobs', actionLabel: 'Open QR', actionType: 'primary' },
  job_nearby:           { color: '#3b82f6', icon: '📍', bg: '#eff6ff', route: '/jobs', actionLabel: 'View', actionType: 'primary' },
  service_nearby:       { color: '#8b5cf6', icon: '💼', bg: '#f5f3ff', route: '/map', actionLabel: 'View Map', actionType: 'primary' },
  issue_reported:       { color: '#ef4444', icon: '⚠️', bg: '#fef2f2', route: '/jobs', actionLabel: 'View Issue', actionType: 'primary' },
};

// Critical notifications that require action and should NOT auto-dismiss.
// These trigger the full-screen action popup + sound + vibration.
const CRITICAL_TYPES = ['application_received', 'negotiation_updated', 'application_approved', 'offer_accepted', 'offer_rejected', 'schedule_confirmed', 'job_started', 'completion_requested', 'job_pending_payment', 'issue_reported'];

const DEFAULT_CONFIG = { color: '#64748b', icon: '📢', bg: '#f8fafc', route: '/dashboard', actionLabel: 'View', actionType: 'secondary' };

const WORK_HUB_TYPES = new Set([
  'job_started',
  'completion_requested',
  'job_pending_payment',
  'payment_confirmed',
  'job_completed',
  'photos_uploaded',
  'issue_reported',
  'doorbell_rung'
]);

function resolveNotificationRoute(notif, fallbackRoute) {
  if (notif?.jobId) {
    if (WORK_HUB_TYPES.has(notif.type)) return `/jobs/workhub/${notif.jobId}`;
    return `/jobs?view=${notif.jobId}`;
  }
  if (notif?.transactionId) return `/transactions?view=${notif.transactionId}`;
  if (notif?.serviceId) return `/map?view=${notif.serviceId}`;
  return fallbackRoute;
}

function playNotificationSound() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioContext();
    const now = ctx.currentTime;
    
    // Louder triple-beep pattern
    const frequencies = [880, 1100, 880];
    const times = [0, 0.2, 0.4];
    
    frequencies.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + times[i]);
      gain.gain.setValueAtTime(0, now + times[i]);
      gain.gain.linearRampToValueAtTime(0.4, now + times[i] + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + times[i] + 0.18);
      osc.start(now + times[i]);
      osc.stop(now + times[i] + 0.2);
    });
  } catch (e) { /* ignore */ }
}

function timeAgo(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const seconds = Math.floor((now - date) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;
  return date.toLocaleDateString();
}

function formatGroupDate(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (d.getTime() === today.getTime()) return 'Today';
  if (d.getTime() === yesterday.getTime()) return 'Yesterday';
  const dayOfWeek = now.getDay();
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - dayOfWeek);
  if (d >= startOfWeek && d < yesterday) return 'Earlier this week';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

function groupByDate(notifications) {
  const groups = {};
  notifications.forEach(n => {
    const key = formatGroupDate(n.createdAt);
    if (!groups[key]) groups[key] = [];
    groups[key].push(n);
  });
  return groups;
}

function getSender(notif) {
  return notif.sender || notif.from || notif.fromUser || null;
}

function getSenderName(notif) {
  const s = getSender(notif);
  if (!s) return notif.userName || '';
  return s.name || s.username || s.displayName || notif.userName || '';
}

function getSenderAvatar(notif) {
  const s = getSender(notif);
  return s?.avatar || s?.avatarUrl || null;
}

function getSenderInitials(notif) {
  const name = getSenderName(notif);
  return name ? name.charAt(0).toUpperCase() : '?';
}

function getSenderColor(notif) {
  const colors = ['#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#8b5cf6','#ec4899','#14b8a6'];
  const str = getSenderName(notif) || notif._id || '';
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

export default function NotificationSystem({ user, socket, panelOpen: controlledPanel, onTogglePanel, hideBell }) {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [internalPanel, setInternalPanel] = useState(false);
  const panelOpen = controlledPanel !== undefined ? controlledPanel : internalPanel;
  const setPanelOpen = (v) => {
    if (onTogglePanel) onTogglePanel(v);
    else setInternalPanel(v);
  };
  const [loading, setLoading] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [activeFilter, setActiveFilter] = useState('all');
  const [badgePulse, setBadgePulse] = useState(false);
  const panelRef = useRef(null);
  const timeoutsRef = useRef([]);
  const swipeRef = useRef({});
  // Full-screen "action required" popup for critical notifications — the user
  // must tap Proceed or Close, so nothing important slips by silently.
  const [actionPopup, setActionPopup] = useState(null);
  // Ids already announced (toast/sound/popup) — lets the 15s polling fallback
  // announce notifications the socket missed instead of adding them silently.
  const seenIdsRef = useRef(null); // null = first fetch not done yet
  const announceRef = useRef(null);

  // Phone back button dismisses the popup instead of exiting/navigating
  useHardwareBackClose(!!actionPopup, () => setActionPopup(null));

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    return () => {
      timeoutsRef.current.forEach(clearTimeout);
    };
  }, []);

  const getToken = useCallback(() => localStorage.getItem('token'), []);

  const fetchNotifications = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/notifications`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      if (res.ok) {
        const data = await res.json();
        const notifs = Array.isArray(data) ? data : (data.notifications || []);
        setNotifications(notifs);

        // Announce critical notifications the socket missed (silent-arrival fix).
        if (seenIdsRef.current === null) {
          // First fetch after app open: don't re-alert the whole backlog.
          seenIdsRef.current = new Set(notifs.map(n => n._id));
        } else {
          const fresh = notifs.filter(n => n._id && !seenIdsRef.current.has(n._id));
          fresh.forEach(n => seenIdsRef.current.add(n._id));
          fresh
            .filter(n => !n.read && CRITICAL_TYPES.includes(n.type))
            .forEach(n => { if (announceRef.current) announceRef.current(n); });
        }
      }
    } catch (err) {
      console.error('Failed to fetch notifications', err);
    } finally {
      setLoading(false);
    }
  }, [user, getToken]);

  // Fetch on mount AND poll every 15 seconds as fallback for missed socket events
  useEffect(() => {
    if (!user) return;
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 15000);
    return () => clearInterval(interval);
  }, [user, fetchNotifications]);

  // Re-fetch immediately when tab becomes visible (catch up on missed notifications)
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        fetchNotifications();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [fetchNotifications]);

  useEffect(() => {
    if (!socket) return;
    const handler = (notif) => {
      const isCritical = CRITICAL_TYPES.includes(notif.type);

      if (notif._id && seenIdsRef.current) seenIdsRef.current.add(notif._id);

      setNotifications(prev => {
        const exists = prev.find(n => n._id === notif._id);
        if (exists) return prev;
        return [notif, ...prev];
      });

      // Critical: large blocking popup the user must tap (Proceed / Close)
      if (isCritical) setActionPopup(notif);

      const toastId = notif._id || Date.now() + Math.random();
      setToasts(prev => [...prev, { ...notif, toastId, isCritical }]);

      // Critical notifications stay on screen until manually dismissed
      if (!isCritical) {
        const timer = setTimeout(() => {
          setToasts(prev => prev.filter(t => t.toastId !== toastId));
        }, 6000);
        timeoutsRef.current.push(timer);
      }

      if (notif.type === 'job_started') {
        const pid = 'progress-' + toastId;
        setToasts(prev => [...prev, {
          toastId: pid,
          kind: 'progress',
          title: 'Step 1 complete ✅',
          message: 'When work is done, come back to confirm payment',
          type: notif.type,
          createdAt: new Date().toISOString()
        }]);
      }
      if (notif.type === 'job_pending_payment') {
        const pid = 'progress-' + toastId;
        setToasts(prev => [...prev, {
          toastId: pid,
          kind: 'progress',
          title: 'Step 2 of 2',
          message: 'Scan QR code to confirm payment',
          type: notif.type,
          createdAt: new Date().toISOString()
        }]);
      }

      // Notify other components to refresh job data when a job-related notification arrives
      if (notif.jobId) {
        window.dispatchEvent(new CustomEvent('sebenza:refresh-jobs', {
          detail: { jobId: notif.jobId, type: notif.type }
        }));
      }

      // When the next step is a QR scan, both devices should open the QR
      // screen automatically — JobBoard listens for this.
      const QR_NEXT = { schedule_confirmed: 'start', job_pending_payment: 'payment' };
      if (notif.jobId && QR_NEXT[notif.type]) {
        window.dispatchEvent(new CustomEvent('sebenza:auto-qr', {
          detail: { jobId: notif.jobId, mode: QR_NEXT[notif.type] }
        }));
      }

      playNotificationSound();

      // Show system notification if page is hidden/background
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        try {
          new Notification(notif.title || 'Sebenza', {
            body: notif.message || '',
            icon: '/favicon.ico',
            badge: '/favicon.ico',
            tag: notif.jobId ? String(notif.jobId) : String(notif._id),
            requireInteraction: isCritical,
          });
        } catch (e) { /* ignore */ }
      }

      // Vibrate on mobile for critical notifications
      if (isCritical && navigator.vibrate) {
        navigator.vibrate([200, 100, 200]);
      }
    };
    socket.on('notification', handler);
    // Polling fallback reuses the exact same announcement path
    announceRef.current = handler;

    // Listen for chat notifications (when someone messages you while you're not in the chat)
    const chatHandler = (data) => {
      const toastId = 'chat-' + data.transactionId + '-' + Date.now();
      setToasts(prev => [...prev, {
        toastId,
        type: 'chat_message',
        title: 'New Message',
        message: data.text || 'Someone sent you a message',
        transactionId: data.transactionId,
        senderId: data.senderId,
        isCritical: false,
        createdAt: new Date().toISOString()
      }]);
      playNotificationSound();
      const timer = setTimeout(() => {
        setToasts(prev => prev.filter(t => t.toastId !== toastId));
      }, 6000);
      timeoutsRef.current.push(timer);
    };
    socket.on('chat_notification', chatHandler);

    // Listen for nearby job posts (new job posted in your area)
    const nearbyJobHandler = (data) => {
      const toastId = 'nearby-job-' + data.jobId + '-' + Date.now();
      setToasts(prev => [...prev, {
        toastId,
        type: 'job_posted',
        title: 'New Job Nearby',
        message: data.title || 'A new job was posted near you',
        jobId: data.jobId,
        isCritical: false,
        createdAt: new Date().toISOString()
      }]);
      playNotificationSound();
      const timer = setTimeout(() => {
        setToasts(prev => prev.filter(t => t.toastId !== toastId));
      }, 8000);
      timeoutsRef.current.push(timer);
      // Refresh jobs list
      window.dispatchEvent(new CustomEvent('sebenza:refresh-jobs', { detail: { type: 'nearby_job_posted' } }));
    };
    socket.on('new_job_nearby', nearbyJobHandler);

    // Listen for nearby service listings (new pro service near you)
    const nearbyServiceHandler = (data) => {
      const toastId = 'nearby-svc-' + data.serviceId + '-' + Date.now();
      setToasts(prev => [...prev, {
        toastId,
        type: 'service_listed',
        title: 'New Service Nearby',
        message: data.title || 'A new professional service is available near you',
        serviceId: data.serviceId,
        isCritical: false,
        createdAt: new Date().toISOString()
      }]);
      playNotificationSound();
      const timer = setTimeout(() => {
        setToasts(prev => prev.filter(t => t.toastId !== toastId));
      }, 8000);
      timeoutsRef.current.push(timer);
      // Refresh services list
      window.dispatchEvent(new CustomEvent('sebenza:refresh-services', { detail: { type: 'nearby_service_posted' } }));
    };
    socket.on('new_service_nearby', nearbyServiceHandler);

    return () => {
      announceRef.current = null;
      socket.off('notification', handler);
      socket.off('chat_notification', chatHandler);
      socket.off('new_job_nearby', nearbyJobHandler);
      socket.off('new_service_nearby', nearbyServiceHandler);
    };
  }, [socket]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        setPanelOpen(false);
      }
    }
    if (panelOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [panelOpen, setPanelOpen]);

  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape') setPanelOpen(false);
    }
    if (panelOpen) {
      window.addEventListener('keydown', handleKey);
    }
    return () => window.removeEventListener('keydown', handleKey);
  }, [panelOpen, setPanelOpen]);

  const unreadCount = notifications.filter(n => !n.read).length;

  useEffect(() => {
    if (unreadCount > 0) {
      setBadgePulse(true);
      const t = setTimeout(() => setBadgePulse(false), 900);
      return () => clearTimeout(t);
    }
  }, [unreadCount]);

  const dismissToast = (toastId) => {
    setToasts(prev => prev.filter(t => t.toastId !== toastId));
  };

  const handleToastClick = (notif) => {
    const config = TYPE_CONFIG[notif.type] || DEFAULT_CONFIG;
    navigate(resolveNotificationRoute(notif, config.route));
    dismissToast(notif.toastId);
    if (!notif.read && notif._id) markAsRead(notif._id);
  };

  async function markAsRead(id) {
    try {
      const res = await fetch(`${API_URL}/api/notifications/${id}/read`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' }
      });
      if (res.ok) {
        setNotifications(prev => prev.map(n => n._id === id ? { ...n, read: true } : n));
      }
    } catch (err) {
      console.error('Failed to mark as read', err);
    }
  }

  async function markAllAsRead() {
    try {
      const res = await fetch(`${API_URL}/api/notifications/read-all`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' }
      });
      if (res.ok) {
        setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      }
    } catch (err) {
      console.error('Failed to mark all as read', err);
    }
  }

  async function deleteNotification(id) {
    try {
      const res = await fetch(`${API_URL}/api/notifications/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      if (res.ok) {
        setNotifications(prev => prev.filter(n => n._id !== id));
      }
    } catch (err) {
      console.error('Failed to delete notification', err);
    }
  }

  async function clearAll() {
    try {
      const res = await fetch(`${API_URL}/api/notifications`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      if (res.ok) {
        setNotifications([]);
      }
    } catch (err) {
      console.error('Failed to clear notifications', err);
    }
  }

  const handleNotificationClick = (notif) => {
    const config = TYPE_CONFIG[notif.type] || DEFAULT_CONFIG;
    navigate(resolveNotificationRoute(notif, config.route));
    setPanelOpen(false);
    if (!notif.read) markAsRead(notif._id);
  };

  const filteredNotifications = activeFilter === 'unread' ? notifications.filter(n => !n.read) : notifications;
  const grouped = groupByDate(filteredNotifications);

  const onTouchStart = (toastId) => (e) => {
    swipeRef.current[toastId] = { startX: e.touches[0].clientX, currentX: 0 };
  };

  const onTouchMove = (toastId) => (e) => {
    const state = swipeRef.current[toastId];
    if (!state || !e.touches.length) return;
    const dx = e.touches[0].clientX - state.startX;
    state.currentX = dx;
    const el = e.currentTarget;
    el.style.transform = `translateX(${dx}px)`;
    el.style.opacity = String(Math.max(0.25, 1 - Math.abs(dx) / 250));
  };

  const onTouchEnd = (toastId) => (e) => {
    const state = swipeRef.current[toastId];
    if (!state) return;
    if (Math.abs(state.currentX) > 100) {
      dismissToast(toastId);
    } else {
      const el = e.currentTarget;
      el.style.transform = 'translateX(0)';
      el.style.opacity = '1';
    }
    delete swipeRef.current[toastId];
  };

  const bellStyle = {
    position: 'fixed',
    top: isMobile ? '16px' : '72px',
    right: '16px',
    zIndex: 10070,
    width: '44px',
    height: '44px',
    borderRadius: '50%',
    background: 'white',
    boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    border: 'none',
    padding: 0,
    transition: 'transform 0.15s ease, box-shadow 0.15s ease',
  };

  const badgeStyle = {
    position: 'absolute',
    top: '-2px',
    right: '-2px',
    background: '#ef4444',
    color: 'white',
    borderRadius: '50%',
    width: '20px',
    height: '20px',
    fontSize: '11px',
    fontWeight: 'bold',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '2px solid white',
    pointerEvents: 'none',
  };

  const panelStyle = {
    position: 'fixed',
    top: isMobile ? '64px' : '120px',
    right: '8px',
    zIndex: 10071,
    width: isMobile ? 'calc(100vw - 16px)' : '420px',
    maxHeight: 'calc(100vh - 140px)',
    background: 'white',
    borderRadius: '16px',
    boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  };

  const toastContainerStyle = {
    position: 'fixed',
    top: isMobile ? '70px' : '120px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 10072,
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    width: isMobile ? 'calc(100% - 32px)' : '360px',
    maxWidth: '400px',
    pointerEvents: 'none',
  };

  return (
    <>
      <style>{`
        @keyframes toastIn {
          from { opacity: 0; transform: translateY(-24px) scale(0.96); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes toastPulse {
          0% { box-shadow: 0 10px 40px rgba(0,0,0,0.12), 0 0 0 0 rgba(34,197,94,0.4); }
          50% { box-shadow: 0 10px 40px rgba(0,0,0,0.12), 0 0 0 8px rgba(34,197,94,0); }
          100% { box-shadow: 0 10px 40px rgba(0,0,0,0.12), 0 0 0 0 rgba(34,197,94,0); }
        }
        @keyframes toastPulseOrange {
          0% { box-shadow: 0 10px 40px rgba(0,0,0,0.12), 0 0 0 0 rgba(249,115,22,0.4); }
          50% { box-shadow: 0 10px 40px rgba(0,0,0,0.12), 0 0 0 8px rgba(249,115,22,0); }
          100% { box-shadow: 0 10px 40px rgba(0,0,0,0.12), 0 0 0 0 rgba(249,115,22,0); }
        }
        @keyframes bellRing {
          0% { transform: rotate(0); }
          5% { transform: rotate(12deg); }
          10% { transform: rotate(-12deg); }
          15% { transform: rotate(8deg); }
          20% { transform: rotate(-8deg); }
          25% { transform: rotate(4deg); }
          30% { transform: rotate(-4deg); }
          35% { transform: rotate(2deg); }
          40% { transform: rotate(0); }
          100% { transform: rotate(0); }
        }
        @keyframes badgePulse {
          0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(239,68,68,0.4); }
          70% { transform: scale(1.25); box-shadow: 0 0 0 8px rgba(239,68,68,0); }
          100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(239,68,68,0); }
        }
      `}</style>

      {/* Bell Button */}
      {!hideBell && (
        <button
          style={bellStyle}
          onClick={() => setPanelOpen(p => !p)}
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.08)'; e.currentTarget.style.boxShadow = '0 6px 24px rgba(0,0,0,0.2)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.15)'; }}
          aria-label="Notifications"
        >
          <span style={{
            display: 'inline-flex',
            animation: unreadCount > 0 ? 'bellRing 2.5s ease-in-out infinite' : 'none',
            transformOrigin: 'top center',
          }}>
            <Bell size={22} color="#4f46e5" strokeWidth={2} />
          </span>
          {unreadCount > 0 && (
            <span style={{
              ...badgeStyle,
              animation: badgePulse ? 'badgePulse 0.8s ease-out' : 'none',
            }}>
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
      )}

      {/* Full-screen ACTION REQUIRED popup — must be tapped away */}
      {actionPopup && (() => {
        const config = TYPE_CONFIG[actionPopup.type] || DEFAULT_CONFIG;
        const proceed = () => {
          navigate(resolveNotificationRoute(actionPopup, config.route));
          if (!actionPopup.read && actionPopup._id) markAsRead(actionPopup._id);
          setActionPopup(null);
        };
        return (
          <div style={{
            position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.72)', backdropFilter: 'blur(3px)',
            zIndex: 10075, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
          }}>
            <div style={{
              background: 'white', borderRadius: 24, padding: '26px 22px', width: '100%', maxWidth: 400,
              border: `3px solid ${config.color}`, boxShadow: `0 24px 70px ${config.color}55`,
              textAlign: 'center', animation: 'toastIn 0.35s cubic-bezier(0.16, 1, 0.3, 1)'
            }}>
              <div style={{ width: 74, height: 74, borderRadius: 22, background: config.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40, margin: '0 auto 12px' }}>
                {config.icon}
              </div>
              <div style={{ fontSize: 11, fontWeight: 800, color: config.color, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>
                🔴 Action Required
              </div>
              <div style={{ fontSize: 19, fontWeight: 900, color: '#0f172a', marginBottom: 8 }}>
                {actionPopup.title || 'New Update'}
              </div>
              <div style={{ fontSize: 14, color: '#475569', lineHeight: 1.5, marginBottom: 20 }}>
                {actionPopup.message}
              </div>
              <button onClick={proceed} style={{
                width: '100%', minHeight: 52, borderRadius: 16, border: 'none', cursor: 'pointer',
                fontSize: 15, fontWeight: 800, color: 'white', background: config.color,
                boxShadow: `0 6px 20px ${config.color}55`, marginBottom: 10
              }}>
                {config.actionLabel} →
              </button>
              <button onClick={() => { if (!actionPopup.read && actionPopup._id) markAsRead(actionPopup._id); setActionPopup(null); }} style={{
                width: '100%', minHeight: 46, borderRadius: 14, border: 'none', cursor: 'pointer',
                fontSize: 14, fontWeight: 700, color: '#64748b', background: '#f1f5f9'
              }}>
                Close
              </button>
            </div>
          </div>
        );
      })()}

      {/* Toast Stack */}
      <div style={toastContainerStyle}>
        {toasts.map((toast) => {
          const config = TYPE_CONFIG[toast.type] || DEFAULT_CONFIG;
          return (
            <div
              key={toast.toastId}
              onClick={() => toast.kind !== 'progress' && handleToastClick(toast)}
              onTouchStart={onTouchStart(toast.toastId)}
              onTouchMove={onTouchMove(toast.toastId)}
              onTouchEnd={onTouchEnd(toast.toastId)}
              style={{
                pointerEvents: 'auto',
                background: 'white',
                color: '#1e293b',
                borderRadius: '14px',
                padding: toast.isCritical ? '16px 18px' : '14px 16px',
                boxShadow: '0 10px 40px rgba(0,0,0,0.12)',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px',
                cursor: toast.kind === 'progress' ? 'default' : 'pointer',
                borderLeft: `4px solid ${config.color}`,
                border: toast.isCritical ? `2px solid ${config.color}` : 'none',
                position: 'relative',
                overflow: 'visible',
                animation: toast.isCritical
                  ? `toastIn 0.45s cubic-bezier(0.16, 1, 0.3, 1) forwards, ${config.color === '#f97316' || config.color === '#8b5cf6' ? 'toastPulseOrange' : 'toastPulse'} 2s ease-in-out infinite`
                  : 'toastIn 0.45s cubic-bezier(0.16, 1, 0.3, 1) forwards',
                transition: 'transform 0.2s ease, opacity 0.2s ease',
                touchAction: 'pan-y',
                userSelect: 'none',
                marginBottom: toast.isCritical ? '4px' : '0',
              }}
            >
              {/* Colored dot indicator on the border */}
              <span style={{
                position: 'absolute',
                left: '-5px',
                top: '50%',
                transform: 'translateY(-50%)',
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                background: 'white',
                border: `2.5px solid ${config.color}`,
                boxShadow: '0 0 0 2px white',
              }} />
              <span style={{ fontSize: toast.isCritical ? '32px' : '28px', flexShrink: 0, lineHeight: 1, marginLeft: '4px' }}>{config.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                {toast.isCritical && (
                  <div style={{ fontSize: '10px', fontWeight: 800, color: config.color, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '2px' }}>
                    🔴 Action Required
                  </div>
                )}
                <div style={{ fontSize: toast.isCritical ? '15px' : '14px', fontWeight: 700, color: '#1e293b', marginBottom: '2px' }}>
                  {toast.title || 'New Notification'}
                </div>
                <div style={{ fontSize: '13px', color: '#475569', wordBreak: 'break-word', lineHeight: 1.4 }}>
                  {toast.message}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '8px' }}>
                  {toast.kind !== 'progress' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleToastClick(toast); }}
                      style={{
                        fontSize: toast.isCritical ? '13px' : '12px',
                        fontWeight: 700,
                        color: toast.isCritical ? 'white' : config.color,
                        background: toast.isCritical ? config.color : config.bg,
                        border: 'none',
                        borderRadius: '8px',
                        padding: toast.isCritical ? '7px 14px' : '5px 10px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        boxShadow: toast.isCritical ? `0 2px 8px ${config.color}40` : 'none',
                      }}
                    >
                      {config.actionLabel} →
                    </button>
                  )}
                  <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 500, whiteSpace: 'nowrap', marginLeft: 'auto', paddingLeft: '8px' }}>
                    {toast.isCritical ? 'Tap above to act' : timeAgo(toast.createdAt)}
                  </span>
                </div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); dismissToast(toast.toastId); }}
                style={{
                  background: 'none', border: 'none', color: '#94a3b8',
                  cursor: 'pointer', fontSize: '16px', flexShrink: 0, lineHeight: 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: '40px', height: '40px', borderRadius: '8px', margin: '-8px -8px -8px 0',
                }}
                aria-label="Dismiss"
              >
                <X size={18} />
              </button>
            </div>
          );
        })}
      </div>

      {/* Notification Panel */}
      {panelOpen && (
        <div ref={panelRef} style={panelStyle}>
          {/* Gradient Header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '16px 20px', flexShrink: 0,
            background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
          }}>
            <div style={{ fontSize: '16px', fontWeight: 700, color: 'white' }}>
              Notifications
              {unreadCount > 0 && (
                <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: '13px', marginLeft: '6px' }}>
                  ({unreadCount})
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {notifications.length > 0 && (
                <button
                  onClick={clearAll}
                  style={{
                    fontSize: '12px', color: 'rgba(255,255,255,0.9)', background: 'rgba(255,255,255,0.15)',
                    border: 'none', cursor: 'pointer', fontWeight: 600, padding: '4px 10px', borderRadius: '6px'
                  }}
                >
                  Clear all
                </button>
              )}
              {unreadCount > 0 && (
                <button
                  onClick={markAllAsRead}
                  style={{
                    fontSize: '12px', color: 'rgba(255,255,255,0.9)', background: 'rgba(255,255,255,0.15)',
                    border: 'none', cursor: 'pointer', fontWeight: 600, padding: '4px 10px', borderRadius: '6px'
                  }}
                >
                  Mark all read
                </button>
              )}
              <button
                onClick={() => setPanelOpen(false)}
                style={{
                  background: 'none', border: 'none', color: 'rgba(255,255,255,0.9)',
                  cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center'
                }}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Filter Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid #e2e8f0', flexShrink: 0 }}>
            {['all', 'unread'].map(tab => (
              <button
                key={tab}
                onClick={() => setActiveFilter(tab)}
                style={{
                  flex: 1,
                  padding: '10px',
                  fontSize: '13px',
                  fontWeight: 600,
                  textTransform: 'capitalize',
                  color: activeFilter === tab ? '#4f46e5' : '#64748b',
                  background: activeFilter === tab ? '#eef2ff' : 'transparent',
                  border: 'none',
                  borderBottom: activeFilter === tab ? '2px solid #4f46e5' : '2px solid transparent',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                {tab === 'all' ? `All (${notifications.length})` : `Unread (${unreadCount})`}
              </button>
            ))}
          </div>

          {/* List */}
          <div style={{ overflowY: 'auto', flex: 1, padding: '8px 0' }}>
            {loading && notifications.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: '#94a3b8', fontSize: '14px' }}>
                Loading...
              </div>
            )}

            {!loading && filteredNotifications.length === 0 && (
              <div style={{ textAlign: 'center', padding: '56px 24px', color: '#64748b' }}>
                <div style={{ fontSize: '44px', marginBottom: '16px' }}>🎉</div>
                <div style={{ fontSize: '16px', fontWeight: 700, color: '#1e293b' }}>
                  {activeFilter === 'unread' ? 'No unread notifications' : "You're all caught up!"}
                </div>
                <div style={{ fontSize: '13px', marginTop: '6px', color: '#94a3b8' }}>
                  {activeFilter === 'unread'
                    ? 'Check the All tab to see everything.'
                    : "Enjoy your day — we'll notify you when something happens."}
                </div>
              </div>
            )}

            {Object.entries(grouped).map(([dateLabel, items]) => (
              <div key={dateLabel}>
                <div style={{
                  padding: '10px 20px 6px', fontSize: '11px', fontWeight: 700,
                  color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.6px'
                }}>
                  {dateLabel}
                </div>
                {items.map(notif => {
                  const config = TYPE_CONFIG[notif.type] || DEFAULT_CONFIG;
                  const sender = getSender(notif);
                  const avatarUrl = getSenderAvatar(notif);
                  return (
                    <div
                      key={notif._id}
                      onClick={() => handleNotificationClick(notif)}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: '12px',
                        padding: '14px 20px', cursor: 'pointer',
                        background: notif.read ? 'transparent' : config.bg,
                        borderLeft: `4px solid ${notif.read ? 'transparent' : config.color}`,
                        boxShadow: notif.read ? 'none' : `inset -6px 0 16px -6px ${config.color}15`,
                        transition: 'background 0.2s',
                        position: 'relative',
                      }}
                      onMouseEnter={(e) => { if (notif.read) e.currentTarget.style.background = '#f8fafc'; }}
                      onMouseLeave={(e) => { if (notif.read) e.currentTarget.style.background = 'transparent'; }}
                    >
                      {sender ? (
                        avatarUrl ? (
                          <img
                            src={avatarUrl}
                            alt=""
                            style={{ width: '40px', height: '40px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
                          />
                        ) : (
                          <div style={{
                            width: '40px', height: '40px', borderRadius: '50%', flexShrink: 0,
                            background: getSenderColor(notif), color: 'white', display: 'flex',
                            alignItems: 'center', justifyContent: 'center', fontSize: '15px', fontWeight: 700,
                            textTransform: 'uppercase',
                          }}>
                            {getSenderInitials(notif)}
                          </div>
                        )
                      ) : (
                        <span style={{ fontSize: '24px', flexShrink: 0, lineHeight: 1, marginTop: '2px' }}>{config.icon}</span>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '13px', fontWeight: notif.read ? 500 : 700, color: '#1e293b', lineHeight: 1.4 }}>
                          {notif.title || 'Notification'}
                        </div>
                        <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px', wordBreak: 'break-word', lineHeight: 1.4 }}>
                          {notif.message}
                        </div>
                        <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
                          {timeAgo(notif.createdAt)}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '10px' }}>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleNotificationClick(notif); }}
                            style={{
                              fontSize: '12px', fontWeight: 600,
                              color: config.actionType === 'primary' ? 'white' : config.color,
                              background: config.actionType === 'primary' ? config.color : config.bg,
                              border: 'none', borderRadius: '6px', padding: '5px 12px', cursor: 'pointer',
                              display: 'flex', alignItems: 'center', gap: '4px',
                            }}
                          >
                            {config.actionLabel}
                          </button>
                          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                            {!notif.read && (
                              <button
                                onClick={(e) => { e.stopPropagation(); markAsRead(notif._id); }}
                                style={{
                                  background: 'none', border: 'none', color: '#22c55e',
                                  cursor: 'pointer', padding: '6px', borderRadius: '6px',
                                  display: 'flex', alignItems: 'center', transition: 'background 0.15s',
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.background = '#f0fdf4'}
                                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                title="Mark as read"
                                aria-label="Mark as read"
                              >
                                <CheckCircle2 size={16} />
                              </button>
                            )}
                            <button
                              onClick={(e) => { e.stopPropagation(); deleteNotification(notif._id); }}
                              style={{
                                background: 'none', border: 'none', color: '#ef4444',
                                cursor: 'pointer', padding: '6px', borderRadius: '6px',
                                display: 'flex', alignItems: 'center', transition: 'background 0.15s',
                              }}
                              onMouseEnter={(e) => e.currentTarget.style.background = '#fef2f2'}
                              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                              title="Delete"
                              aria-label="Delete"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
