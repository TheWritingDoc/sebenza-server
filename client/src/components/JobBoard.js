import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import axios from 'axios';
import { useNavigate, useSearchParams, useParams, useLocation } from 'react-router-dom';
import { socket } from '../App';
import PostJobModal from './PostJobModal';
import ApplyJobModal from './ApplyJobModal';
import JobApplicantsModal from './JobApplicantsModal';
import PhotoGallery from './PhotoGallery';
import QRHandshakeModal from './QRHandshakeModal';
import PhotoUploadFlow from './PhotoUploadFlow';
import JobCompletionSummary from './JobCompletionSummary';
import JobCompleteWorkflow from './JobCompleteWorkflow';
import { PLACEHOLDER_IMG, getImageUrl, categoryEmojis, categoryGradients, statusBadge, modalOverlayStyle, modalContentStyle, MAX_NEGOTIATION_ROUNDS } from '../shared/constants';
import { scrollToRef, blurActiveInput, mobileFieldFocusScroll } from '../shared/workflowFocus';
import { Briefcase, ClipboardList, Handshake, Plus, Eye, Users, Banknote, Clock, MessageCircle, ArrowRight } from './Icons';

const API_URL = process.env.REACT_APP_API_URL || '';



function getTimeRemaining(expiresAt) {
  const total = new Date(expiresAt) - new Date();
  if (total <= 0) return null;
  const hours = Math.floor(total / (1000 * 60 * 60));
  const minutes = Math.floor((total % (1000 * 60 * 60)) / (1000 * 60));
  return { hours, minutes, total };
}

function getDistanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatElapsed(ms) {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}m ${sec.toString().padStart(2, '0')}s`;
}
// Fallback refresh function
const forceRefresh = async () => {
  window.location.reload();
};

function JobBoard({ user, onViewPortfolio }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { jobId: routeJobId } = useParams();
  const location = useLocation();
  // No tabs — consolidated dashboard view
  const [confirmingJob, setConfirmingJob] = useState(null);
  const [confirmPhotos, setConfirmPhotos] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [myJobs, setMyJobs] = useState([]);
  const [myApplications, setMyApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [minRatingFilter, setMinRatingFilter] = useState('any');
  const [durationFilter, setDurationFilter] = useState('any');
  const [sortBy, setSortBy] = useState('newest');
  const [postingJob, setPostingJob] = useState(false);
  const [applyingJob, setApplyingJob] = useState(null);
  const [viewingApplicants, setViewingApplicants] = useState(null);
  const [viewingJob, setViewingJob] = useState(null);
  const [workHubOpen, setWorkHubOpen] = useState(false);
  const [workHubTab, setWorkHubTab] = useState('overview');
  const workHubTabs = useMemo(() => ([
    ['overview', 'Overview'],
    ['issues', 'Issues'],
    ['proof', 'Proof'],
    ['complete', 'Complete']
  ]), []);
  const [completingJob, setCompletingJob] = useState(null);
  const [, setCompletionPhotos] = useState([]);
  const [confirmCategories, setConfirmCategories] = useState({ punctuality: 5, quality: 5, communication: 5, respect: 5 });
  const [confirmComment, setConfirmComment] = useState('');
  const [reportingIssueJob, setReportingIssueJob] = useState(null);
  const [issueNote, setIssueNote] = useState('');
  const [issuePhotos, setIssuePhotos] = useState([]);
  const [reportingIssue, setReportingIssue] = useState(false);
  const [proofPhotos, setProofPhotos] = useState([]);
  const [proofStage, setProofStage] = useState('during');
  const [proofNote, setProofNote] = useState('');
  const [uploadingProof, setUploadingProof] = useState(false);
  const [stopReason, setStopReason] = useState('');
  const [stopPhotos, setStopPhotos] = useState([]);
  const [stoppingJob, setStoppingJob] = useState(false);
  const [galleryPhotos, setGalleryPhotos] = useState([]);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [showGallery, setShowGallery] = useState(false);
  const [qrHandshakeJob, setQrHandshakeJob] = useState(null);
  const [paymentHandshakeJob, setPaymentHandshakeJob] = useState(null);
  const [viewingCompletionSummary, setViewingCompletionSummary] = useState(null);
  const [workflowAlert, setWorkflowAlert] = useState(null);
  const [doorbellJob, setDoorbellJob] = useState(null);
  const [pingingJob, setPingingJob] = useState(null);
  const [flaggingLateJob, setFlaggingLateJob] = useState(null);
  const [autoPingedJobs, setAutoPingedJobs] = useState(new Set());
  const [now, setNow] = useState(Date.now()); // live timer for waiting display

  // Action loading states
  const [cancellingJobId, setCancellingJobId] = useState(null);
  const [withdrawingAppId, setWithdrawingAppId] = useState(null);
  const [acceptingOfferJobId, setAcceptingOfferJobId] = useState(null);
  const [rejectingOfferJobId, setRejectingOfferJobId] = useState(null);
  const [counterSubmittingJobId, setCounterSubmittingJobId] = useState(null);
  const [decliningApprovalJobId, setDecliningApprovalJobId] = useState(null);
  const [confirmingCompletion, setConfirmingCompletion] = useState(false);

  // Mobile detection for responsive modal layouts
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 640);
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 640);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Live countdown tick to force re-render every minute
  const [tick, setTick] = useState(0);

  // Applicant negotiation counter state
  const [applicantCounterJob, setApplicantCounterJob] = useState(null);
  const [applicantCounterAmount, setApplicantCounterAmount] = useState('');
  const [applicantCounterTime, setApplicantCounterTime] = useState('');
  const [applicantCounterMessage, setApplicantCounterMessage] = useState('');
  const applicantCounterFormRef = useRef(null);
  const jobDetailScrollRef = useRef(null);
  const jobDetailActionRef = useRef(null);
  const negotiationActionRef = useRef(null);
  const approvedActionRef = useRef(null);
  const locationStartRef = useRef(null);
  const workHubCardRef = useRef(null);

  // Device handshake / location sharing state
  const [, setMyLocation] = useState(null); // eslint-disable-line @typescript-eslint/no-unused-vars
  const [otherLocation, setOtherLocation] = useState(null);
  const [handshakeStatus, setHandshakeStatus] = useState('idle'); // idle | searching | nearby | complete
  const [myDistanceToJob, setMyDistanceToJob] = useState(null);
  const [otherDistanceToJob, setOtherDistanceToJob] = useState(null);
  const watchIdRef = useRef(null);
  const handshakeTriggeredRef = useRef(false);
  const msgTimeoutRef = useRef(null);
  const viewingJobRef = useRef(null);

  const token = localStorage.getItem('token');
  const userId = token ? (() => { try { return JSON.parse(atob(token.split('.')[1])).userId; } catch { return null; } })() : null;
  const isLoggedIn = !!token;

  const isPosterForJob = (job) => (job?.posterId?._id?.toString?.() === userId || job?.posterId?.toString?.() === userId);

  const getWorkflowStep = (job, isPoster) => {
    if (!job) return 1;
    if (job.status === 'completed') return isPoster ? 6 : 7;
    if (job.status === 'pending_payment') return isPoster ? 6 : 7;
    if (job.status === 'pending_review' || job.status === 'in_progress') return isPoster ? 5 : 6;
    if (job.status === 'accepted') return 4;
    if (job.status === 'approved') return 3;
    if (job.status === 'negotiating') return 3;
    if (job.myApplication?.status === 'pending' || job.myApplication?.status === 'negotiating') return isPoster ? 2 : 2;
    return 1;
  };

  const getWorkflowSteps = (job, isPoster) => isPoster ? [
    'Post Job',
    'View Applicants',
    'Negotiate & Approve',
    'QR Start / Manual Start',
    'Track Work & Reports',
    'Confirm Payment (QR Scan)'
  ] : [
    'Browse Jobs',
    'Apply for Job',
    'Negotiate & Confirm',
    'Navigate + QR Start',
    'Do Work + Report Issues',
    'Upload Proof + Mark Done',
    'Confirm Payment (QR Scan)'
  ];

  useEffect(() => {
    if (searchParams.get('post') === '1' && isLoggedIn) {
      setPostingJob(true);
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        next.delete('post');
        return next;
      }, { replace: true });
    }
  }, [searchParams, setSearchParams, isLoggedIn]);

  // Hardware back-button: register/unregister modal close handlers
  useEffect(() => {
    if (typeof window === 'undefined' || !window.pushBackHandler) return;

    const closeViewingJob = () => setViewingJob(null);
    const closeWorkHub = () => { setWorkHubOpen(false); setWorkHubTab('overview'); };
    const closePostingJob = () => setPostingJob(false);
    const closeApplyingJob = () => setApplyingJob(null);
    const closeViewingApplicants = () => setViewingApplicants(null);
    const closeGallery = () => setShowGallery(false);
    const closeQrHandshake = () => setQrHandshakeJob(null);
    const closePaymentHandshake = () => setPaymentHandshakeJob(null);
    const closeCompletingJob = () => setCompletingJob(null);
    const closeCompletionSummary = () => setViewingCompletionSummary(null);
    const closeReportingIssue = () => { setReportingIssueJob(null); setIssueNote(''); setIssuePhotos([]); };
    const closeDoorbell = () => setDoorbellJob(null);
    const closePingingJob = () => setPingingJob(null);
    const closeApplicantCounter = () => setApplicantCounterJob(null);

    // Push handlers for active modals (most recent first)
    if (applicantCounterJob) window.pushBackHandler(closeApplicantCounter);
    if (pingingJob) window.pushBackHandler(closePingingJob);
    if (doorbellJob) window.pushBackHandler(closeDoorbell);
    if (reportingIssueJob) window.pushBackHandler(closeReportingIssue);
    if (viewingCompletionSummary) window.pushBackHandler(closeCompletionSummary);
    if (completingJob) window.pushBackHandler(closeCompletingJob);
    if (paymentHandshakeJob) window.pushBackHandler(closePaymentHandshake);
    if (qrHandshakeJob) window.pushBackHandler(closeQrHandshake);
    if (showGallery) window.pushBackHandler(closeGallery);
    if (viewingApplicants) window.pushBackHandler(closeViewingApplicants);
    if (applyingJob) window.pushBackHandler(closeApplyingJob);
    if (postingJob) window.pushBackHandler(closePostingJob);
    if (workHubOpen) window.pushBackHandler(closeWorkHub);
    if (viewingJob) window.pushBackHandler(closeViewingJob);

    return () => {
      if (viewingJob) window.popBackHandler(closeViewingJob);
      if (workHubOpen) window.popBackHandler(closeWorkHub);
      if (postingJob) window.popBackHandler(closePostingJob);
      if (applyingJob) window.popBackHandler(closeApplyingJob);
      if (viewingApplicants) window.popBackHandler(closeViewingApplicants);
      if (showGallery) window.popBackHandler(closeGallery);
      if (qrHandshakeJob) window.popBackHandler(closeQrHandshake);
      if (paymentHandshakeJob) window.popBackHandler(closePaymentHandshake);
      if (completingJob) window.popBackHandler(closeCompletingJob);
      if (viewingCompletionSummary) window.popBackHandler(closeCompletionSummary);
      if (reportingIssueJob) window.popBackHandler(closeReportingIssue);
      if (doorbellJob) window.popBackHandler(closeDoorbell);
      if (pingingJob) window.popBackHandler(closePingingJob);
      if (applicantCounterJob) window.popBackHandler(closeApplicantCounter);
    };
  }, [viewingJob, workHubOpen, postingJob, applyingJob, viewingApplicants, showGallery, qrHandshakeJob, paymentHandshakeJob, completingJob, viewingCompletionSummary, reportingIssueJob, doorbellJob, pingingJob, applicantCounterJob]);

  const showMsg = useCallback((msg, timeout = 4000) => {
    setMessage(msg);
    if (msgTimeoutRef.current) clearTimeout(msgTimeoutRef.current);
    msgTimeoutRef.current = setTimeout(() => setMessage(''), timeout);
  }, []);

  const handleAuthError = useCallback((err) => {
    const code = err.response?.data?.code;
    const msg = err.response?.data?.error;
    if (code === 'TOKEN_EXPIRED' || msg === 'Token expired' || code === 'TOKEN_INVALID' || msg === 'Invalid token') {
      localStorage.removeItem('token');
      localStorage.removeItem('sebenza_user');
      localStorage.removeItem('gshop_user');
      navigate('/login');
      return true;
    }
    return false;
  }, [navigate]);

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch both open and negotiating jobs so providers can see jobs in negotiation
      const params = {};
      if (user?.location?.lat && user?.location?.lng) {
        params.lat = user.location.lat;
        params.lng = user.location.lng;
      }
      if (selectedCategory !== 'all') params.category = selectedCategory;
      const headers = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await axios.get(`${API_URL}/api/jobs`, { params, headers });
      const jobList = Array.isArray(res.data) ? res.data : (res.data.jobs || []);
      const now = new Date();
      setJobs(jobList.filter(j => {
        // Filter out expired jobs
        if (j.expiresAt && new Date(j.expiresAt) <= now) return false;
        // Filter out jobs where application deadline has passed
        if (j.applicationDeadline && new Date(j.applicationDeadline) <= now && j.status === 'open') return false;
        return ['open', 'negotiating'].includes(j.status);
      }));
    } catch (err) {
      console.error('Fetch jobs error:', err);
      showMsg(err.response?.data?.error || 'Failed to load jobs. Please try again.');
    }
    setLoading(false);
  }, [user?.location?.lat, user?.location?.lng, selectedCategory, token, showMsg]);

  const fetchMyJobs = useCallback(async () => {
    if (!isLoggedIn) return;
    setLoading(true);
    try {
      const res = await axios.get(`${API_URL}/api/jobs/my-jobs`, { headers: { Authorization: `Bearer ${token}` } });
      const jobList = Array.isArray(res.data) ? res.data : (res.data.jobs || []);
      setMyJobs(jobList);
    } catch (err) {
      if (!handleAuthError(err)) {
        console.error('Fetch my jobs error:', err);
        showMsg(err.response?.data?.error || 'Failed to load your jobs.');
      }
    }
    setLoading(false);
  }, [isLoggedIn, token, handleAuthError, showMsg]);

  const fetchMyApplications = useCallback(async () => {
    if (!isLoggedIn) return;
    setLoading(true);
    try {
      const res = await axios.get(`${API_URL}/api/jobs/my-applications`, { headers: { Authorization: `Bearer ${token}` } });
      const jobList = Array.isArray(res.data) ? res.data : (res.data.jobs || []);
      setMyApplications(jobList);
    } catch (err) {
      if (!handleAuthError(err)) {
        console.error('Fetch my applications error:', err);
        showMsg(err.response?.data?.error || 'Failed to load your applications.');
      }
    }
    setLoading(false);
  }, [isLoggedIn, token, handleAuthError, showMsg]);

  const silentRefresh = useCallback(async (jobId) => {
    try { await fetchMyJobs(); } catch (e) {}
    try { await fetchMyApplications(); } catch (e) {}
    try { await fetchJobs(); } catch (e) {}
    const vj = viewingJobRef.current;
    if (vj && (!jobId || vj._id === jobId)) {
      try {
        const res = await axios.get(`${API_URL}/api/jobs/${jobId || vj._id}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        if (res.data) setViewingJob(res.data);
      } catch (err) {}
    }
  }, [fetchMyJobs, fetchMyApplications, fetchJobs, token]);

  useEffect(() => {
    fetchJobs();
    if (isLoggedIn) {
      fetchMyJobs();
      fetchMyApplications();
    }
  }, [selectedCategory, isLoggedIn, fetchJobs, fetchMyJobs, fetchMyApplications]);

  // Handle ?view=jobId from notification navigation
  useEffect(() => {
    const viewJobId = searchParams.get('view');
    if (!viewJobId) return;
    const openJob = async () => {
      try {
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const res = await axios.get(`${API_URL}/api/jobs/${viewJobId}`, { headers });
        if (res.data) {
          setViewingJob(res.data);
          const isPosterForJob = res.data.posterId?._id?.toString?.() === userId || res.data.posterId?.toString?.() === userId;
          const isAcceptedWorker = res.data.myApplication?.status === 'accepted';
          const shouldOpenWorkHub = ['in_progress', 'pending_review', 'pending_payment', 'completed'].includes(res.data.status) && (isPosterForJob || isAcceptedWorker);
          if (shouldOpenWorkHub) {
            setWorkHubTab('overview');
            setWorkHubOpen(true);
            navigate(`/jobs/workhub/${res.data._id}`, { replace: true });
          } else {
            setWorkHubOpen(false);
          }
          // Clear the query param without reloading
          setSearchParams({}, { replace: true });
        }
      } catch (err) {
        console.error('Failed to open job from notification:', err);
      }
    };
    openJob();
  }, [searchParams, token, setSearchParams, navigate]);

  // Handle direct route /jobs/workhub/:jobId deep-link
  useEffect(() => {
    if (!routeJobId) return;
    const openWorkHubRoute = async () => {
      try {
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const res = await axios.get(`${API_URL}/api/jobs/${routeJobId}`, { headers });
        if (res.data) {
          const routeJob = res.data;
          const isPosterForRoute = routeJob.posterId?._id?.toString?.() === userId || routeJob.posterId?.toString?.() === userId;
          const isAcceptedWorkerForRoute = routeJob.myApplication?.status === 'accepted';
          const isWorkHubEligible = ['in_progress', 'pending_review', 'pending_payment', 'completed'].includes(routeJob.status) && (isPosterForRoute || isAcceptedWorkerForRoute);
          setViewingJob(routeJob);
          if (isWorkHubEligible) {
            setWorkHubTab('overview');
            setWorkHubOpen(true);
          } else {
            setWorkHubOpen(false);
            showMsg('Work Hub unlocks after QR handshake starts the job. Please open QR Handshake first.');
            navigate(`/jobs?view=${routeJob._id}`, { replace: true });
          }
        }
      } catch (err) {
        console.error('Failed to open Work Hub route:', err);
        showMsg('Unable to open Work Hub for this job.');
      }
    };
    openWorkHubRoute();
  }, [routeJobId, token, showMsg, navigate]);

  // ── Notification-driven refresh: when any device receives a job notification, refresh data ──
  useEffect(() => {
    const onRefreshJobs = async (e) => {
      if (!isLoggedIn) return;
      const jobId = e.detail?.jobId;
      try { await fetchMyJobs(); } catch (err) {}
      try { await fetchMyApplications(); } catch (err) {}
      try { await fetchJobs(); } catch (err) {}
      // If a detail view is open for this job, refresh it too
      const vj = viewingJobRef.current;
      if (vj && (!jobId || vj._id === jobId)) {
        try {
          const res = await axios.get(`${API_URL}/api/jobs/${jobId || vj._id}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
          if (res.data) {
            setViewingJob(res.data);
            autoRouteWorkHub(res.data, e.detail?.type || 'refresh');
          }
        } catch (err) {}
      }
    };
    window.addEventListener('sebenza:refresh-jobs', onRefreshJobs);
    return () => window.removeEventListener('sebenza:refresh-jobs', onRefreshJobs);
  }, [isLoggedIn, fetchMyJobs, fetchMyApplications, fetchJobs, token]);

  // ── Page visibility refresh: when user returns to the app, fetch fresh data ──
  useEffect(() => {
    if (!isLoggedIn) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        fetchMyJobs();
        fetchMyApplications();
        fetchJobs();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [isLoggedIn, fetchMyJobs, fetchMyApplications, fetchJobs]);

  // ── Live countdown refresh every minute ──
  useEffect(() => {
    const interval = setInterval(() => {
      setTick(t => t + 1);
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // ── Global socket listeners: QR handshake & job start notifications ──
  // These run whenever the user is logged in, regardless of which modal/page is open.
  // Ref for latest viewingJob to avoid re-registering socket listeners on every detail view change
  useEffect(() => { viewingJobRef.current = viewingJob; }, [viewingJob]);

  useEffect(() => {
    if (!isLoggedIn || !socket) return;

    const onHandshakeCompleteGlobal = async (data) => {
      showMsg(data.message || '🎉 QR handshake complete! Job started.');
      setQrHandshakeJob(null);
      await silentRefresh(data.jobId);
      if (viewingJobRef.current?._id === data.jobId) {
        try {
          const latest = await axios.get(`${API_URL}/api/jobs/${data.jobId}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
          if (latest.data) {
            setViewingJob(latest.data);
            autoRouteWorkHub(latest.data, 'job_started');
          }
        } catch (err) {
          // non-blocking
        }
      }
    };

    const onHandshakeErrorGlobal = (data) => {
      showMsg(data.error || 'Handshake failed.');
    };

    const onJobCompletedGlobal = async (data) => {
      showMsg(data.message || '🏆 Job completed!');
      setCompletingJob(null);
      setConfirmingJob(null);
      setQrHandshakeJob(null);
      setPaymentHandshakeJob(null);
      await silentRefresh(data.jobId);
      if (viewingJobRef.current?._id === data.jobId) {
        try {
          const latest = await axios.get(`${API_URL}/api/jobs/${data.jobId}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
          if (latest.data) {
            setViewingJob(latest.data);
            autoRouteWorkHub(latest.data, 'job_completed');
          }
        } catch (err) {
          // non-blocking
        }
      }
    };

    const onJobUpdatedGlobal = async (data) => {
      const criticalTypes = ['job_started', 'application_approved', 'offer_accepted', 'offer_rejected', 'offer_countered', 'schedule_confirmed', 'job_cancelled', 'payment_confirmed', 'manual_start_permission_updated', 'doorbell_rung', 'doorbell_auto'];
      if (criticalTypes.includes(data.type)) {
        const actorName = data.actorName || data.byName || data.userName || 'The other user';
        let friendly = data.type?.replace(/_/g, ' ');
        if (data.type === 'offer_rejected') {
          friendly = `${actorName} rejected the offer. Please send a counter offer.`;
          setWorkflowAlert({
            type: 'rejected',
            title: 'Offer Rejected',
            body: `${actorName} rejected the offer. Please review and send a counter offer.`
          });
        }
        if (data.type === 'offer_accepted') {
          friendly = `${actorName} accepted the offer. Waiting for final confirmation to lock assignment.`;
          setWorkflowAlert({
            type: 'accepted',
            title: 'Offer Accepted',
            body: `${actorName} accepted the offer. Next step: complete QR handshake to start the job.`
          });
        }
        if (data.type === 'offer_countered') friendly = `${actorName} sent a counter offer.`;
        if (data.type === 'job_started') {
          setQrHandshakeJob(null);
          setWorkHubTab('overview');
        }
        if (data.type === 'payment_confirmed') {
          friendly = `${actorName} confirmed payment. Job completed.`;
          setPaymentHandshakeJob(null);
        }
        if (data.type === 'manual_start_permission_updated') {
          friendly = data.manualStartAllowedByPoster
            ? 'Job provider enabled manual start (within 20m).'
            : 'Job provider disabled manual start. Use QR handshake.';
        }
        if (data.type === 'doorbell_rung') {
          friendly = `Doorbell rung (${data.pingCount || '?'} / 3).`;
        }
        if (data.type === 'doorbell_auto') {
          friendly = 'Helper is nearby (auto doorbell).';
        }
        showMsg(`Update: ${friendly}`);
      }
      await silentRefresh(data.jobId);
      if (viewingJobRef.current?._id === data.jobId) {
        try {
          const latest = await axios.get(`${API_URL}/api/jobs/${data.jobId}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
          if (latest.data) {
            setViewingJob(latest.data);
            if (latest.data.status === 'completed' && latest.data.paymentConfirmed) {
              setPaymentHandshakeJob(null);
              setViewingCompletionSummary(latest.data);
              setWorkHubTab('complete');
              setWorkHubOpen(true);
            }
            autoRouteWorkHub(latest.data, data.type || 'job_updated');
          }
        } catch (err) {
          // non-blocking
        }
      }
    };

    // ── Socket event handlers ──
    const onPartialEscrowReleasedGlobal = async (data) => {
      if (data.amount) {
        const message = `💰 R${data.amount} (${data.percentage}%) released from escrow!`;
        showMsg(message);
        console.log(`[Client] Partial escrow released: ${message}`);
        
        // Silent refresh with error handling
        try {
          await silentRefresh(data.jobId);
        } catch (refreshError) {
          console.error(`[Client] Silent refresh failed after partial release:`, refreshError);
          // Fallback: force refresh
          await forceRefresh();
        }
        
        // Auto-refresh viewing job if it's open
        if (viewingJob && String(viewingJob._id) === String(data.jobId)) {
          try {
            const res = await axios.get(`${API_URL}/api/jobs/${data.jobId}`, { 
              headers: token ? { Authorization: `Bearer ${token}` } : {} 
            });
            if (res.data) {
              setViewingJob(res.data);
              console.log(`[Client] Viewing job refreshed after partial release: ${data.jobId}`);
            }
          } catch (e) {
            console.error(`[Client] Failed to refresh viewing job after partial release:`, e);
            // Continue with state update
          }
        }
        
        // Acknowledge receipt to server
        if (socket) {
          socket.emit('partial_escrow_released_ack', {
            jobId: data.jobId,
            timestamp: Date.now()
          });
        }
      }
    };

    const onPaymentConfirmedGlobal = async (data) => {
      if (data.confirmed) {
        // Show success message to user
        showMsg(data.message || '💰 Payment confirmed!');
        
        // Add acknowledgment for critical event
        if (socket && data.jobId) {
          addPendingAcknowledgment(data.jobId, 'payment_confirmed');
          socket.emit('payment_confirmed_ack', {
            jobId: data.jobId,
            timestamp: Date.now()
          });
        }
        
        // Close any relevant modals
        setPaymentHandshakeJob(null);
        
        // Refresh data silently to ensure both parties see same state
        try {
          await silentRefresh(data.jobId);
        } catch (refreshError) {
          console.error(`[Client] Silent refresh failed after payment confirmation:`, refreshError);
          // Fallback: force refresh
          await forceRefresh();
        }
        
        // Auto-show completion summary for both parties
        try {
          const res = await axios.get(`${API_URL}/api/jobs/${data.jobId}`, { 
            headers: token ? { Authorization: `Bearer ${token}` } : {} 
          });
          if (res.data) {
            setViewingJob(res.data);
            setViewingCompletionSummary(res.data);
            setPaymentHandshakeJob(null);
            setWorkHubTab('complete');
            setWorkHubOpen(true);
            autoRouteWorkHub(res.data, 'payment_confirmed');
            console.log(`[Client] Payment confirmed for job ${data.jobId}, showing completion summary`);
          }
        } catch (e) {
          console.error(`[Client] Failed to fetch completion summary:`, e);
          // ignore error, continue with refresh
        }
      } else {
        // Directed scan in progress — don't close modal, just refresh data silently
        console.log(`[Client] Directed scan in progress for job ${data.jobId}`);
        await silentRefresh(data.jobId);
      }
    };

    const onJobPendingPaymentGlobal = async (data) => {
      showMsg(data.message || '💰 Payment confirmation required!');
      setCompletingJob(null);
      setConfirmingJob(null);
      await silentRefresh(data.jobId);
      if (viewingJobRef.current?._id === data.jobId) {
        try {
          const latest = await axios.get(`${API_URL}/api/jobs/${data.jobId}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
          if (latest.data) {
            setViewingJob(latest.data);
            autoRouteWorkHub(latest.data, 'pending_payment');
          }
        } catch (err) {
          // non-blocking
        }
      }
    };

    socket.on('device_handshake_complete', onHandshakeCompleteGlobal);
    socket.on('handshake_error', onHandshakeErrorGlobal);
    socket.on('job_completed', onJobCompletedGlobal);
    socket.on('job_pending_payment', onJobPendingPaymentGlobal);
    socket.on('payment_confirmed', onPaymentConfirmedGlobal);
    socket.on('partial_escrow_released', onPartialEscrowReleasedGlobal);
    socket.on('job_updated', onJobUpdatedGlobal);

    return () => {
      socket.off('device_handshake_complete', onHandshakeCompleteGlobal);
      socket.off('handshake_error', onHandshakeErrorGlobal);
      socket.off('job_completed', onJobCompletedGlobal);
      socket.off('job_pending_payment', onJobPendingPaymentGlobal);
      socket.off('payment_confirmed', onPaymentConfirmedGlobal);
      socket.off('partial_escrow_released', onPartialEscrowReleasedGlobal);
      socket.off('job_updated', onJobUpdatedGlobal);
    };
  }, [isLoggedIn, socket, fetchJobs, fetchMyJobs, fetchMyApplications, showMsg, token, silentRefresh]);

  // Enhanced socket connection monitoring and reconnection
  useEffect(() => {
    if (!isLoggedIn || !socket) return;

    let reconnectAttempts = 0;
    const maxReconnectAttempts = 5;
    const reconnectDelay = 1000; // 1 second

    const handleConnect = () => {
      console.log('[Client] Socket connected');
      reconnectAttempts = 0; // Reset on successful connection
    };

    const handleDisconnect = (reason) => {
      console.log('[Client] Socket disconnected:', reason);
      
      // Attempt reconnection if disconnected unexpectedly
      if (reason === 'io server disconnect') {
        console.log('[Client] Server disconnected, attempting reconnection...');
        socket.connect();
      } else if (reconnectAttempts < maxReconnectAttempts) {
        setTimeout(() => {
          console.log(`[Client] Reconnecting... Attempt ${reconnectAttempts + 1}/${maxReconnectAttempts}`);
          socket.connect();
          reconnectAttempts++;
        }, reconnectDelay * Math.pow(2, reconnectAttempts)); // Exponential backoff
      }
    };

    const handleReconnect = (attemptNumber) => {
      console.log(`[Client] Reconnected after ${attemptNumber} attempts`);
      
      // Re-emit any pending acknowledgments for critical events
      if (pendingAcknowledgments.size > 0) {
        console.log(`[Client] Resending ${pendingAcknowledgments.size} pending acknowledgments`);
        pendingAcknowledgments.forEach((ackData, jobId) => {
          socket.emit('ack', ackData);
        });
        pendingAcknowledgments.clear();
      }
    };

    const handleReconnectAttempt = (attemptNumber) => {
      console.log(`[Client] Reconnection attempt ${attemptNumber}`);
    };

    // Set up connection event listeners
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('reconnect', handleReconnect);
    socket.on('reconnect_attempt', handleReconnectAttempt);

    // Clean up listeners on unmount
    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('reconnect', handleReconnect);
      socket.off('reconnect_attempt', handleReconnectAttempt);
    };
  }, [isLoggedIn, socket]);

  // Track pending acknowledgments for critical events
  const [pendingAcknowledgments, setPendingAcknowledgments] = useState(new Map());
  
  const addPendingAcknowledgment = (jobId, eventType) => {
    const ackData = {
      jobId,
      eventType,
      timestamp: Date.now()
    };
    setPendingAcknowledgments(prev => new Map(prev).set(jobId, ackData));
    
    // Remove acknowledgment after 30 seconds
    setTimeout(() => {
      setPendingAcknowledgments(prev => {
        const newMap = new Map(prev);
        newMap.delete(jobId);
        return newMap;
      });
    }, 30000);
  };

  // Initialize socket connection monitoring
  useEffect(() => {
    if (!socket || !isLoggedIn) return;

    console.log('[Client] Initializing socket connection monitoring');
    return () => {
      // Clean up any pending acknowledgments
      setPendingAcknowledgments(new Map());
    };
  }, [socket, isLoggedIn]);

  // Default to Applied tab if user has active (non-completed) applied jobs
  // Sync modal job objects with fresh data after reviews/refreshes
  useEffect(() => {
    if (confirmingJob) {
      const updated = myJobs.find(j => j._id === confirmingJob._id) || myApplications.find(j => j._id === confirmingJob._id);
      if (updated) setConfirmingJob(updated);
    }
    if (completingJob) {
      const updated = myJobs.find(j => j._id === completingJob._id) || myApplications.find(j => j._id === completingJob._id);
      if (updated) setCompletingJob(updated);
    }
  }, [myJobs, myApplications, confirmingJob, completingJob]);

  // Controlled payment QR popup: only auto-open when user is already inside the same job/workflow context.
  // Prevents unexpected full-screen modal jumps that can look like a blank screen on mobile.
  useEffect(() => {
    if (!userId || paymentHandshakeJob) return;
    if (!viewingJob?._id) return;

    const allJobs = [...myJobs, ...myApplications];
    const pendingPaymentJob = allJobs.find(j => {
      if (j.status !== 'pending_payment') return false;
      if (String(j._id) !== String(viewingJob._id)) return false;
      const isPoster = j.posterId?._id?.toString?.() === userId || j.posterId?.toString?.() === userId;
      const app = j.applications?.find(a => a._id?.toString?.() === j.acceptedApplicationId?.toString?.());
      const isProvider = app?.applicantId?._id?.toString?.() === userId || app?.applicantId?.toString?.() === userId;
      return isPoster || isProvider;
    });

    if (pendingPaymentJob && workHubOpen) {
      const shownKey = `payment_popup_${pendingPaymentJob._id}`;
      if (!sessionStorage.getItem(shownKey)) {
        sessionStorage.setItem(shownKey, '1');
        setPaymentHandshakeJob(pendingPaymentJob);
      }
    }
  }, [myJobs, myApplications, userId, paymentHandshakeJob, viewingJob?._id, workHubOpen]);

  // If payment modal is open but job has moved out of pending_payment on this device,
  // force-close and route both users to completion state.
  useEffect(() => {
    if (!paymentHandshakeJob?._id) return;
    const allJobs = [...myJobs, ...myApplications];
    const latest = allJobs.find(j => String(j._id) === String(paymentHandshakeJob._id));
    if (!latest) return;

    if (latest.status !== 'pending_payment') {
      setPaymentHandshakeJob(null);
      if (latest.status === 'completed' && latest.paymentConfirmed) {
        setViewingJob(latest);
        setViewingCompletionSummary(latest);
        setWorkHubTab('complete');
        setWorkHubOpen(true);
        autoRouteWorkHub(latest, 'payment_confirmed_sync');
      }
    }
  }, [paymentHandshakeJob?._id, myJobs, myApplications]);

  // Live clock tick every second (for waiting timer display)
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Auto-doorbell: when helper is within 100m of job location
  useEffect(() => {
    if (!isLoggedIn || !user) return;
    const token = localStorage.getItem('token');
    
    const checkProximity = () => {
      if (!navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const myLat = pos.coords.latitude;
          const myLng = pos.coords.longitude;
          
          // Check my applied jobs that are accepted/in_progress with autoPingSent=false
          const activeJobs = [...myJobs, ...myApplications].filter(j => {
            const myApp = j.applications?.find(a => {
              const aid = a.applicantId?._id?.toString?.() || a.applicantId?.toString?.();
              return aid === userId;
            });
            return ['accepted', 'in_progress'].includes(j.status) && myApp && !myApp.autoPingSent && !autoPingedJobs.has(j._id);
          });
          
          for (const job of activeJobs) {
            const jLat = job.location?.lat;
            const jLng = job.location?.lng;
            if (jLat == null || jLng == null) continue;
            const dist = getDistanceKm(myLat, myLng, jLat, jLng);
            if (dist <= 0.1) { // 100m
              try {
                await axios.post(`${API_URL}/api/jobs/${job._id}/ping`, { type: 'auto' }, {
                  headers: { Authorization: `Bearer ${token}` }
                });
                setAutoPingedJobs(prev => new Set(prev).add(job._id));
                showMsg(`Auto-notified: You're near "${job.title}"`);
              } catch (e) {
                // already sent or error
              }
            }
          }
        },
        () => {},
        { enableHighAccuracy: true, timeout: 10000 }
      );
    };
    
    checkProximity();
    const interval = setInterval(checkProximity, 30000); // check every 30 seconds
    return () => clearInterval(interval);
  }, [isLoggedIn, user, myJobs, myApplications, autoPingedJobs, userId]);

  // ── Location helpers ──
  const haversineDistance = (lat1, lng1, lat2, lng2) => {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  const openNavigation = (lat, lng) => {
    if (!lat || !lng) return;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const url = isIOS
      ? `http://maps.apple.com/?daddr=${lat},${lng}&dirflg=d`
      : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
    window.open(url, '_blank');
  };

  const handleQRScanned = async ({ jobId: scannedJobId, scannedUserId }) => {
    const url = `${API_URL}/api/jobs/${scannedJobId}/qr-handshake`;
    try {
      const res = await axios.post(url, { scannedUserId }, { headers: { Authorization: `Bearer ${token}` } });
      // Silent refresh so both parties see the latest state
      await fetchMyJobs();
      await fetchMyApplications();
      await fetchJobs();
      return res.data;
    } catch (err) {
      const isHtmlError = err.message?.includes('DOCTYPE') || err.message?.includes('doctype') || err.message?.includes('<!');
      if (isHtmlError) {
        const serverUrl = window.location.origin.includes('localhost:3000')
          ? 'http://localhost:3001'
          : window.location.origin;
        throw new Error(
          `Server returned HTML instead of JSON. ` +
          `You are probably on the wrong port. ` +
          `Please use ${serverUrl} (not localhost:3000). ` +
          `If on mobile, set REACT_APP_API_URL to your server IP.`
        );
      }
      throw err;
    }
  };

  const handleManualStartPermission = async (job, allow) => {
    if (!job?._id) return;
    try {
      const res = await axios.post(
        `${API_URL}/api/jobs/${job._id}/manual-start-permission`,
        { allow },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      showMsg(res.data?.message || (allow ? 'Manual start enabled' : 'Manual start disabled'));
      setViewingJob((prev) => prev && String(prev._id) === String(job._id)
        ? { ...prev, manualStartAllowedByPoster: !!allow }
        : prev);
      await silentRefresh();
    } catch (err) {
      showMsg(err.response?.data?.error || 'Failed to update manual start permission');
    }
  };

  const handleManualNearbyStart = async (job) => {
    if (!job?.manualStartAllowedByPoster) {
      showMsg('Manual nearby start is disabled. Wait for job provider to enable it.');
      return;
    }
    if (!job?._id || !navigator.geolocation) {
      showMsg('GPS not available on this device. Use QR handshake to start.');
      return;
    }
    try {
      const pos = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 12000 });
      });
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const res = await axios.post(
        `${API_URL}/api/jobs/${job._id}/manual-start-nearby`,
        { lat, lng },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      await fetchMyJobs();
      await fetchMyApplications();
      await fetchJobs();
      const data = res.data || {};
      showMsg(data.message || 'Manual nearby start successful.');
      if (data.job) setViewingJob(data.job);
    } catch (err) {
      showMsg(err?.response?.data?.error || err.message || 'Manual nearby start failed.');
    }
  };

  const handlePaymentQRScanned = async ({ jobId: scannedJobId, scannedUserId, manual }) => {
    const url = `${API_URL}/api/jobs/${scannedJobId}/payment-handshake`;
    let res;
    try {
      res = await axios.post(url, { scannedUserId, manual }, { headers: { Authorization: `Bearer ${token}` } });
    } catch (err) {
      const isHtmlError = err.message?.includes('DOCTYPE') || err.message?.includes('doctype') || err.message?.includes('<!');
      if (isHtmlError) {
        const serverUrl = window.location.origin.includes('localhost:3000')
          ? 'http://localhost:3001'
          : window.location.origin;
        throw new Error(
          `Server returned HTML instead of JSON. ` +
          `Please use ${serverUrl} (not localhost:3000). ` +
          `If on mobile, set REACT_APP_API_URL to your server IP.`
        );
      }
      throw err;
    }
    const data = res.data;

    // Silent refresh so both parties see the latest state
    await fetchMyJobs();
    await fetchMyApplications();
    await fetchJobs();

    if (data.paymentConfirmed) {
      const waitMsg = data.waitTimeMinutes ? ` Wait time: ${data.waitTimeMinutes} min.` : '';
      showMsg(`Payment confirmed! Funds released.${waitMsg}`);
      setPaymentHandshakeJob(null);
      // Show completion summary with ratings after payment handshake
      if (data.job) {
        setViewingJob(data.job);
        setViewingCompletionSummary(data.job);
        setWorkHubTab('complete');
        setWorkHubOpen(true);
        autoRouteWorkHub(data.job, 'payment_confirmed');
      }
    }
    return data;
  };

  // ── Device handshake / real-time location sharing ──
  useEffect(() => {
    if (!viewingJob || viewingJob.status !== 'accepted' || !isLoggedIn || !socket) {
      // Cleanup
      if (watchIdRef.current) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      if (viewingJob && socket) {
        socket.emit('leave_job_room', { jobId: viewingJob._id });
      }
      setMyLocation(null);
      setOtherLocation(null);
      setHandshakeStatus('idle');
      setMyDistanceToJob(null);
      setOtherDistanceToJob(null);
      handshakeTriggeredRef.current = false;
      return;
    }

    const jobId = viewingJob._id;
    const jobLat = viewingJob.location?.lat;
    const jobLng = viewingJob.location?.lng;
    if (jobLat == null || jobLng == null) return;

    // Reset state for new job view
    setHandshakeStatus('searching');
    handshakeTriggeredRef.current = false;

    // Ensure registered and join socket room for this job
    if (userId) socket.emit('register', userId);
    socket.emit('join_job_room', { jobId, userId });

    // Listen for other user's location
    const onLocationUpdate = (data) => {
      if (data.userId === userId) return;
      setOtherLocation({ lat: data.lat, lng: data.lng, updatedAt: data.updatedAt });
      if (jobLat != null && jobLng != null) {
        const dist = haversineDistance(data.lat, data.lng, jobLat, jobLng);
        setOtherDistanceToJob(dist);
      }
    };

    const onBothPartiesNearby = (data) => {
      setHandshakeStatus('nearby');
      showMsg(data.message || 'Both parties are nearby! Use QR handshake to start the job.');
    };

    socket.on('job_location_update', onLocationUpdate);
    socket.on('both_parties_nearby', onBothPartiesNearby);

    // Start watching position
    if (navigator.geolocation) {
      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setMyLocation(loc);
          if (jobLat != null && jobLng != null) {
            const dist = haversineDistance(loc.lat, loc.lng, jobLat, jobLng);
            setMyDistanceToJob(dist);
            if (dist <= 0.1) {
              setHandshakeStatus(prev => prev === 'searching' ? 'nearby' : prev);
            }
          }
          // Emit to server
          if (socket && socket.connected) {
            socket.emit('share_location', { jobId, lat: loc.lat, lng: loc.lng });
          }
        },
        (err) => {
          console.error('GPS watch error:', err);
        },
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
      );
    }

    return () => {
      if (watchIdRef.current) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      socket.emit('leave_job_room', { jobId });
      socket.off('job_location_update', onLocationUpdate);
      socket.off('both_parties_nearby', onBothPartiesNearby);
      setMyLocation(null);
      setOtherLocation(null);
      setHandshakeStatus('idle');
      setMyDistanceToJob(null);
      setOtherDistanceToJob(null);
    };
  }, [viewingJob?._id, viewingJob?.status, isLoggedIn, showMsg, userId]);

  // Keep socket room subscription alive for active job lifecycle (accepted -> completed),
  // so both sides receive synchronized updates on all devices.
  useEffect(() => {
    if (!isLoggedIn || !socket || !viewingJob?._id || !userId) return;
    if (!['accepted', 'in_progress', 'pending_review', 'pending_payment', 'completed'].includes(viewingJob.status)) return;

    const jobId = viewingJob._id;
    socket.emit('register', userId);
    socket.emit('join_job_room', { jobId, userId });

    return () => {
      socket.emit('leave_job_room', { jobId, userId });
    };
  }, [isLoggedIn, socket, userId, viewingJob?._id, viewingJob?.status]);

  // ── Auto-poll pending_payment jobs so both parties see updates when the other confirms ──
  useEffect(() => {
    if (!viewingJob || viewingJob.status !== 'pending_payment' || !isLoggedIn) return;
    const pollInterval = setInterval(async () => {
      try {
        const res = await axios.get(`${API_URL}/api/jobs/${viewingJob._id}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        if (res.data && res.data.status !== 'pending_payment') {
          setViewingJob(res.data);
          if (res.data.status === 'completed' && res.data.paymentConfirmed) {
            showMsg('Payment confirmed! Funds released.');
            setPaymentHandshakeJob(null);
            setViewingCompletionSummary(res.data);
            setWorkHubTab('complete');
            setWorkHubOpen(true);
            autoRouteWorkHub(res.data, 'payment_confirmed_poll');
          }
        }
      } catch (e) { /* ignore poll errors */ }
    }, 5000);
    return () => clearInterval(pollInterval);
  }, [viewingJob?._id, viewingJob?.status, isLoggedIn, token, showMsg]);

  const handleCancelJob = async (jobId) => {
    if (!window.confirm('Cancel this job? All applications will be closed.')) return;
    setCancellingJobId(jobId);
    try {
      await axios.post(`${API_URL}/api/jobs/${jobId}/cancel`, {}, { headers: { Authorization: `Bearer ${token}` } });
      showMsg('Job cancelled.');
      await fetchMyJobs(); await fetchMyApplications(); await fetchJobs();
    } catch (err) {
      showMsg(err.response?.data?.error || 'Failed to cancel');
    } finally {
      setCancellingJobId(null);
    }
  };

  const handleWithdraw = async (jobId, appId) => {
    setWithdrawingAppId(appId);
    try {
      await axios.post(`${API_URL}/api/jobs/${jobId}/applications/${appId}/withdraw`, {}, { headers: { Authorization: `Bearer ${token}` } });
      showMsg('Application withdrawn.');
      if (viewingJob?._id === jobId) setViewingJob(null);
      await fetchMyJobs(); await fetchMyApplications(); await fetchJobs();
    } catch (err) {
      showMsg(err.response?.data?.error || 'Failed to withdraw');
    } finally {
      setWithdrawingAppId(null);
    }
  };

  const handleApplicantAcceptOffer = async (jobId, appId) => {
    setAcceptingOfferJobId(jobId);
    try {
      await axios.post(`${API_URL}/api/jobs/${jobId}/applications/${appId}/accept-offer`, {}, { headers: { Authorization: `Bearer ${token}` } });
      showMsg('✅ You accepted the offer. The other user has been notified and must now confirm to lock this job assignment.');
      setWorkflowAlert({
        type: 'accepted',
        title: 'Offer Accepted',
        body: 'Great. Next step: both users must complete QR handshake to start the job.'
      });
      setActiveTab('browse');
      await fetchMyJobs(); await fetchMyApplications(); await fetchJobs();
      if (viewingJob?._id === jobId) {
        try {
          const res = await axios.get(`${API_URL}/api/jobs/${jobId}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
          if (res.data) {
            setViewingJob(res.data);
            setWorkHubOpen(false);
            navigate(`/jobs?view=${jobId}`, { replace: true });
          }
        } catch (_) {
          // Fallback: keep old behavior if refresh fails
          setViewingJob(null);
        }
      }
    } catch (err) {
      showMsg(err.response?.data?.error || 'Failed to accept offer');
    } finally {
      setAcceptingOfferJobId(null);
    }
  };

  const handleApplicantRejectOffer = async (jobId, appId) => {
    setRejectingOfferJobId(jobId);
    try {
      await axios.post(`${API_URL}/api/jobs/${jobId}/applications/${appId}/reject-offer`, {}, { headers: { Authorization: `Bearer ${token}` } });
      showMsg('❌ You rejected the offer. Keep going — more opportunities are waiting. The other user has been notified to submit a new counter offer.');
      setWorkflowAlert({
        type: 'rejected',
        title: 'Offer Rejected',
        body: 'No stress — keep applying. Each rejection moves you closer to the right job. You can continue browsing and apply again anytime.'
      });
      setActiveTab('browse');
      if (viewingJob?._id === jobId) setViewingJob(null);
      await fetchMyJobs(); await fetchMyApplications(); await fetchJobs();
    } catch (err) {
      showMsg(err.response?.data?.error || 'Failed to reject offer');
    } finally {
      setRejectingOfferJobId(null);
    }
  };

  const handleApplicantCounterSubmit = async (jobId, appId) => {
    const amount = parseFloat(applicantCounterAmount);
    if (isNaN(amount) || amount <= 0) {
      showMsg('Please enter a valid amount');
      return;
    }
    setCounterSubmittingJobId(jobId);
    try {
      const payload = { amount, message: applicantCounterMessage };
      if (applicantCounterTime) payload.proposedTime = new Date(applicantCounterTime).toISOString();
      await axios.post(`${API_URL}/api/jobs/${jobId}/applications/${appId}/negotiate`, payload, { headers: { Authorization: `Bearer ${token}` } });
      showMsg('Counter offer sent!');
      setApplicantCounterJob(null);
      setApplicantCounterAmount('');
      setApplicantCounterTime('');
      setApplicantCounterMessage('');
      if (viewingJob?._id === jobId) setViewingJob(null);
      await fetchMyJobs(); await fetchMyApplications(); await fetchJobs();
    } catch (err) {
      const errData = err.response?.data;
      if (errData?.autoRejected) {
        showMsg('⚠️ ' + (errData.error || 'Offer auto-declined after max rounds.'));
        if (viewingJob?._id === jobId) setViewingJob(null);
        await fetchMyJobs(); await fetchMyApplications(); await fetchJobs();
      } else {
        showMsg(errData?.error || 'Failed to send counter offer');
      }
    } finally {
      setCounterSubmittingJobId(null);
    }
  };

  const openApplicantCounter = (job) => {
    const app = job.myApplication;
    const lastOffer = app?.negotiationHistory?.length > 0 ? app.negotiationHistory[app.negotiationHistory.length - 1] : null;
    setApplicantCounterJob(job);
    setApplicantCounterAmount(lastOffer?.amount?.toString?.() || app?.proposedAmount?.toString?.() || '');
    // Pre-fill time: prefer last offer's proposed time, then applicant's proposed time, then job's scheduled date
    const timeSource = lastOffer?.proposedTime || app?.proposedTime || job?.scheduledDate;
    if (timeSource) {
      const d = new Date(timeSource);
      const pad = (n) => n.toString().padStart(2, '0');
      setApplicantCounterTime(`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
    } else {
      setApplicantCounterTime('');
    }
    setApplicantCounterMessage('');
    // Prevent keyboard auto-popup and scroll to form
    setTimeout(() => {
      blurActiveInput();
      scrollToRef(applicantCounterFormRef, { delay: 0 });
    }, 100);
  };

  useEffect(() => {
    if (!viewingJob || !jobDetailScrollRef.current) return;

    const isPoster = isPosterForJob(viewingJob);
    const app = viewingJob.myApplication;
    const lastOffer = app?.negotiationHistory?.length > 0 ? app.negotiationHistory[app.negotiationHistory.length - 1] : null;
    const isMyTurn = !isPoster && lastOffer && lastOffer.status === 'pending' && lastOffer.proposedBy?.toString?.() !== userId && lastOffer.proposedBy !== userId;

    let targetRef = jobDetailActionRef;
    if (isMyTurn) targetRef = negotiationActionRef;
    else if (!isPoster && app?.status === 'approved') targetRef = approvedActionRef;
    else if (viewingJob.status === 'accepted') targetRef = locationStartRef;
    else if (['in_progress', 'pending_review'].includes(viewingJob.status)) targetRef = workHubCardRef;

    const timer = scrollToRef(targetRef);

    return () => clearTimeout(timer);
  }, [
    viewingJob?._id,
    viewingJob?.status,
    viewingJob?.myApplication?.status,
    viewingJob?.myApplication?.negotiationHistory?.length,
    userId
  ]);

  // NOTE: handleStartJob removed — QR handshake is the primary job-start mechanism.

  const handleCompleteJob = (job) => {
    setCompletingJob(job);
    setCompletionPhotos([]);
  };

  const handlePing = async (jobId) => {
    setPingingJob(jobId);
    try {
      const res = await axios.post(`${API_URL}/api/jobs/${jobId}/ping`, { type: 'manual' }, { headers: { Authorization: `Bearer ${token}` } });
      const pingCount = res?.data?.pingCount;
      showMsg(typeof pingCount === 'number'
        ? `🔔 Doorbell rung (${pingCount}/3). The other party has been notified.`
        : '🔔 Ping sent! The other party has been notified.');
      await fetchMyJobs(); await fetchMyApplications(); await fetchJobs();
    } catch (err) {
      showMsg(err.response?.data?.error || 'Failed to send ping');
    } finally {
      setPingingJob(null);
    }
  };

  const handleReportIssue = async (jobId) => {
    if (!issueNote.trim() && issuePhotos.length === 0) {
      showMsg('Please add a note or at least one photo');
      return;
    }
    setReportingIssue(true);
    try {
      const loc = await getCurrentLocation();
      const formData = new FormData();
      formData.append('note', issueNote);
      issuePhotos.forEach(p => formData.append('photos', p.file || p));
      if (loc) {
        formData.append('lat', String(loc.lat));
        formData.append('lng', String(loc.lng));
      }
      const res = await axios.post(`${API_URL}/api/jobs/${jobId}/report-issue`, formData, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'multipart/form-data' }
      });
      showMsg('Issue reported. The other party has been notified.');
      setReportingIssueJob(null);
      setIssueNote('');
      setIssuePhotos([]);
      if (viewingJobRef.current?._id === jobId && res?.data?.job) {
        setViewingJob(res.data.job);
        autoRouteWorkHub(res.data.job, 'issue_reported');
      }
      await fetchMyJobs(); await fetchMyApplications(); await fetchJobs();
      if (viewingJobRef.current?._id === jobId) {
        try {
          const latest = await axios.get(`${API_URL}/api/jobs/${jobId}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
          if (latest.data) setViewingJob(latest.data);
        } catch (refreshErr) {
          // Non-blocking: list refresh already succeeded
        }
      }
    } catch (err) {
      showMsg(err.response?.data?.error || 'Failed to report issue');
    } finally {
      setReportingIssue(false);
    }
  };

  const handleUploadWorkProof = async (jobId) => {
    if (!proofPhotos.length) { showMsg('Please add at least one proof photo.'); return; }
    setUploadingProof(true);
    try {
      const loc = await getCurrentLocation();
      const formData = new FormData();
      proofPhotos.forEach(p => formData.append('photos', p.file || p));
      formData.append('stage', proofStage);
      if (proofNote.trim()) formData.append('note', proofNote.trim());
      if (loc) {
        formData.append('lat', String(loc.lat));
        formData.append('lng', String(loc.lng));
      }
      const res = await axios.post(`${API_URL}/api/jobs/${jobId}/upload-proof`, formData, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'multipart/form-data' }
      });
      showMsg(res?.data?.message || 'Work proof uploaded.');
      setProofPhotos([]);
      setProofNote('');
      await fetchMyJobs(); await fetchMyApplications(); await fetchJobs();
      if (viewingJobRef.current?._id === jobId) {
        const latest = await axios.get(`${API_URL}/api/jobs/${jobId}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        if (latest?.data) setViewingJob(latest.data);
      }
    } catch (err) {
      showMsg(err.response?.data?.error || 'Failed to upload proof');
    } finally {
      setUploadingProof(false);
    }
  };

  const handleStopJobWithEvidence = async (jobId) => {
    if (!stopReason.trim() || stopPhotos.length === 0) {
      showMsg('Stopping the job requires a reason and at least one photo evidence item.');
      return;
    }
    if (!window.confirm('Stop this job now? This will cancel the active job and notify the helper.')) return;
    setStoppingJob(true);
    try {
      const formData = new FormData();
      formData.append('reason', stopReason.trim());
      stopPhotos.forEach(p => formData.append('stopPhotos', p.file || p));
      const res = await axios.post(`${API_URL}/api/jobs/${jobId}/stop-job`, formData, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'multipart/form-data' }
      });
      showMsg(res?.data?.message || 'Job stopped.');
      setStopReason('');
      setStopPhotos([]);
      setWorkHubOpen(false);
      await fetchMyJobs(); await fetchMyApplications(); await fetchJobs();
      navigate('/jobs', { replace: true });
    } catch (err) {
      showMsg(err.response?.data?.error || 'Failed to stop job');
    } finally {
      setStoppingJob(false);
    }
  };

  const getCurrentLocation = () => new Promise((resolve) => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 10000, enableHighAccuracy: true }
    );
  });

  const openConfirmCompletion = (job) => {
    setConfirmingJob(job);
    setConfirmPhotos([]);
  };

  function autoRouteWorkHub(job, eventType = '') {
    if (!job?._id) return;
    if (viewingJobRef.current?._id !== job._id) return;

    const isPosterForJob = job.posterId?._id?.toString?.() === userId || job.posterId?.toString?.() === userId;
    const isAcceptedWorker = job.myApplication?.status === 'accepted';
    const isWorkHubEligible = ['in_progress', 'pending_review', 'pending_payment', 'completed'].includes(job.status) && (isPosterForJob || isAcceptedWorker);
    if (!isWorkHubEligible) {
      setWorkHubOpen(false);
      if (location.pathname.startsWith('/jobs/workhub/')) {
        navigate(`/jobs?view=${job._id}`, { replace: true });
        showMsg('Work Hub unlocks only after both users complete QR handshake and the job starts.');
      }
      return;
    }

    // Keep Work Hub as source of truth and auto-route users to the most relevant step
    setWorkHubOpen(true);
    if (!location.pathname.startsWith('/jobs/workhub/')) {
      navigate(`/jobs/workhub/${job._id}`, { replace: true });
    }

    const normalized = String(eventType || '').toLowerCase();
    const isIssueEvent = normalized.includes('issue');
    const waitingOtherToConfirm = job.status === 'pending_review' && job.completionRequest?.status === 'pending';
    const canCurrentUserConfirm = waitingOtherToConfirm && job.completionRequest?.initiatedBy?.toString?.() !== userId;

    if (isIssueEvent) {
      setWorkHubTab('issues');
      return;
    }

    if (job.status === 'pending_payment' || job.status === 'completed' || waitingOtherToConfirm) {
      setWorkHubTab('complete');
      if (canCurrentUserConfirm) {
        openConfirmCompletion(job);
      }
      return;
    }

    if (normalized.includes('proof') || normalized.includes('completion')) {
      setWorkHubTab('proof');
      return;
    }

    setWorkHubTab('overview');
  }



  const handleConfirmCompletionSubmit = async () => {
    if (confirmPhotos.length === 0) {
      showMsg('Please take at least one photo with your camera to confirm');
      return;
    }
    setConfirmingCompletion(true);
    const isConfPoster = confirmingJob.posterId?._id?.toString?.() === userId || confirmingJob.posterId?.toString?.() === userId;
    const confAlreadyReviewed = isConfPoster ? confirmingJob.posterReviewed : confirmingJob.providerReviewed;
    const confOverallRating = Math.round(Object.values(confirmCategories).reduce((a, b) => a + b, 0) / 4);
    const confLowest = Math.min(...Object.values(confirmCategories));
    if (!confAlreadyReviewed && confLowest <= 2 && confirmComment.trim().length < 10) {
      showMsg('Please share at least 10 characters of constructive feedback.');
      return;
    }
    try {
      // 1. Submit rating first (gracefully skip if already reviewed)
      if (!confAlreadyReviewed) {
        let reviewOk = false;
        try {
          await axios.post(`${API_URL}/api/jobs/${confirmingJob._id}/review`, {
            categories: confirmCategories,
            overallRating: confOverallRating,
            comment: confirmComment.trim()
          }, { headers: { Authorization: `Bearer ${token}` } });
          reviewOk = true;
        } catch (reviewErr) {
          const errMsg = reviewErr.response?.data?.error || '';
          if (typeof errMsg === 'string' && errMsg.toLowerCase().includes('already reviewed')) {
            reviewOk = true;
          } else {
            showMsg(errMsg || 'Failed to submit rating');
            return;
          }
        }
        if (!reviewOk) return;
      }

      // 2. Then upload photos + confirm completion
      const loc = await getCurrentLocation();
      const formData = new FormData();
      confirmPhotos.forEach(photo => formData.append('photos', photo));
      if (loc) {
        formData.append('lat', String(loc.lat));
        formData.append('lng', String(loc.lng));
      }
      await axios.post(`${API_URL}/api/jobs/${confirmingJob._id}/confirm-completion`, formData, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'multipart/form-data' }
      });
      showMsg('Job completion confirmed!');
      setConfirmingJob(null);
      setConfirmPhotos([]);
      setConfirmCategories({ punctuality: 5, quality: 5, communication: 5, respect: 5 });
      setConfirmComment('');
      if (viewingJob?._id === confirmingJob._id) setViewingJob(null);
      await fetchMyJobs(); await fetchMyApplications(); await fetchJobs();
    } catch (err) {
      showMsg(err.response?.data?.error || err.response?.data?.details || 'Failed to confirm completion');
    } finally {
      setConfirmingCompletion(false);
    }
  };

  const [confirmingApproval, setConfirmingApproval] = useState(null);

  const handleConfirmApproval = async (jobId, appId) => {
    if (!appId) {
      showMsg('Missing application ID. Please refresh and try again.');
      return;
    }
    setConfirmingApproval(jobId);
    try {
      await axios.post(`${API_URL}/api/jobs/${jobId}/applications/${appId}/confirm`, {}, { headers: { Authorization: `Bearer ${token}` } });
      showMsg('Job confirmed! Transaction created.');
      if (viewingJob?._id === jobId) setViewingJob(null);
      await fetchMyJobs(); await fetchMyApplications(); await fetchJobs();
    } catch (err) {
      console.error('Confirm approval error:', err);
      showMsg(err.response?.data?.error || err.response?.data?.details || 'Failed to confirm');
    } finally {
      setConfirmingApproval(null);
    }
  };

  const openGallery = (photos, startIdx = 0) => {
    const normalized = (photos || []).filter(p => p && (p.url || typeof p === 'string'));
    if (normalized.length === 0) return;
    setGalleryPhotos(normalized);
    setGalleryIndex(startIdx);
    setShowGallery(true);
  };

  const handleDeclineApproval = async (jobId, appId) => {
    if (!window.confirm('Decline this schedule? The poster can propose a different time.')) return;
    setDecliningApprovalJobId(jobId);
    try {
      await axios.post(`${API_URL}/api/jobs/${jobId}/applications/${appId}/decline`, {}, { headers: { Authorization: `Bearer ${token}` } });
      showMsg('Schedule declined.');
      await fetchMyJobs(); await fetchMyApplications(); await fetchJobs();
    } catch (err) {
      showMsg(err.response?.data?.error || 'Failed to decline');
    } finally {
      setDecliningApprovalJobId(null);
    }
  };

  const openJobDetails = async (job) => {
    if (!job?._id) return;
    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await axios.get(`${API_URL}/api/jobs/${job._id}`, { headers });
      setViewingJob(res.data || job);
      setWorkHubOpen(false);
      navigate(`/jobs?view=${job._id}`, { replace: true });
    } catch (err) {
      setViewingJob(job);
      setWorkHubOpen(false);
      navigate(`/jobs?view=${job._id}`, { replace: true });
    }
  };

  const renderJobCard = (job, context) => {
    const emoji = categoryEmojis[job.category] || '✨';
    const gradient = categoryGradients[job.category] || categoryGradients.Other;
    const firstImage = job.images?.[0];
    const isPoster = job.posterId?._id?.toString?.() === userId || job.posterId?.toString?.() === userId;
    const myApp = job.myApplication || job.applications?.find(a => a.applicantId?._id?.toString?.() === userId || a.applicantId?.toString?.() === userId);
    const acceptedApp = job.applications?.find(a => a.status === 'accepted');
    const now = new Date();
    const isExpired = job.expiresAt && new Date(job.expiresAt) <= now;
    const deadlinePassed = job.applicationDeadline && new Date(job.applicationDeadline) <= now;
    const timeRemaining = job.expiresAt ? getTimeRemaining(job.expiresAt) : null;
    const countdownColor = timeRemaining ? (timeRemaining.hours < 2 ? '#ef4444' : timeRemaining.hours < 6 ? '#f59e0b' : '#3b82f6') : null;
    void tick; // forces re-render on countdown interval

    return (
      <div key={job._id} onClick={() => openJobDetails(job)} style={{
        background: 'white', borderRadius: 24, overflow: 'hidden', border: '1px solid #f1f5f9',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.04)',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        cursor: 'pointer',
        transform: 'translateY(0)',
        minHeight: 590,
        display: 'flex',
        flexDirection: 'column',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = '0 12px 40px rgba(0,0,0,0.10), 0 4px 12px rgba(0,0,0,0.06)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.04)'; }}
      >
        {/* Image header */}
        <div style={{ position: 'relative', height: 180, background: '#f8fafc', overflow: 'hidden' }}>
          {firstImage ? (
            <img src={getImageUrl(firstImage)} alt=""
              onError={(e) => { e.target.onerror = null; e.target.src = PLACEHOLDER_IMG; }}
              style={{ width: '100%', height: '100%', objectFit: 'cover', transition: 'transform 0.5s ease' }}
              onMouseEnter={(e) => e.target.style.transform = 'scale(1.05)'}
              onMouseLeave={(e) => e.target.style.transform = 'scale(1)'} />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: gradient }}>
              <span style={{ fontSize: 64, opacity: 0.4 }}>{emoji}</span>
            </div>
          )}
          {/* Bottom gradient overlay */}
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 80, background: 'linear-gradient(to top, rgba(0,0,0,0.45), transparent)' }} />
          <div style={{
            position: 'absolute', top: 12, left: 12, width: 44, height: 44, borderRadius: 14,
            background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, boxShadow: '0 2px 10px rgba(0,0,0,0.12)'
          }}>{emoji}</div>
          <div style={{ position: 'absolute', top: 12, right: 12, display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
            <div style={{
              padding: '5px 10px', borderRadius: 20,
              background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)', color: 'white', fontSize: 11, fontWeight: 700
            }}>
              {job.distance !== null && job.distance !== undefined ? `${job.distance.toFixed(1)}km` : 'Nearby'}
            </div>
            {context === 'browse' && timeRemaining && timeRemaining.hours < 24 && (
              <div style={{
                padding: '4px 10px', borderRadius: 20,
                background: countdownColor, backdropFilter: 'blur(8px)', color: 'white', fontSize: 11, fontWeight: 700
              }}>
                ⏰ {timeRemaining.hours}h {timeRemaining.minutes}m left
              </div>
            )}
            {(context === 'posted' || context === 'applied') && ['open', 'negotiating'].includes(job.status) && timeRemaining && (
              <div style={{
                padding: '4px 10px', borderRadius: 20,
                background: countdownColor, backdropFilter: 'blur(8px)', color: 'white', fontSize: 10, fontWeight: 700
              }}>
                ⏰ {timeRemaining.hours}h {timeRemaining.minutes}m left
              </div>
            )}
            {(context === 'posted' || context === 'applied') && deadlinePassed && (
              <div style={{
                padding: '4px 10px', borderRadius: 20,
                background: 'rgba(153,27,27,0.85)', backdropFilter: 'blur(8px)', color: 'white', fontSize: 10, fontWeight: 700
              }}>
                ⛔ Applications closed
              </div>
            )}
          </div>
          {job.images?.length > 0 && (
            <div onClick={(e) => { e.stopPropagation(); openGallery(job.images); }} style={{
              position: 'absolute', bottom: 12, left: 12, padding: '5px 10px', borderRadius: 20,
              background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)', color: 'white', fontSize: 11, fontWeight: 700,
              cursor: 'pointer', transition: 'background 0.2s'
            }} onMouseEnter={(e) => e.target.style.background = 'rgba(0,0,0,0.75)'} onMouseLeave={(e) => e.target.style.background = 'rgba(0,0,0,0.55)'}>🖼️ {job.images.length} photo{job.images.length > 1 ? 's' : ''}</div>
          )}
        </div>

        {/* Body */}
        <div style={{ padding: '18px 20px 16px', flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, gap: 10 }}>
            <h4 style={{ margin: 0, fontSize: 'clamp(15px, 3.5vw, 17px)', fontWeight: 800, color: '#1e293b', lineHeight: 1.35, flex: 1 }}>{job.title}</h4>
            <div style={{ flexShrink: 0, marginTop: 2 }}>{statusBadge(job.status)}</div>
          </div>

          <p style={{ margin: '0 0 14px', fontSize: 13, color: '#64748b', lineHeight: 1.6, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {job.description}
          </p>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            {job.isUrgent && (
              <span style={{ fontSize: 10, fontWeight: 800, color: 'white', background: '#ef4444', padding: '3px 10px', borderRadius: 10 }}>🚨 URGENT</span>
            )}
            {job.estimatedDuration && (
              <span style={{ fontSize: 11, fontWeight: 600, color: '#475569', background: '#f1f5f9', padding: '3px 10px', borderRadius: 10 }}>⏱️ {job.estimatedDuration}</span>
            )}
            {(() => {
              const acceptedApp = job.applications?.find(a => ['accepted','approved','in_progress','pending_review','pending_payment','completed'].includes(a.status));
              const effectivePrice = acceptedApp?.approvedAmount || acceptedApp?.proposedAmount || job.budget;
              const isNegotiated = acceptedApp?.approvedAmount && acceptedApp.approvedAmount !== job.budget;
              const budgetRange = job.budgetMin && job.budgetMax && job.budgetMin !== job.budgetMax
                ? `R${job.budgetMin} – R${job.budgetMax}`
                : `R${effectivePrice}`;
              return (
                <span style={{ fontSize: 16, fontWeight: 800, color: '#6366f1' }}>
                  {budgetRange}
                  {isNegotiated && (
                    <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textDecoration: 'line-through', marginLeft: 6 }}>was R{job.budget}</span>
                  )}
                </span>
              );
            })()}
            <span style={{ width: 3, height: 3, borderRadius: '50%', background: '#cbd5e1' }} />
            <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>{job.posterId?.name || 'Unknown'}</span>
            {job.posterId?.rating > 0 && (
              <>
                <span style={{ width: 3, height: 3, borderRadius: '50%', background: '#cbd5e1' }} />
                <span style={{ fontSize: 12, color: '#f59e0b', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 2 }}>⭐ {job.posterId.rating.toFixed(1)}</span>
              </>
            )}
            <span style={{ width: 3, height: 3, borderRadius: '50%', background: '#cbd5e1' }} />
            <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, background: '#f1f5f9', padding: '2px 8px', borderRadius: 10 }}>{job.category}</span>
            {(job.applications?.length > 0) && (
              <>
                <span style={{ width: 3, height: 3, borderRadius: '50%', background: '#cbd5e1' }} />
                <span style={{ fontSize: 11, color: '#64748b', fontWeight: 700, background: '#e0e7ff', padding: '2px 8px', borderRadius: 10 }}>👥 {job.applications.length} applied</span>
              </>
            )}
            {job.proposedTime && (
              <>
                <span style={{ width: 3, height: 3, borderRadius: '50%', background: '#cbd5e1' }} />
                <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>
                  📅 {new Date(job.proposedTime).toLocaleString()}
                </span>
              </>
            )}
            {job.applicationDeadline && (
              <>
                <span style={{ width: 3, height: 3, borderRadius: '50%', background: '#cbd5e1' }} />
                <span style={{ fontSize: 11, color: '#b45309', fontWeight: 600 }}>
                  ⏰ Closes {new Date(job.applicationDeadline).toLocaleString()}
                </span>
              </>
            )}
          </div>

          {/* Tap hint for browse */}
          {context === 'browse' && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
              <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600 }}>Tap to view details →</span>
            </div>
          )}

          {context === 'browse' && (
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={(e) => { e.stopPropagation(); openJobDetails(job); }} style={{
                flex: 1, padding: '11px', borderRadius: 14, border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                background: '#f1f5f9', color: '#475569', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6
              }}><Eye size={14} /> View Details</button>
              {!isPoster && !myApp && ['open', 'negotiating'].includes(job.status) && !isExpired && (
                <>
                  {deadlinePassed ? (
                    <div style={{ flex: 1, padding: '11px', borderRadius: 14, fontSize: 13, fontWeight: 700, textAlign: 'center', background: '#fee2e2', color: '#991b1b' }}>
                      ⛔ Applications Closed
                    </div>
                  ) : (
                    <button onClick={(e) => { e.stopPropagation(); isLoggedIn ? setApplyingJob(job) : navigate('/login'); }} style={{
                      flex: 1, padding: '11px', borderRadius: 14, border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                      background: 'linear-gradient(135deg, #6366f1, #4f46e5)', color: 'white', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6
                    }}>{isLoggedIn ? <><Handshake size={14} /> Offer to Help</> : <>🔒 Login to Help</>}</button>
                  )}
                </>
              )}
              {!isPoster && myApp && (
                <div style={{ flex: 1, padding: '11px', borderRadius: 14, fontSize: 13, fontWeight: 700, textAlign: 'center', background: '#f8fafc', color: '#64748b' }}>
                  {statusBadge(myApp.status)}
                </div>
              )}
            </div>
          )}

          {context === 'posted' && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {['open', 'negotiating'].includes(job.status) && (
                <button onClick={(e) => { e.stopPropagation(); setViewingApplicants(job); }} style={{
                  flex: 1, padding: '11px', borderRadius: 14, border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                  background: 'linear-gradient(135deg, #6366f1, #4f46e5)', color: 'white', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6
                }}>
                  <Users size={14} /> Applicants ({job.applications?.filter(a => ['pending','negotiating'].includes(a.status))?.length || 0})
                </button>
              )}
              {job.status === 'approved' && (
                <div style={{ flex: 1, padding: '11px', borderRadius: 14, fontSize: 13, fontWeight: 700, textAlign: 'center', background: '#dbeafe', color: '#1d4ed8' }}>
                  ⏳ Waiting for applicant confirmation
                </div>
              )}
              {job.status === 'accepted' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
                  {/* Step progress */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: '#f0fdf4', borderRadius: 12, border: '1px solid #bbf7d0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                      <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#22c55e', color: 'white', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>1</div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#166534' }}>Meet &amp; Scan</div>
                    </div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>→</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, opacity: 0.5 }}>
                      <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#e2e8f0', color: '#64748b', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>2</div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b' }}>Confirm Payment (QR Scan)</div>
                    </div>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); setQrHandshakeJob(job); }} style={{
                    width: '100%', padding: '14px', borderRadius: 16, border: 'none', fontSize: 14, fontWeight: 800, cursor: 'pointer',
                    background: 'linear-gradient(135deg, #3b82f6, #6366f1)', color: 'white',
                    boxShadow: '0 4px 16px rgba(59,130,246,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 52
                  }}>
                    <span style={{ fontSize: 18 }}>📱</span> Open QR Handshake
                  </button>
                  {acceptedApp && (acceptedApp.pingCount > 0 || acceptedApp.autoPingSent) && (
                    <div style={{
                      marginTop: 8, padding: '10px 12px', borderRadius: 12,
                      background: acceptedApp.autoPingSent ? '#dbeafe' : '#fef3c7',
                      color: acceptedApp.autoPingSent ? '#1e40af' : '#92400e',
                      fontSize: 12, fontWeight: 700, textAlign: 'center'
                    }}>
                      {acceptedApp.autoPingSent && <div>📍 Helper is nearby (within 100m)</div>}
                      {acceptedApp.pingCount > 0 && (
                        <div>
                          🔔 Doorbell rung {acceptedApp.pingCount} time{acceptedApp.pingCount > 1 ? 's' : ''}
                          {acceptedApp.lastPingAt && (
                            <span style={{ fontSize: 11, fontWeight: 600, marginLeft: 6 }}>
                              (Waiting {formatElapsed(now - new Date(acceptedApp.lastPingAt).getTime())})
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              {['in_progress', 'pending_review'].includes(job.status) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
                  {/* Step progress — Step 1 complete */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: '#f0fdf4', borderRadius: 12, border: '1px solid #bbf7d0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                      <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#22c55e', color: 'white', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✓</div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#166534' }}>Meet &amp; Scan</div>
                    </div>
                    <div style={{ fontSize: 11, color: '#22c55e', fontWeight: 700 }}>→</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                      <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#f59e0b', color: 'white', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>2</div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#92400e' }}>Confirm Payment (QR Scan)</div>
                    </div>
                  </div>
                  {/* Job Started banner */}
                  <div style={{ background: 'linear-gradient(135deg, #dcfce7, #bbf7d0)', borderRadius: 14, padding: '12px 14px', border: '1px solid #86efac', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ fontSize: 24, flexShrink: 0 }}>🎉</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: '#166534' }}>Job Started!</div>
                      <div style={{ fontSize: 11, color: '#15803d', marginTop: 2 }}>
                        {job.startedAt ? `Started ${new Date(job.startedAt).toLocaleString()}` : 'Work is now in progress'}
                      </div>
                    </div>
                  </div>
                  {acceptedApp && (acceptedApp.pingCount > 0 || acceptedApp.autoPingSent) && (
                    <div style={{
                      marginTop: 8, padding: '10px 12px', borderRadius: 12,
                      background: acceptedApp.autoPingSent ? '#dbeafe' : '#fef3c7',
                      color: acceptedApp.autoPingSent ? '#1e40af' : '#92400e',
                      fontSize: 12, fontWeight: 700, textAlign: 'center'
                    }}>
                      {acceptedApp.autoPingSent && <div>📍 Helper is nearby (within 100m)</div>}
                      {acceptedApp.pingCount > 0 && (
                        <div>
                          🔔 Doorbell rung {acceptedApp.pingCount} time{acceptedApp.pingCount > 1 ? 's' : ''}
                          {acceptedApp.lastPingAt && (
                            <span style={{ fontSize: 11, fontWeight: 600, marginLeft: 6 }}>
                              (Waiting {formatElapsed(now - new Date(acceptedApp.lastPingAt).getTime())})
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 11, fontWeight: 600 }}>
                    <span style={{ background: job.posterReviewed ? '#dcfce7' : '#fef3c7', color: job.posterReviewed ? '#166534' : '#b45309', padding: '3px 10px', borderRadius: 20 }}>
                      {job.posterReviewed ? '✅' : '⏳'} You rated
                    </span>
                    <span style={{ background: job.providerReviewed ? '#dcfce7' : '#fef3c7', color: job.providerReviewed ? '#166534' : '#b45309', padding: '3px 10px', borderRadius: 20 }}>
                      {job.providerReviewed ? '✅' : '⏳'} Helper rated
                    </span>
                  </div>
                  {job.workProofPhotos?.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#475569' }}>📸 Work Photos:</span>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {job.workProofPhotos.slice(0, 4).map((p, i) => (
                          <img loading="lazy" key={i} src={getImageUrl(p)} alt="" onClick={(e) => { e.stopPropagation(); openGallery(job.workProofPhotos, i); }} onError={(e) => { e.target.onerror = null; e.target.src = PLACEHOLDER_IMG; }} style={{ width: 40, height: 40, borderRadius: 10, objectFit: 'cover', cursor: 'pointer', border: '2px solid #e2e8f0' }} />
                        ))}
                        {job.workProofPhotos.length > 4 && (
                          <div onClick={(e) => { e.stopPropagation(); openGallery(job.workProofPhotos); }} style={{ width: 40, height: 40, borderRadius: 10, background: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#475569', cursor: 'pointer' }}>+{job.workProofPhotos.length - 4}</div>
                        )}
                      </div>
                    </div>
                  )}
                  {/* Issue Reports */}
                  {job.issueReports?.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {job.issueReports.map((report, ri) => (
                        <div key={ri} style={{ background: '#fef2f2', borderRadius: 12, padding: 10, border: '1px solid #fca5a5' }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#991b1b', marginBottom: 4 }}>🚨 Issue Reported</div>
                          {report.note && <div style={{ fontSize: 12, color: '#7f1d1d', marginBottom: 4, lineHeight: 1.4 }}>{report.note}</div>}
                          {report.photos?.length > 0 && (
                            <div style={{ display: 'flex', gap: 4 }}>
                              {report.photos.slice(0, 4).map((p, i) => (
                                <img loading="lazy" key={i} src={getImageUrl(p)} alt="" onClick={(e) => { e.stopPropagation(); openGallery(report.photos, i); }} onError={(e) => { e.target.onerror = null; e.target.src = PLACEHOLDER_IMG; }} style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover', cursor: 'pointer', border: '1px solid #fca5a5' }} />
                              ))}
                              {report.photos.length > 4 && (
                                <div onClick={(e) => { e.stopPropagation(); openGallery(report.photos); }} style={{ width: 36, height: 36, borderRadius: 8, background: '#fee2e2', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, color: '#991b1b', cursor: 'pointer' }}>+{report.photos.length - 4}</div>
                              )}
                            </div>
                          )}
                          <div style={{ fontSize: 10, color: '#b91c1c', marginTop: 4, fontWeight: 600 }}>
                            {new Date(report.createdAt || report.reportedAt).toLocaleString()}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Completion request pending — provider initiated, poster needs to confirm */}
                  {job.completionRequest?.status === 'pending' && job.completionRequest.initiatedBy?.toString?.() !== userId && (
                    <div style={{ background: '#dbeafe', borderRadius: 12, padding: 10, border: '1px solid #93c5fd' }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#1d4ed8', marginBottom: 4 }}>🔔 Completion Requested</div>
                      <div style={{ fontSize: 11, color: '#1e40af', marginBottom: 8 }}>Your helper has marked this job as done. Please confirm by uploading your photos and rating.</div>
                      <button onClick={(e) => { e.stopPropagation(); openConfirmCompletion(job); }} style={{
                        width: '100%', padding: '11px', borderRadius: 14, border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                        background: 'linear-gradient(135deg, #22c55e, #16a34a)', color: 'white', minHeight: 44
                      }}>✅ Confirm Completion</button>
                    </div>
                  )}
                  {job.completionRequest?.status === 'pending' && job.completionRequest.initiatedBy?.toString?.() === userId && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ background: '#e0e7ff', borderRadius: 12, padding: 10, fontSize: 12, fontWeight: 600, color: '#4338ca' }}>
                        ⏳ Waiting for your helper to confirm completion...
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); handlePing(job._id); }} style={{
                        width: '100%', padding: '10px', borderRadius: 12, border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                        background: '#fef3c7', color: '#b45309', minHeight: 40
                      }}>🔔 Ping Helper</button>
                    </div>
                  )}
                  {!job.completionRequest?.status && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', width: '100%' }}>
                      <button onClick={(e) => { e.stopPropagation(); handleCompleteJob(job); }} style={{
                        width: '100%', padding: '11px', borderRadius: 14, border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                        background: 'linear-gradient(135deg, #f59e0b, #d97706)', color: 'white', minHeight: 44
                      }}>✅ Mark Done + Photos (Rating Required)</button>
                    </div>
                  )}
                </div>
              )}
              {job.status === 'pending_payment' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
                  {/* Step progress — Step 2 active */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: '#fffbeb', borderRadius: 12, border: '1px solid #fde68a' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                      <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#22c55e', color: 'white', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✓</div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#166534' }}>Meet &amp; Scan</div>
                    </div>
                    <div style={{ fontSize: 11, color: '#f59e0b', fontWeight: 700 }}>→</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                      <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#f59e0b', color: 'white', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>2</div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#92400e' }}>Confirm Payment (QR Scan)</div>
                    </div>
                  </div>
                  <div style={{ background: 'linear-gradient(135deg, #fef3c7, #fde68a)', borderRadius: 14, padding: '12px 14px', border: '1px solid #f59e0b', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ fontSize: 24, flexShrink: 0 }}>💰</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: '#92400e' }}>Payment Confirmation Required</div>
                      <div style={{ fontSize: 11, color: '#b45309', marginTop: 2 }}>
                        Work is done. One scan confirms payment and completes the job.
                      </div>
                    </div>
                  </div>
                  {/* Timing info */}
                  {(job.helperCompletionDurationMinutes !== undefined || job.posterConfirmationDurationMinutes !== undefined) && (
                    <div style={{ background: '#f0f9ff', borderRadius: 12, padding: '10px 12px', border: '1px solid #bae6fd', fontSize: 11, color: '#0369a1' }}>
                      {job.helperCompletionDurationMinutes !== undefined && (
                        <div>⏱️ Helper finished in {job.helperCompletionDurationMinutes} min</div>
                      )}
                      {job.posterConfirmationDurationMinutes !== undefined && (
                        <div>⏱️ You confirmed in {job.posterConfirmationDurationMinutes} min</div>
                      )}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 11, fontWeight: 600 }}>
                    <span style={{ background: '#dcfce7', color: '#166534', padding: '3px 10px', borderRadius: 20 }}>✅ You rated</span>
                    <span style={{ background: '#dcfce7', color: '#166534', padding: '3px 10px', borderRadius: 20 }}>✅ Helper rated</span>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); setPaymentHandshakeJob(job); }} style={{
                    width: '100%', padding: '14px', borderRadius: 16, border: 'none', fontSize: 14, fontWeight: 800, cursor: 'pointer',
                    background: 'linear-gradient(135deg, #f59e0b, #d97706)', color: 'white', minHeight: 52,
                    boxShadow: '0 4px 16px rgba(245,158,11,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8
                  }}>
                    <span style={{ fontSize: 18 }}>📱</span> Open QR Payment Modal
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); setViewingCompletionSummary(job); }} style={{
                    width: '100%', padding: '12px', borderRadius: 14, border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                    background: '#f0fdf4', color: '#166534', minHeight: 44, borderWidth: '1px', borderStyle: 'solid', borderColor: '#bbf7d0'
                  }}>📋 View Completion Summary</button>
                </div>
              )}
              {job.status === 'completed' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
                  <div style={{ background: 'linear-gradient(135deg, #d1fae5, #bbf7d0)', borderRadius: 14, padding: '12px 14px', border: '1px solid #86efac', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ fontSize: 24, flexShrink: 0 }}>🏆</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: '#065f46' }}>Job Completed!</div>
                      <div style={{ fontSize: 11, color: '#15803d', marginTop: 2 }}>
                        {job.completedAt ? `Completed ${new Date(job.completedAt).toLocaleDateString()}` : 'Tap to see full summary'}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 11, fontWeight: 600 }}>
                    {job.posterReviewed && (
                      <span style={{ background: '#fef9c3', color: '#854d0e', padding: '3px 10px', borderRadius: 20 }}>⭐ You rated {job.posterReview?.overallRating}/5</span>
                    )}
                    {job.providerReviewed && (
                      <span style={{ background: '#dbeafe', color: '#1d4ed8', padding: '3px 10px', borderRadius: 20 }}>⭐ Helper rated {job.providerReview?.overallRating}/5</span>
                    )}
                  </div>
                  <div style={{ background: '#dcfce7', borderRadius: 12, padding: '10px 14px', fontSize: 12, fontWeight: 700, color: '#166534', textAlign: 'center', border: '1px solid #bbf7d0' }}>
                    ✅ Payment Confirmed — Funds Released
                    {job.paymentWaitTimeMinutes !== undefined && (
                      <div style={{ fontSize: 11, fontWeight: 600, marginTop: 4 }}>
                        ⏱️ Wait time: {job.paymentWaitTimeMinutes} min
                      </div>
                    )}
                  </div>
                  {/* Timing summary */}
                  {(job.helperCompletionDurationMinutes !== undefined || job.posterConfirmationDurationMinutes !== undefined) && (
                    <div style={{ background: '#f0f9ff', borderRadius: 12, padding: '10px 12px', border: '1px solid #bae6fd', fontSize: 11, color: '#0369a1' }}>
                      {job.helperCompletionDurationMinutes !== undefined && (
                        <div>⏱️ Helper finished in {job.helperCompletionDurationMinutes} min</div>
                      )}
                      {job.posterConfirmationDurationMinutes !== undefined && (
                        <div>⏱️ You confirmed in {job.posterConfirmationDurationMinutes} min</div>
                      )}
                    </div>
                  )}
                  <button onClick={(e) => { e.stopPropagation(); setViewingCompletionSummary(job); }} style={{
                    width: '100%', padding: '12px', borderRadius: 14, border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                    background: 'linear-gradient(135deg, #065f46, #047857)', color: 'white', minHeight: 44
                  }}>📋 View Completion Summary</button>
                </div>
              )}
              {['open', 'negotiating'].includes(job.status) && (
                <button onClick={(e) => { e.stopPropagation(); handleCancelJob(job._id); }} style={{
                  padding: '11px 16px', borderRadius: 14, border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                  background: '#fee2e2', color: '#991b1b'
                }}>Cancel</button>
              )}
            </div>
          )}

          {context === 'applied' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
              {/* Row 1: Info + Withdraw */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>
                    Your offer: <span style={{ fontSize: 24, fontWeight: 900, color: '#4338ca', letterSpacing: -0.3 }}>R{job.myApplication?.proposedAmount}</span>
                    {job.myApplication?.status === 'approved' && job.myApplication?.approvedAmount && job.myApplication.approvedAmount !== job.myApplication.proposedAmount && (
                      <span style={{ color: '#16a34a', marginLeft: 8, fontSize: 20, fontWeight: 900 }}>→ Final R{job.myApplication.approvedAmount}</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{job.myApplication?.message?.slice(0, 60)}{job.myApplication?.message?.length > 60 ? '...' : ''}</div>
                  {job.myApplication?.proposedTime && (
                    <div style={{ fontSize: 11, color: '#4338ca', marginTop: 2, fontWeight: 600 }}>
                      📅 {new Date(job.myApplication.proposedTime).toLocaleString()}
                    </div>
                  )}
                  {job.myApplication?.negotiationHistory?.length > 0 && (
                    <div style={{ fontSize: 11, color: '#b45309', marginTop: 2, fontWeight: 600 }}>
                      💬 {job.myApplication.negotiationHistory.length} negotiation{job.myApplication.negotiationHistory.length > 1 ? 's' : ''}
                    </div>
                  )}
                  {job.posterId?.rating > 0 && (
                    <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 2, fontWeight: 600 }}>⭐ {job.posterId.rating.toFixed(1)} — {job.posterId?.name || 'Poster'}</div>
                  )}
                </div>
                {['pending', 'negotiating'].includes(job.myApplication?.status) && (
                  <button onClick={(e) => { e.stopPropagation(); handleWithdraw(job._id, job.myApplication?._id); }} style={{
                    padding: '10px 14px', borderRadius: 12, border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                    background: '#fee2e2', color: '#991b1b', whiteSpace: 'nowrap', minHeight: 40
                  }}>Withdraw</button>
                )}
              </div>

              {/* Row 2: Negotiation response — applicant's turn to accept/reject/counter */}
              {(() => {
                const app = job.myApplication;
                const lastOffer = app?.negotiationHistory?.length > 0 ? app.negotiationHistory[app.negotiationHistory.length - 1] : null;
                const isMyTurn = lastOffer && lastOffer.status === 'pending' && lastOffer.proposedBy?.toString?.() !== userId && lastOffer.proposedBy !== userId;
                const isWaiting = lastOffer && lastOffer.status === 'pending' && (lastOffer.proposedBy?.toString?.() === userId || lastOffer.proposedBy === userId);
                if (isMyTurn) {
                  const prevAmount = app.proposedAmount || 0;
                  const newAmount = lastOffer.amount || 0;
                  const diff = newAmount - prevAmount;
                  const isHigher = diff > 0;
                  const isLower = diff < 0;
                  const diffColor = isHigher ? '#16a34a' : isLower ? '#dc2626' : '#64748b';
                  const diffBg = isHigher ? '#dcfce7' : isLower ? '#fee2e2' : '#f1f5f9';
                  const diffArrow = isHigher ? '↑' : isLower ? '↓' : '→';
                  return (
                    <div style={{ background: '#fffbeb', borderRadius: 16, padding: 14, border: '2px solid #f59e0b', boxShadow: '0 0 0 3px rgba(245,158,11,0.15)', marginBottom: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                        <span style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, background: '#f59e0b', color: 'white', padding: '2px 8px', borderRadius: 6 }}>Action Required</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#b45309' }}>🔔 New counter offer from client:</span>
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'stretch', marginBottom: 10, flexWrap: 'wrap' }}>
                        <div style={{ flex: '1 1 120px', background: '#f8fafc', borderRadius: 14, padding: '12px 14px', textAlign: 'center', border: '1px solid #e2e8f0' }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>Previous</div>
                          <div style={{ fontSize: 22, fontWeight: 800, color: '#475569', marginTop: 4 }}>R{prevAmount}</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 28 }}>
                          <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#fef3c7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, color: '#b45309' }}>→</div>
                        </div>
                        <div style={{ flex: '1 1 120px', background: '#ffffff', borderRadius: 14, padding: '12px 14px', textAlign: 'center', border: '2px solid #fde68a' }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#b45309', textTransform: 'uppercase', letterSpacing: 0.5 }}>New Offer</div>
                          <div style={{ fontSize: 34, fontWeight: 900, color: '#111827', marginTop: 4, letterSpacing: -0.4 }}>R{newAmount}</div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: diffColor, background: diffBg, padding: '6px 14px', borderRadius: 20, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span>{diffArrow}</span>
                          <span>R{Math.abs(diff)} {isHigher ? 'more' : isLower ? 'less' : 'no change'}</span>
                        </div>
                      </div>
                      {/* Time comparison */}
                      <div style={{ background: '#f8fafc', borderRadius: 10, padding: '8px 12px', marginBottom: 10, border: '1px solid #e2e8f0' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 4 }}>⏰ Time:</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                          {job.scheduledDate && (
                            <div style={{ fontSize: 11, color: '#94a3b8' }}>
                              <span style={{ fontWeight: 600 }}>Original:</span> {new Date(job.scheduledDate).toLocaleString()}
                            </div>
                          )}
                          {app.proposedTime && (!lastOffer?.proposedTime || app.proposedTime !== lastOffer.proposedTime) && (
                            <div style={{ fontSize: 11, color: '#94a3b8' }}>
                              <span style={{ fontWeight: 600 }}>Yours:</span> {new Date(app.proposedTime).toLocaleString()}
                            </div>
                          )}
                          {lastOffer?.proposedTime && (
                            <div style={{ fontSize: 11, color: '#b45309', fontWeight: 700 }}>
                              <span>🔄 New:</span> {new Date(lastOffer.proposedTime).toLocaleString()}
                            </div>
                          )}
                        </div>
                      </div>
                      {lastOffer.message && <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>{lastOffer.message}</div>}
                      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                        <button type="button" onClick={(e) => { e.stopPropagation(); handleApplicantAcceptOffer(job._id, app._id); }} disabled={acceptingOfferJobId === job._id} style={{
                          flex: '1 1 100px', padding: '10px', borderRadius: 12, border: 'none', fontSize: 12, fontWeight: 700, cursor: acceptingOfferJobId === job._id ? 'not-allowed' : 'pointer',
                          background: '#22c55e', color: 'white', minHeight: 40, opacity: acceptingOfferJobId === job._id ? 0.6 : 1,
                        }}>{acceptingOfferJobId === job._id ? '⏳ Accepting...' : '✅ Accept Offer'}</button>
                        <button type="button" onClick={(e) => { e.stopPropagation(); handleApplicantRejectOffer(job._id, app._id); }} disabled={rejectingOfferJobId === job._id} style={{
                          flex: '1 1 100px', padding: '10px', borderRadius: 12, border: 'none', fontSize: 12, fontWeight: 700, cursor: rejectingOfferJobId === job._id ? 'not-allowed' : 'pointer',
                          background: '#fee2e2', color: '#991b1b', minHeight: 40, opacity: rejectingOfferJobId === job._id ? 0.6 : 1,
                        }}>{rejectingOfferJobId === job._id ? '⏳ Rejecting...' : '❌ Reject'}</button>
                        <button onClick={(e) => { e.stopPropagation(); openApplicantCounter(job); }} disabled={app.negotiationHistory?.length >= MAX_NEGOTIATION_ROUNDS} style={{
                          flex: '1 1 100px', padding: '10px', borderRadius: 12, border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                          background: '#dbeafe', color: '#1d4ed8', minHeight: 40,
                          opacity: app.negotiationHistory?.length >= MAX_NEGOTIATION_ROUNDS ? 0.5 : 1
                        }}>💬 Counter {app.negotiationHistory?.length > 0 ? `(${app.negotiationHistory.length}/${MAX_NEGOTIATION_ROUNDS})` : ''}</button>
                      </div>
                    </div>
                  );
                }
                if (isWaiting) {
                  return (
                    <div style={{ padding: '10px 12px', background: '#eff6ff', borderRadius: 10, border: '1px solid #bfdbfe', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                      <span style={{ fontSize: 16 }}>⏳</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#1d4ed8' }}>Waiting for client to respond to your offer</span>
                    </div>
                  );
                }
                return null;
              })()}

              {/* Row 3: Applicant counter form */}
              {applicantCounterJob?._id === job._id && (
                <div ref={applicantCounterFormRef} style={{ background: 'white', borderRadius: 16, padding: 12, border: '2px solid #6366f1', boxShadow: '0 4px 12px rgba(99,102,241,0.12)', marginBottom: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', marginBottom: 6 }}>💬 Send Counter Offer</div>
                  {job.myApplication?.negotiationHistory?.length >= 2 && (
                    <div style={{ fontSize: 11, color: '#991b1b', background: '#fee2e2', padding: '8px 10px', borderRadius: 8, marginBottom: 8, fontWeight: 600 }}>
                      ⚠️ Final round — {job.myApplication.negotiationHistory.length}/${MAX_NEGOTIATION_ROUNDS} used
                    </div>
                  )}
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#1e293b', marginBottom: 6 }}>Your Price (R)</label>
                  <input type="number" value={applicantCounterAmount} onChange={e => setApplicantCounterAmount(e.target.value)} placeholder="Amount"
                    onFocus={(e) => { e.target.style.borderColor = '#6366f1'; e.target.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.12)'; e.target.style.background = 'white'; mobileFieldFocusScroll(e); }}
                    onBlur={(e) => { e.target.style.borderColor = '#e2e8f0'; e.target.style.boxShadow = 'none'; e.target.style.background = '#fafbfc'; }}
                    style={{ width: '100%', padding: '12px 14px', borderRadius: 14, border: '1px solid #e2e8f0', fontSize: 14, marginBottom: 10, boxSizing: 'border-box', minHeight: 48, outline: 'none', background: '#fafbfc', transition: 'border-color 0.2s, box-shadow 0.2s, background 0.2s' }} />
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#1e293b', marginBottom: 6 }}>Work Time</label>
                  <input type="datetime-local" value={applicantCounterTime} onChange={e => setApplicantCounterTime(e.target.value)}
                    onFocus={(e) => { e.target.style.borderColor = '#6366f1'; e.target.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.12)'; e.target.style.background = 'white'; mobileFieldFocusScroll(e); }}
                    onBlur={(e) => { e.target.style.borderColor = '#e2e8f0'; e.target.style.boxShadow = 'none'; e.target.style.background = '#fafbfc'; }}
                    style={{ width: '100%', padding: '12px 14px', borderRadius: 14, border: '1px solid #e2e8f0', fontSize: 14, marginBottom: 10, boxSizing: 'border-box', minHeight: 48, outline: 'none', background: '#fafbfc', transition: 'border-color 0.2s, box-shadow 0.2s, background 0.2s' }} />
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#1e293b', marginBottom: 6 }}>Message <span style={{ fontWeight: 500, color: '#94a3b8' }}>(optional)</span></label>
                  <input value={applicantCounterMessage} onChange={e => setApplicantCounterMessage(e.target.value)} placeholder="Add a note..."
                    onFocus={(e) => { e.target.style.borderColor = '#6366f1'; e.target.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.12)'; e.target.style.background = 'white'; mobileFieldFocusScroll(e); }}
                    onBlur={(e) => { e.target.style.borderColor = '#e2e8f0'; e.target.style.boxShadow = 'none'; e.target.style.background = '#fafbfc'; }}
                    style={{ width: '100%', padding: '12px 14px', borderRadius: 14, border: '1px solid #e2e8f0', fontSize: 14, marginBottom: 10, boxSizing: 'border-box', minHeight: 48, outline: 'none', background: '#fafbfc', transition: 'border-color 0.2s, box-shadow 0.2s, background 0.2s' }} />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" onClick={(e) => { e.stopPropagation(); handleApplicantCounterSubmit(job._id, job.myApplication?._id); }} disabled={counterSubmittingJobId === job._id} style={{
                      flex: 1, padding: '10px', borderRadius: 10, border: 'none', fontSize: 12, fontWeight: 700, cursor: counterSubmittingJobId === job._id ? 'not-allowed' : 'pointer',
                      background: 'linear-gradient(135deg, #6366f1, #4f46e5)', color: 'white', minHeight: 40, opacity: counterSubmittingJobId === job._id ? 0.6 : 1,
                    }}>{counterSubmittingJobId === job._id ? '⏳ Sending...' : 'Send Counter'}</button>
                    <button onClick={(e) => { e.stopPropagation(); setApplicantCounterJob(null); }} style={{
                      padding: '10px 14px', borderRadius: 10, border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                      background: '#f1f5f9', color: '#475569', minHeight: 40
                    }}>Cancel</button>
                  </div>
                </div>
              )}

              {job.myApplication?.status === 'approved' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {job.myApplication?.approvedAmount && (
                    <div style={{ background: '#ecfdf3', border: '2px solid #86efac', borderRadius: 14, padding: '10px 12px', textAlign: 'center' }}>
                      <div style={{ fontSize: 11, fontWeight: 800, color: '#166534', textTransform: 'uppercase', letterSpacing: 0.6 }}>Final Confirm Price</div>
                      <div style={{ fontSize: 32, fontWeight: 900, color: '#14532d', lineHeight: 1.05 }}>R{job.myApplication.approvedAmount}</div>
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: '#1d4ed8', fontWeight: 600, textAlign: 'center' }}>
                    <Clock size={12} style={{ display: 'inline-block', verticalAlign: 'text-bottom', marginRight: 4 }} />{job.myApplication?.approvedTime ? new Date(job.myApplication.approvedTime).toLocaleString() : 'Scheduled'}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="button" onClick={(e) => { e.stopPropagation(); handleConfirmApproval(job._id, job.myApplication?._id); }} disabled={confirmingApproval === job._id} style={{
                      padding: '10px 14px', borderRadius: 12, border: 'none', fontSize: 12, fontWeight: 700, cursor: confirmingApproval === job._id ? 'not-allowed' : 'pointer',
                      background: 'linear-gradient(135deg, #22c55e, #16a34a)', color: 'white', whiteSpace: 'nowrap', minHeight: 40,
                      opacity: confirmingApproval === job._id ? 0.6 : 1,
                    }}>{confirmingApproval === job._id ? '⏳ Confirming...' : '✅ Confirm'}</button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); handleDeclineApproval(job._id, job.myApplication?._id); }} disabled={confirmingApproval === job._id || decliningApprovalJobId === job._id} style={{
                      padding: '10px 14px', borderRadius: 12, border: 'none', fontSize: 12, fontWeight: 700, cursor: (confirmingApproval === job._id || decliningApprovalJobId === job._id) ? 'not-allowed' : 'pointer',
                      background: '#fee2e2', color: '#991b1b', whiteSpace: 'nowrap', minHeight: 40,
                      opacity: (confirmingApproval === job._id || decliningApprovalJobId === job._id) ? 0.6 : 1,
                    }}>{decliningApprovalJobId === job._id ? '⏳ Declining...' : '❌ Decline'}</button>
                  </div>
                </div>
              )}
              {job.status === 'accepted' && job.myApplication?.status === 'accepted' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
                  {/* Step progress */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: '#f0fdf4', borderRadius: 12, border: '1px solid #bbf7d0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                      <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#22c55e', color: 'white', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>1</div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#166534' }}>Meet &amp; Scan</div>
                    </div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>→</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, opacity: 0.5 }}>
                      <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#e2e8f0', color: '#64748b', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>2</div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b' }}>Confirm Payment (QR Scan)</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button onClick={(e) => { e.stopPropagation(); setQrHandshakeJob(job); }} style={{
                      flex: 1, padding: '14px', borderRadius: 16, border: 'none', fontSize: 14, fontWeight: 800, cursor: 'pointer',
                      background: 'linear-gradient(135deg, #3b82f6, #6366f1)', color: 'white', whiteSpace: 'nowrap', minHeight: 52,
                      boxShadow: '0 4px 16px rgba(59,130,246,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8
                    }}>
                      <span style={{ fontSize: 18 }}>📱</span> Open QR Handshake
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); openNavigation(job.location?.lat, job.location?.lng); }} style={{
                      padding: '14px', borderRadius: 16, border: 'none', fontSize: 14, fontWeight: 700, cursor: 'pointer',
                      background: '#dbeafe', color: '#1d4ed8', whiteSpace: 'nowrap', minHeight: 52, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6
                    }}>
                      <span style={{ fontSize: 16 }}>🧭</span> Navigate
                    </button>
                  </div>
                  {/* Doorbell for helper */}
                  {/* Report Issue — helper can document problems during the job */}
                  {!isPoster && myApp && ['in_progress', 'pending_review'].includes(job.status) && (
                    <div style={{ marginTop: 8 }}>
                      {reportingIssueJob === job._id ? (
                        <div style={{ background: '#fef2f2', borderRadius: 14, padding: 12, border: '1px solid #fca5a5' }} onClick={e => e.stopPropagation()}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: '#991b1b', marginBottom: 8 }}>📝 Report an Issue</div>
                          <textarea
                            value={issueNote}
                            onChange={e => setIssueNote(e.target.value)}
                            placeholder="Describe the issue..."
                            rows={3}
                            style={{ width: '100%', padding: 10, borderRadius: 10, border: '1px solid #fca5a5', fontSize: 13, resize: 'vertical', boxSizing: 'border-box', marginBottom: 8 }}
                          />
                          <PhotoUploadFlow label="Add Photos" onChange={setIssuePhotos} />
                          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                            <button type="button" onClick={() => handleReportIssue(job._id)} disabled={reportingIssue} style={{
                              flex: 1, padding: '10px', borderRadius: 10, border: 'none', fontSize: 12, fontWeight: 700, cursor: reportingIssue ? 'not-allowed' : 'pointer',
                              background: '#ef4444', color: 'white', minHeight: 40, opacity: reportingIssue ? 0.6 : 1,
                            }}>{reportingIssue ? '⏳ Sending...' : '📤 Send Report'}</button>
                            <button type="button" onClick={() => { setReportingIssueJob(null); setIssueNote(''); setIssuePhotos([]); }} style={{
                              padding: '10px 14px', borderRadius: 10, border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                              background: '#f1f5f9', color: '#475569', minHeight: 40
                            }}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <button type="button" onClick={(e) => { e.stopPropagation(); setReportingIssueJob(job._id); setIssueNote(''); setIssuePhotos([]); }} style={{
                          width: '100%', padding: '10px', borderRadius: 12, border: '1px solid #fca5a5',
                          fontSize: 12, fontWeight: 700, cursor: 'pointer',
                          background: '#fef2f2', color: '#991b1b', minHeight: 40
                        }}>
                          📝 Report Issue
                        </button>
                      )}
                    </div>
                  )}

                  {!isPoster && myApp && ['accepted'].includes(job.status) && (
                    <div style={{ marginTop: 8 }}>
                      {(() => {
                        const waitingMs = myApp.lastPingAt ? now - new Date(myApp.lastPingAt).getTime() : 0;
                        const waitingMin = Math.floor(waitingMs / 60000);
                        const isLate = waitingMin >= 10;
                        const isWarn = waitingMin >= 5;
                        const allPingsUsed = myApp.pingCount >= 3;
                        return (
                          <div>
                            {/* Waiting timer + status */}
                            {myApp.lastPingAt && (
                              <div style={{
                                padding: '10px 12px', borderRadius: 12, marginBottom: 8,
                                background: isLate ? '#fee2e2' : isWarn ? '#fef3c7' : '#f0fdf4',
                                color: isLate ? '#991b1b' : isWarn ? '#92400e' : '#166534',
                                fontSize: 13, fontWeight: 700, textAlign: 'center',
                                border: `1px solid ${isLate ? '#fca5a5' : isWarn ? '#fde68a' : '#86efac'}`
                              }}>
                                <div>⏱️ Waiting: {formatElapsed(waitingMs)}</div>
                                {isLate && <div style={{ fontSize: 11, marginTop: 2, fontWeight: 600 }}>Provider is very late!</div>}
                                {!isLate && isWarn && <div style={{ fontSize: 11, marginTop: 2, fontWeight: 600 }}>Approaching 10 min limit</div>}
                              </div>
                            )}
                            {/* Impatient warning */}
                            {allPingsUsed && myApp.firstPingAt && (() => {
                              const firstToLastMs = new Date(myApp.lastPingAt).getTime() - new Date(myApp.firstPingAt).getTime();
                              const usedAllIn5Min = firstToLastMs <= 5 * 60 * 1000;
                              return usedAllIn5Min ? (
                                <div style={{
                                  padding: '8px 12px', borderRadius: 10, marginBottom: 8,
                                  background: '#fef2f2', color: '#991b1b',
                                  fontSize: 11, fontWeight: 700, textAlign: 'center'
                                }}>
                                  ⚠️ All 3 rings used within 5 minutes — flagged as impatient
                                </div>
                              ) : null;
                            })()}
                            {/* Doorbell button */}
                            {allPingsUsed ? (
                              <div style={{
                                padding: '10px 12px', borderRadius: 12, background: '#fee2e2', color: '#991b1b',
                                fontSize: 12, fontWeight: 700, textAlign: 'center'
                              }}>
                                🚫 Max doorbell rings reached (3/3)
                              </div>
                            ) : (
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  setPingingJob(job._id);
                                  try {
                                    const res = await axios.post(`${API_URL}/api/jobs/${job._id}/ping`, { type: 'manual' }, {
                                      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
                                    });
                                    if (res.data.impatient) {
                                      showMsg('Doorbell rung! Flagged as impatient (3 rings in under 5 min)');
                                    } else {
                                      showMsg(`Doorbell rung! (${res.data.pingCount}/3)`);
                                    }
                                    silentRefresh(job._id);
                                  } catch (err) {
                                    const msg = err.response?.data?.error || 'Failed to ring doorbell';
                                    showMsg(msg);
                                  }
                                  setPingingJob(null);
                                }}
                                disabled={pingingJob === job._id}
                                style={{
                                  width: '100%', padding: '11px', borderRadius: 14, border: 'none',
                                  fontSize: 13, fontWeight: 700, cursor: 'pointer',
                                  background: myApp.pingCount > 0 ? '#fef3c7' : 'linear-gradient(135deg, #f59e0b, #d97706)',
                                  color: myApp.pingCount > 0 ? '#92400e' : 'white',
                                  minHeight: 44
                                }}
                              >
                                {pingingJob === job._id ? '⏳ Ringing...' : `🔔 Ring Doorbell (${myApp.pingCount || 0}/3)`}
                              </button>
                            )}
                            {/* Flag provider as late */}
                            {myApp.lastPingAt && isLate && (
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  setFlaggingLateJob(job._id);
                                  try {
                                    const res = await axios.post(`${API_URL}/api/jobs/${job._id}/flag-late-provider`, {}, {
                                      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
                                    });
                                    showMsg(`Provider flagged as late! (${res.data.elapsedMinutes}m wait)`);
                                  } catch (err) {
                                    showMsg(err.response?.data?.error || 'Failed to flag provider');
                                  }
                                  setFlaggingLateJob(null);
                                }}
                                disabled={flaggingLateJob === job._id}
                                style={{
                                  width: '100%', marginTop: 8, padding: '10px', borderRadius: 12, border: 'none',
                                  fontSize: 12, fontWeight: 700, cursor: 'pointer',
                                  background: '#ef4444', color: 'white', minHeight: 40
                                }}
                              >
                                {flaggingLateJob === job._id ? '⏳ Flagging...' : '⚠️ Flag Provider as Late'}
                              </button>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              )}
              {['in_progress', 'pending_review'].includes(job.status) && job.myApplication?.status === 'accepted' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {/* Step progress — Step 1 complete */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: '#f0fdf4', borderRadius: 12, border: '1px solid #bbf7d0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                      <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#22c55e', color: 'white', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✓</div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#166534' }}>Meet &amp; Scan</div>
                    </div>
                    <div style={{ fontSize: 11, color: '#22c55e', fontWeight: 700 }}>→</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                      <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#f59e0b', color: 'white', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>2</div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#92400e' }}>Confirm Payment (QR Scan)</div>
                    </div>
                  </div>
                  {/* Job Started banner for worker */}
                  <div style={{ background: 'linear-gradient(135deg, #dcfce7, #bbf7d0)', borderRadius: 14, padding: '12px 14px', border: '1px solid #86efac', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ fontSize: 24, flexShrink: 0 }}>🎉</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: '#166534' }}>Job Started!</div>
                      <div style={{ fontSize: 11, color: '#15803d', marginTop: 2 }}>
                        {job.startedAt ? `Started ${new Date(job.startedAt).toLocaleString()}` : 'Work is now in progress. Good luck!'}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 11, fontWeight: 600 }}>
                    <span style={{ background: job.providerReviewed ? '#dcfce7' : '#fef3c7', color: job.providerReviewed ? '#166534' : '#b45309', padding: '3px 10px', borderRadius: 20 }}>
                      {job.providerReviewed ? '✅' : '⏳'} You rated
                    </span>
                    <span style={{ background: job.posterReviewed ? '#dcfce7' : '#fef3c7', color: job.posterReviewed ? '#166534' : '#b45309', padding: '3px 10px', borderRadius: 20 }}>
                      {job.posterReviewed ? '✅' : '⏳'} Client rated
                    </span>
                    <button onClick={(e) => { e.stopPropagation(); openNavigation(job.location?.lat, job.location?.lng); }} style={{
                      padding: '3px 10px', borderRadius: 10, border: 'none', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                      background: '#dbeafe', color: '#1d4ed8'
                    }}>🧭 Navigate</button>
                  </div>
                  {/* Doorbell for helper */}
                  {!isPoster && myApp && ['accepted'].includes(job.status) && (
                    <div style={{ marginTop: 8 }}>
                      {(() => {
                        const waitingMs = myApp.lastPingAt ? now - new Date(myApp.lastPingAt).getTime() : 0;
                        const waitingMin = Math.floor(waitingMs / 60000);
                        const isLate = waitingMin >= 10;
                        const isWarn = waitingMin >= 5;
                        const allPingsUsed = myApp.pingCount >= 3;
                        return (
                          <div>
                            {/* Waiting timer + status */}
                            {myApp.lastPingAt && (
                              <div style={{
                                padding: '10px 12px', borderRadius: 12, marginBottom: 8,
                                background: isLate ? '#fee2e2' : isWarn ? '#fef3c7' : '#f0fdf4',
                                color: isLate ? '#991b1b' : isWarn ? '#92400e' : '#166534',
                                fontSize: 13, fontWeight: 700, textAlign: 'center',
                                border: `1px solid ${isLate ? '#fca5a5' : isWarn ? '#fde68a' : '#86efac'}`
                              }}>
                                <div>⏱️ Waiting: {formatElapsed(waitingMs)}</div>
                                {isLate && <div style={{ fontSize: 11, marginTop: 2, fontWeight: 600 }}>Provider is very late!</div>}
                                {!isLate && isWarn && <div style={{ fontSize: 11, marginTop: 2, fontWeight: 600 }}>Approaching 10 min limit</div>}
                              </div>
                            )}
                            {/* Impatient warning */}
                            {allPingsUsed && myApp.firstPingAt && (() => {
                              const firstToLastMs = new Date(myApp.lastPingAt).getTime() - new Date(myApp.firstPingAt).getTime();
                              const usedAllIn5Min = firstToLastMs <= 5 * 60 * 1000;
                              return usedAllIn5Min ? (
                                <div style={{
                                  padding: '8px 12px', borderRadius: 10, marginBottom: 8,
                                  background: '#fef2f2', color: '#991b1b',
                                  fontSize: 11, fontWeight: 700, textAlign: 'center'
                                }}>
                                  ⚠️ All 3 rings used within 5 minutes — flagged as impatient
                                </div>
                              ) : null;
                            })()}
                            {/* Doorbell button */}
                            {allPingsUsed ? (
                              <div style={{
                                padding: '10px 12px', borderRadius: 12, background: '#fee2e2', color: '#991b1b',
                                fontSize: 12, fontWeight: 700, textAlign: 'center'
                              }}>
                                🚫 Max doorbell rings reached (3/3)
                              </div>
                            ) : (
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  setPingingJob(job._id);
                                  try {
                                    const res = await axios.post(`${API_URL}/api/jobs/${job._id}/ping`, { type: 'manual' }, {
                                      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
                                    });
                                    if (res.data.impatient) {
                                      showMsg('Doorbell rung! Flagged as impatient (3 rings in under 5 min)');
                                    } else {
                                      showMsg(`Doorbell rung! (${res.data.pingCount}/3)`);
                                    }
                                    silentRefresh(job._id);
                                  } catch (err) {
                                    const msg = err.response?.data?.error || 'Failed to ring doorbell';
                                    showMsg(msg);
                                  }
                                  setPingingJob(null);
                                }}
                                disabled={pingingJob === job._id}
                                style={{
                                  width: '100%', padding: '11px', borderRadius: 14, border: 'none',
                                  fontSize: 13, fontWeight: 700, cursor: 'pointer',
                                  background: myApp.pingCount > 0 ? '#fef3c7' : 'linear-gradient(135deg, #f59e0b, #d97706)',
                                  color: myApp.pingCount > 0 ? '#92400e' : 'white',
                                  minHeight: 44
                                }}
                              >
                                {pingingJob === job._id ? '⏳ Ringing...' : `🔔 Ring Doorbell (${myApp.pingCount || 0}/3)`}
                              </button>
                            )}
                            {/* Flag provider as late */}
                            {myApp.lastPingAt && isLate && (
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  setFlaggingLateJob(job._id);
                                  try {
                                    const res = await axios.post(`${API_URL}/api/jobs/${job._id}/flag-late-provider`, {}, {
                                      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
                                    });
                                    showMsg(`Provider flagged as late! (${res.data.elapsedMinutes}m wait)`);
                                  } catch (err) {
                                    showMsg(err.response?.data?.error || 'Failed to flag provider');
                                  }
                                  setFlaggingLateJob(null);
                                }}
                                disabled={flaggingLateJob === job._id}
                                style={{
                                  width: '100%', marginTop: 8, padding: '10px', borderRadius: 12, border: 'none',
                                  fontSize: 12, fontWeight: 700, cursor: 'pointer',
                                  background: '#ef4444', color: 'white', minHeight: 40
                                }}
                              >
                                {flaggingLateJob === job._id ? '⏳ Flagging...' : '⚠️ Flag Provider as Late'}
                              </button>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                  {job.workProofPhotos?.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#475569' }}>📸 Work Photos:</span>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {job.workProofPhotos.slice(0, 4).map((p, i) => (
                          <img loading="lazy" key={i} src={getImageUrl(p)} alt="" onClick={(e) => { e.stopPropagation(); openGallery(job.workProofPhotos, i); }} onError={(e) => { e.target.onerror = null; e.target.src = PLACEHOLDER_IMG; }} style={{ width: 40, height: 40, borderRadius: 10, objectFit: 'cover', cursor: 'pointer', border: '2px solid #e2e8f0' }} />
                        ))}
                        {job.workProofPhotos.length > 4 && (
                          <div onClick={(e) => { e.stopPropagation(); openGallery(job.workProofPhotos); }} style={{ width: 40, height: 40, borderRadius: 10, background: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#475569', cursor: 'pointer' }}>+{job.workProofPhotos.length - 4}</div>
                        )}
                      </div>
                    </div>
                  )}
                  {/* Issue Reports */}
                  {job.issueReports?.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {job.issueReports.map((report, ri) => (
                        <div key={ri} style={{ background: '#fef2f2', borderRadius: 12, padding: 10, border: '1px solid #fca5a5' }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#991b1b', marginBottom: 4 }}>🚨 Issue Reported</div>
                          {report.note && <div style={{ fontSize: 12, color: '#7f1d1d', marginBottom: 4, lineHeight: 1.4 }}>{report.note}</div>}
                          {report.photos?.length > 0 && (
                            <div style={{ display: 'flex', gap: 4 }}>
                              {report.photos.slice(0, 4).map((p, i) => (
                                <img loading="lazy" key={i} src={getImageUrl(p)} alt="" onClick={(e) => { e.stopPropagation(); openGallery(report.photos, i); }} onError={(e) => { e.target.onerror = null; e.target.src = PLACEHOLDER_IMG; }} style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover', cursor: 'pointer', border: '1px solid #fca5a5' }} />
                              ))}
                              {report.photos.length > 4 && (
                                <div onClick={(e) => { e.stopPropagation(); openGallery(report.photos); }} style={{ width: 36, height: 36, borderRadius: 8, background: '#fee2e2', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, color: '#991b1b', cursor: 'pointer' }}>+{report.photos.length - 4}</div>
                              )}
                            </div>
                          )}
                          <div style={{ fontSize: 10, color: '#b91c1c', marginTop: 4, fontWeight: 600 }}>
                            {new Date(report.createdAt || report.reportedAt).toLocaleString()}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Completion request pending — poster initiated, provider needs to confirm */}
                  {job.completionRequest?.status === 'pending' && job.completionRequest.initiatedBy?.toString?.() !== userId && (
                    <div style={{ background: '#dbeafe', borderRadius: 12, padding: 10, border: '1px solid #93c5fd' }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#1d4ed8', marginBottom: 4 }}>🔔 Completion Requested</div>
                      <div style={{ fontSize: 11, color: '#1e40af', marginBottom: 8 }}>Your neighbour has marked this as done. Please confirm by uploading your photos and rating.</div>
                      <button onClick={(e) => { e.stopPropagation(); openConfirmCompletion(job); }} style={{
                        width: '100%', padding: '11px', borderRadius: 14, border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                        background: 'linear-gradient(135deg, #22c55e, #16a34a)', color: 'white', minHeight: 44
                      }}>✅ Confirm Completion</button>
                    </div>
                  )}
                  {job.completionRequest?.status === 'pending' && job.completionRequest.initiatedBy?.toString?.() === userId && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ background: '#e0e7ff', borderRadius: 12, padding: 10, fontSize: 12, fontWeight: 600, color: '#4338ca' }}>
                        ⏳ Waiting for your neighbour to confirm completion...
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); handlePing(job._id); }} style={{
                        width: '100%', padding: '10px', borderRadius: 12, border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                        background: '#fef3c7', color: '#b45309', minHeight: 40
                      }}>🔔 Ping Client</button>
                    </div>
                  )}
                  {!job.completionRequest?.status && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button onClick={(e) => { e.stopPropagation(); handleCompleteJob(job); }} style={{
                        padding: '10px 14px', borderRadius: 12, border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                        background: 'linear-gradient(135deg, #f59e0b, #d97706)', color: 'white', whiteSpace: 'nowrap', minHeight: 40
                      }}>✅ Mark Done + Photos (Rating Required)</button>
                    </div>
                  )}
                </div>
              )}
              {job.status === 'pending_payment' && job.myApplication?.status === 'accepted' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {/* Step progress — Step 2 active */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: '#fffbeb', borderRadius: 12, border: '1px solid #fde68a' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                      <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#22c55e', color: 'white', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✓</div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#166534' }}>Meet &amp; Scan</div>
                    </div>
                    <div style={{ fontSize: 11, color: '#f59e0b', fontWeight: 700 }}>→</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                      <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#f59e0b', color: 'white', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>2</div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#92400e' }}>Confirm Payment (QR Scan)</div>
                    </div>
                  </div>
                  <div style={{ background: 'linear-gradient(135deg, #fef3c7, #fde68a)', borderRadius: 14, padding: '12px 14px', border: '1px solid #f59e0b', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ fontSize: 24, flexShrink: 0 }}>💰</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: '#92400e' }}>Confirm Payment (QR Scan)</div>
                      <div style={{ fontSize: 11, color: '#b45309', marginTop: 2 }}>
                        Work is done. One scan confirms payment and completes the job.
                      </div>
                    </div>
                  </div>
                  {/* Timing info */}
                  {(job.helperCompletionDurationMinutes !== undefined || job.posterConfirmationDurationMinutes !== undefined) && (
                    <div style={{ background: '#f0f9ff', borderRadius: 12, padding: '10px 12px', border: '1px solid #bae6fd', fontSize: 11, color: '#0369a1' }}>
                      {job.helperCompletionDurationMinutes !== undefined && (
                        <div>⏱️ You finished in {job.helperCompletionDurationMinutes} min</div>
                      )}
                      {job.posterConfirmationDurationMinutes !== undefined && (
                        <div>⏱️ Client confirmed in {job.posterConfirmationDurationMinutes} min</div>
                      )}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 11, fontWeight: 600 }}>
                    <span style={{ background: '#dcfce7', color: '#166534', padding: '3px 10px', borderRadius: 20 }}>✅ You rated</span>
                    <span style={{ background: '#dcfce7', color: '#166534', padding: '3px 10px', borderRadius: 20 }}>✅ Client rated</span>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); setPaymentHandshakeJob(job); }} style={{
                    width: '100%', padding: '14px', borderRadius: 16, border: 'none', fontSize: 14, fontWeight: 800, cursor: 'pointer',
                    background: 'linear-gradient(135deg, #f59e0b, #d97706)', color: 'white', minHeight: 52,
                    boxShadow: '0 4px 16px rgba(245,158,11,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8
                  }}>
                    <span style={{ fontSize: 18 }}>📱</span> Open QR Payment Modal
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); setViewingCompletionSummary(job); }} style={{
                    width: '100%', padding: '12px', borderRadius: 14, border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                    background: '#f0fdf4', color: '#166534', minHeight: 44, borderWidth: '1px', borderStyle: 'solid', borderColor: '#bbf7d0'
                  }}>📋 View Completion Summary</button>
                </div>
              )}
              {job.status === 'completed' && job.myApplication?.status === 'accepted' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ background: 'linear-gradient(135deg, #d1fae5, #bbf7d0)', borderRadius: 14, padding: '12px 14px', border: '1px solid #86efac', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ fontSize: 24, flexShrink: 0 }}>🏆</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: '#065f46' }}>Job Completed!</div>
                      <div style={{ fontSize: 11, color: '#15803d', marginTop: 2 }}>
                        {job.completedAt ? `Completed ${new Date(job.completedAt).toLocaleString()}` : 'Tap to see full summary'}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 11, fontWeight: 600 }}>
                    {job.providerReviewed && (
                      <span style={{ background: '#fef9c3', color: '#854d0e', padding: '3px 10px', borderRadius: 20 }}>⭐ You rated {job.providerReview?.overallRating}/5</span>
                    )}
                    {job.posterReviewed && (
                      <span style={{ background: '#dbeafe', color: '#1d4ed8', padding: '3px 10px', borderRadius: 20 }}>⭐ Client rated {job.posterReview?.overallRating}/5</span>
                    )}
                  </div>
                  <div style={{ background: '#dcfce7', borderRadius: 12, padding: '10px 14px', fontSize: 12, fontWeight: 700, color: '#166534', textAlign: 'center', border: '1px solid #bbf7d0' }}>
                    ✅ Payment Confirmed — Funds Released
                    {job.paymentWaitTimeMinutes !== undefined && (
                      <div style={{ fontSize: 11, fontWeight: 600, marginTop: 4 }}>
                        ⏱️ Wait time: {job.paymentWaitTimeMinutes} min
                      </div>
                    )}
                  </div>
                  {/* Timing summary */}
                  {(job.helperCompletionDurationMinutes !== undefined || job.posterConfirmationDurationMinutes !== undefined) && (
                    <div style={{ background: '#f0f9ff', borderRadius: 12, padding: '10px 12px', border: '1px solid #bae6fd', fontSize: 11, color: '#0369a1' }}>
                      {job.helperCompletionDurationMinutes !== undefined && (
                        <div>⏱️ You finished in {job.helperCompletionDurationMinutes} min</div>
                      )}
                      {job.posterConfirmationDurationMinutes !== undefined && (
                        <div>⏱️ Client confirmed in {job.posterConfirmationDurationMinutes} min</div>
                      )}
                    </div>
                  )}
                  <button onClick={(e) => { e.stopPropagation(); setViewingCompletionSummary(job); }} style={{
                    width: '100%', padding: '12px', borderRadius: 14, border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                    background: 'linear-gradient(135deg, #065f46, #047857)', color: 'white', minHeight: 44
                  }}>📋 View Completion Summary</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  const categories = ['all', ...Object.keys(categoryEmojis)];

  // ── Dashboard section lists ──
  const {
    activeWork,
    needsAction,
    openPosted,
    pendingApplications,
    browseJobs,
    completedWork
  } = React.useMemo(() => {
    const activeWork = [];
    const needsAction = [];
    const openPosted = [];
    const pendingApplications = [];
    const browseJobs = [];
    const completedWork = [];

    // From myJobs (poster perspective)
    myJobs.forEach(job => {
      if (['in_progress', 'pending_review', 'pending_payment'].includes(job.status)) {
        activeWork.push({ job, context: 'posted' });
      } else if (job.status === 'accepted') {
        activeWork.push({ job, context: 'posted' });
      } else if (['open', 'negotiating'].includes(job.status)) {
        // Check if there are pending/negotiating applicants needing review
        const hasPendingApps = job.applications?.some(a => ['pending', 'negotiating'].includes(a.status));
        if (hasPendingApps) {
          needsAction.push({ job, context: 'posted' });
        } else {
          openPosted.push({ job, context: 'posted' });
        }
      } else if (job.status === 'approved') {
        needsAction.push({ job, context: 'posted' });
      } else if (job.status === 'completed') {
        completedWork.push({ job, context: 'posted' });
      }
    });

    // From myApplications (applicant perspective)
    myApplications.forEach(job => {
      const app = job.myApplication;
      if (['in_progress', 'pending_review', 'pending_payment'].includes(job.status) && app?.status === 'accepted') {
        activeWork.push({ job, context: 'applied' });
      } else if (job.status === 'accepted' && app?.status === 'accepted') {
        activeWork.push({ job, context: 'applied' });
      } else if (app?.status === 'approved') {
        needsAction.push({ job, context: 'applied' });
      } else if (['pending', 'negotiating'].includes(app?.status)) {
        const lastOffer = app?.negotiationHistory?.length > 0 ? app.negotiationHistory[app.negotiationHistory.length - 1] : null;
        const isMyTurn = lastOffer && lastOffer.status === 'pending' && lastOffer.proposedBy?.toString?.() !== userId && lastOffer.proposedBy !== userId;
        if (isMyTurn) {
          needsAction.push({ job, context: 'applied' });
        } else {
          pendingApplications.push({ job, context: 'applied' });
        }
      } else if (job.status === 'completed' && app?.status === 'accepted') {
        completedWork.push({ job, context: 'applied' });
      }
    });

    // Browse: open jobs not posted by user and not applied to
    jobs.forEach(job => {
      const isPoster = job.posterId?._id?.toString?.() === userId || job.posterId?.toString?.() === userId;
      const hasApplied = job.myApplication || job.applications?.some(a =>
        a.applicantId?._id?.toString?.() === userId || a.applicantId?.toString?.() === userId
      );
      if (!isPoster && !hasApplied) {
        browseJobs.push(job);
      }
    });

    return { activeWork, needsAction, openPosted, pendingApplications, browseJobs, completedWork };
  }, [myJobs, myApplications, jobs, userId]);

  const statusOrder = { in_progress: 0, pending_review: 0, pending_payment: 0, accepted: 1, approved: 2, negotiating: 3, pending: 3, open: 4, completed: 5 };
  const sortByStatus = (a, b) => (statusOrder[a.job.status] ?? 99) - (statusOrder[b.job.status] ?? 99);

  const filteredBrowseJobs = useMemo(() => {
    return browseJobs.filter(job => {
      if (minRatingFilter !== 'any') {
        const rating = job.posterId?.rating || 0;
        if (rating < parseFloat(minRatingFilter)) return false;
      }
      if (durationFilter !== 'any') {
        const d = job.estimatedDuration || '';
        if (durationFilter === '<1hr' && d !== '<1hr') return false;
        if (durationFilter === '1-3hrs' && d !== '1-3hrs') return false;
        if (durationFilter === '3-5hrs' && d !== '3-5hrs') return false;
        if (durationFilter === '5+hrs' && d !== '5+hrs') return false;
      }
      return true;
    }).sort((a, b) => {
      if (sortBy === 'newest') return new Date(b.createdAt) - new Date(a.createdAt);
      if (sortBy === 'budget-high') {
        const maxA = a.budgetMax || a.budget || 0;
        const maxB = b.budgetMax || b.budget || 0;
        return maxB - maxA;
      }
      if (sortBy === 'budget-low') {
        const minA = a.budgetMin || a.budget || 0;
        const minB = b.budgetMin || b.budget || 0;
        return minA - minB;
      }
      if (sortBy === 'closest') {
        const distA = a.distance === null ? Infinity : a.distance;
        const distB = b.distance === null ? Infinity : b.distance;
        return distA - distB;
      }
      return 0;
    });
  }, [browseJobs, minRatingFilter, durationFilter, sortBy]);

  const filteredBrowseGridItems = useMemo(
    () => filteredBrowseJobs.map(job => ({ job, context: 'browse' })),
    [filteredBrowseJobs]
  );

  const postedGridItems = useMemo(() => {
    return [
      ...activeWork.filter(i => i.context === 'posted'),
      ...needsAction.filter(i => i.context === 'posted'),
      ...openPosted.filter(i => i.context === 'posted'),
    ].sort(sortByStatus);
  }, [activeWork, needsAction, openPosted]);

  const appliedGridItems = useMemo(() => {
    return [
      ...activeWork.filter(i => i.context === 'applied'),
      ...needsAction.filter(i => i.context === 'applied'),
    ].sort(sortByStatus);
  }, [activeWork, needsAction]);

  const currentWorkflowState = useMemo(() => {
    if (!viewingJob) return { isPoster: false, steps: [], currentStep: 1 };
    const isPoster = isPosterForJob(viewingJob);
    const steps = getWorkflowSteps(viewingJob, isPoster);
    const currentStep = getWorkflowStep(viewingJob, isPoster);
    return { isPoster, steps, currentStep };
  }, [viewingJob, userId]);

  const handleWorkflowStepClick = (stepNum) => {
    if (!viewingJob) return;
    const currentStep = currentWorkflowState.currentStep;

    // Keep sequence strict: if user taps a future step, take them to the actionable current step.
    if (stepNum > currentStep) {
      showMsg(`Complete Step ${currentStep} first. Taking you to the current action.`);
      stepNum = currentStep;
    }

    if (viewingJob.status === 'accepted') {
      if (stepNum >= 4) {
        setWorkHubOpen(false);
        setQrHandshakeJob(viewingJob);
      }
      return;
    }

    if (['in_progress', 'pending_review', 'pending_payment', 'completed'].includes(viewingJob.status)) {
      setWorkHubOpen(true);
      if (!location.pathname.startsWith('/jobs/workhub/')) {
        navigate(`/jobs/workhub/${viewingJob._id}`, { replace: true });
      }
      if (viewingJob.status === 'pending_payment' || viewingJob.status === 'completed' || stepNum >= 6) {
        setWorkHubTab('complete');
        if (viewingJob.status === 'pending_payment') setPaymentHandshakeJob(viewingJob);
      } else if (stepNum === 5) {
        setWorkHubTab('issues');
      } else {
        setWorkHubTab('overview');
      }
      return;
    }

    if (stepNum === 3 && viewingJob.status === 'approved') {
      showMsg('Offer approved. Next: open QR handshake to start job.');
      setQrHandshakeJob(viewingJob);
    }
  };

  const viewingJobMyApp = useMemo(() => {
    if (!viewingJob) return null;
    if (viewingJob.myApplication) return viewingJob.myApplication;
    const uid = userId?.toString?.();
    return viewingJob.applications?.find(a => a?.applicantId?._id?.toString?.() === uid || a?.applicantId?.toString?.() === uid) || null;
  }, [viewingJob, userId]);

  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const jobGridTemplateColumns = viewportWidth < 640
    ? 'repeat(1, minmax(0, 1fr))'
    : viewportWidth < 1024
      ? 'repeat(auto-fill, minmax(210px, 1fr))'
      : 'repeat(auto-fill, minmax(240px, 1fr))';

  const JobGrid = ({ items }) => (
    <div style={{ display: 'grid', gridTemplateColumns: jobGridTemplateColumns, gap: 14 }}>
      {items.map(({ job, context }) => (
        <div key={`${context}-${job._id}`}>{renderJobCard(job, context)}</div>
      ))}
    </div>
  );

  const [activeTab, setActiveTab] = useState('browse');

  const tabs = useMemo(() => [
    { key: 'browse', label: 'Help Needed', shortLabel: 'Help', icon: Briefcase, count: browseJobs.length },
    { key: 'posted', label: 'My Requests', shortLabel: 'Requests', icon: ClipboardList, count: postedGridItems.length },
    { key: 'applied', label: "I'm Helping", shortLabel: 'Helping', icon: Handshake, count: appliedGridItems.length },
  ], [browseJobs.length, postedGridItems.length, appliedGridItems.length]);

  const topPrimaryButtonStyle = {
    padding: '11px 18px', minHeight: 44, borderRadius: 14, border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer',
    background: 'linear-gradient(135deg, #6366f1, #4f46e5)', color: 'white',
    boxShadow: '0 4px 16px rgba(99,102,241,0.3)', whiteSpace: 'nowrap'
  };

  const compactSelectStyle = {
    width: '100%', padding: '9px 28px 9px 12px', borderRadius: 12, border: '1.5px solid #e2e8f0', fontSize: 12, fontWeight: 600,
    color: '#475569', background: '#fafbfc', cursor: 'pointer', appearance: 'none', WebkitAppearance: 'none',
    backgroundImage: 'url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%236366f1%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E")',
    backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px top 50%', backgroundSize: '10px auto'
  };

  return (
    <div style={{ maxWidth: 1320, margin: '0 auto', width: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10, padding: '0 16px' }}>
        <div>
          <h2 style={{ margin: '0 0 2px', fontSize: 22, fontWeight: 800, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 8 }}><Handshake size={22} /> Community Help</h2>
          <p style={{ margin: 0, fontSize: 13, color: '#94a3b8' }}>Ask for help · Offer to help</p>
        </div>
        {isLoggedIn ? (
          <button onClick={() => setPostingJob(true)} style={topPrimaryButtonStyle}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Plus size={16} /> Post</span></button>
        ) : (
          <button onClick={() => navigate('/login')} style={topPrimaryButtonStyle}>🔒 Log In</button>
        )}
      </div>

      {/* Guest banner */}
      {!isLoggedIn && (
        <div style={{ background: 'linear-gradient(135deg, #dbeafe, #e0e7ff)', padding: '12px 16px', borderRadius: 16, marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', margin: '0 16px 16px' }}>
          <div style={{ fontSize: 13, color: '#1e40af', fontWeight: 600 }}>
            🔒 You're browsing as a guest. Log in to apply or post.
          </div>
          <button onClick={() => navigate('/login')} style={{
            padding: '8px 14px', borderRadius: 10, border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer',
            background: '#6366f1', color: 'white', whiteSpace: 'nowrap'
          }}>Log In</button>
        </div>
      )}

      {/* Message */}
      {message && (
        <div style={{ background: '#1e293b', color: 'white', padding: '10px 16px', borderRadius: 14, margin: '0 16px 16px', fontSize: 13, fontWeight: 700 }}>
          {message}
        </div>
      )}

      {/* Tabs */}
      {isLoggedIn && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, marginBottom: 16, padding: '0 16px' }}>
          {tabs.map(tab => {
            const active = activeTab === tab.key;
            const TabIcon = tab.icon;
            return (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
                position: 'relative', width: '100%', minWidth: 0, minHeight: 44, padding: '9px 8px', borderRadius: 14, border: 'none',
                fontSize: 12, fontWeight: 700, cursor: 'pointer',
                background: active ? '#1e293b' : '#f1f5f9',
                color: active ? 'white' : '#64748b',
                transition: 'all 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}>
                <TabIcon size={14} strokeWidth={2.2} />
                <span style={{ whiteSpace: 'nowrap' }}>{tab.shortLabel || tab.label}</span>
                {tab.count > 0 && (
                  <span style={{
                    fontSize: 10, fontWeight: 800,
                    background: active ? 'rgba(255,255,255,0.2)' : '#e2e8f0',
                    color: active ? 'white' : '#475569', padding: '1px 6px', borderRadius: 10,
                    flexShrink: 0,
                  }}>{tab.count}</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: jobGridTemplateColumns, gap: 14, padding: '0 16px' }}>
          {[1, 2, 3].map(i => (
            <div key={i} style={{ height: 300, background: '#e2e8f0', borderRadius: 20, animation: 'pulse 1.5s infinite' }} />
          ))}
        </div>
      ) : (
        <div style={{ padding: '0 16px' }}>
          {/* ═══════ BROWSE TAB ═══════ */}
          {(activeTab === 'browse' || !isLoggedIn) && (
            <>
              {/* Category filter */}
              <div style={{ marginBottom: 12, paddingLeft: 0, paddingRight: 0 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 6 }}>
                  Category
                </label>
                <select
                  value={selectedCategory}
                  onChange={e => setSelectedCategory(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 12,
                    border: '1.5px solid #e2e8f0',
                    fontSize: 13,
                    fontWeight: 600,
                    color: '#475569',
                    background: '#fafbfc',
                    cursor: 'pointer',
                    appearance: 'none',
                    WebkitAppearance: 'none',
                    backgroundImage: 'url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%236366f1%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E")',
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 10px top 50%',
                    backgroundSize: '10px auto'
                  }}
                >
                  {categories.map(cat => (
                    <option key={cat} value={cat}>
                      {cat === 'all' ? 'All categories' : `${categoryEmojis[cat] || '✨'} ${cat}`}
                    </option>
                  ))}
                </select>
              </div>

              {/* Filters & Sort */}
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, marginBottom: 16, alignItems: 'center' }}>
                  <select
                    value={minRatingFilter}
                    onChange={e => setMinRatingFilter(e.target.value)}
                    style={compactSelectStyle}
                  >
                    <option value="any">⭐ Any Rating</option>
                    <option value="3">⭐ 3+ Rating</option>
                    <option value="4">⭐ 4+ Rating</option>
                    <option value="4.5">⭐ 4.5+ Rating</option>
                  </select>
                  <select
                    value={durationFilter}
                    onChange={e => setDurationFilter(e.target.value)}
                    style={compactSelectStyle}
                  >
                    <option value="any">⏱️ Any Duration</option>
                    <option value="<1hr">⏱️ Less than 1hr</option>
                    <option value="1-3hrs">⏱️ 1–3hrs</option>
                    <option value="3-5hrs">⏱️ 3–5hrs</option>
                    <option value="5+hrs">⏱️ 5+hrs</option>
                  </select>
                  <select
                    value={sortBy}
                    onChange={e => setSortBy(e.target.value)}
                    style={compactSelectStyle}
                  >
                    <option value="newest">🆕 Newest</option>
                    <option value="budget-high">💰 Budget High-Low</option>
                    <option value="budget-low">💰 Budget Low-High</option>
                    <option value="closest">📍 Closest</option>
                  </select>
                  <span style={{ gridColumn: '1 / -1', fontSize: 11, color: '#94a3b8', fontWeight: 600, textAlign: 'right' }}>{filteredBrowseJobs.length} result{filteredBrowseJobs.length !== 1 ? 's' : ''}</span>
                </div>
                {filteredBrowseJobs.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '50px 20px', background: 'white', borderRadius: 20, border: '1px solid #e2e8f0' }}>
                    <div style={{ fontSize: 40, marginBottom: 10 }}>🤝</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b' }}>No one needs help right now</div>
                    <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>Be the first to ask — your neighbours are ready</div>
                  </div>
                ) : (
                  <JobGrid items={filteredBrowseGridItems} />
                )}
              </>
            </>
          )}

          {/* ═══════ POSTED TAB ═══════ */}
          {isLoggedIn && activeTab === 'posted' && (
            <>
              {myJobs.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '50px 20px', background: 'white', borderRadius: 20, border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: 40, marginBottom: 10 }}>📌</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b' }}>No requests yet</div>
                  <div style={{ fontSize: 13, color: '#64748b', marginTop: 4, marginBottom: 16 }}>Ask your community for a hand — they're ready to help</div>
                  <button onClick={() => setPostingJob(true)} style={{
                    padding: '12px 24px', borderRadius: 14, border: 'none', fontSize: 14, fontWeight: 700, cursor: 'pointer',
                    background: 'linear-gradient(135deg, #6366f1, #4f46e5)', color: 'white',
                  }}>Ask a Neighbour</button>
                </div>
              ) : (
                <JobGrid items={postedGridItems} />
              )}
            </>
          )}

          {/* ═══════ APPLIED TAB ═══════ */}
          {isLoggedIn && activeTab === 'applied' && (
            <>
              {myApplications.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '50px 20px', background: 'white', borderRadius: 20, border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: 40, marginBottom: 10 }}>🤝</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b' }}>You're not helping yet</div>
                  <div style={{ fontSize: 13, color: '#64748b', marginTop: 4, marginBottom: 16 }}>See what your neighbours need and lend a hand</div>
                  <button onClick={() => setActiveTab('browse')} style={{
                    padding: '12px 24px', borderRadius: 14, border: 'none', fontSize: 14, fontWeight: 700, cursor: 'pointer',
                    background: 'linear-gradient(135deg, #6366f1, #4f46e5)', color: 'white',
                  }}>See Who Needs Help</button>
                </div>
              ) : (
                <JobGrid items={appliedGridItems} />
              )}
            </>
          )}
        </div>
      )}

      {/* Modals */}
      {postingJob && (
        <PostJobModal
          user={user}
          onClose={() => setPostingJob(false)}
          onPosted={() => { setPostingJob(false); showMsg('Job posted!'); fetchMyJobs(); fetchMyApplications(); fetchJobs(); }}
        />
      )}

      {applyingJob && (
        <ApplyJobModal
          job={applyingJob}
          onClose={() => setApplyingJob(null)}
          onApplied={() => { setApplyingJob(null); showMsg('Offer to help sent!'); fetchMyJobs(); fetchMyApplications(); fetchJobs(); }}
        />
      )}

      {viewingApplicants && (
        <JobApplicantsModal
          job={viewingApplicants}
          user={user}
          onClose={() => setViewingApplicants(null)}
          onUpdated={() => { showMsg('Updated!'); fetchMyJobs(); fetchMyApplications(); fetchJobs(); }}
          onViewPortfolio={onViewPortfolio}
        />
      )}


      {/* Job Detail Modal */}
      {viewingJob && (
        <div style={{
          position: 'fixed', inset: 0, background: 'linear-gradient(180deg, #eef2ff 0%, #f8fafc 28%, #f8fafc 100%)',
          zIndex: 9998, display: 'flex', flexDirection: 'column',
          overflow: 'hidden'
        }}>
          {/* Full-page header */}
          <div style={{
            background: 'white', borderBottom: '1px solid #e2e8f0',
            padding: isMobile ? '12px 16px' : '16px 24px',
            display: 'flex', alignItems: 'center', gap: 12,
            flexShrink: 0, position: 'sticky', top: 0, zIndex: 10
          }}>
            <button onClick={() => setViewingJob(null)} style={{
              width: 40, height: 40, borderRadius: '50%', border: 'none',
              background: '#f1f5f9', cursor: 'pointer', fontSize: 20, color: '#475569',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
            }}>←</button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: isMobile ? 15 : 17, fontWeight: 800, color: '#1e293b',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
              }}>{viewingJob.title}</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{viewingJob.category || 'Job'}</div>
            </div>
            {statusBadge(viewingJob.status)}
          </div>

          <div ref={jobDetailScrollRef} style={{
            flex: 1, overflowY: 'auto', overflowX: 'hidden',
            padding: isMobile ? '12px 14px 100px' : '20px 24px 100px'
          }}>
            <div style={{ maxWidth: 680, margin: '0 auto' }}>
              {/* Hero summary */}
              <div style={{ marginBottom: 14, background: 'white', border: '1px solid #e2e8f0', borderRadius: 18, padding: isMobile ? '14px 14px' : '16px 18px', boxShadow: '0 8px 24px rgba(15,23,42,0.06)' }}>
                <h3 style={{ margin: '0 0 6px', fontSize: 'clamp(22px, 5vw, 28px)', lineHeight: 1.2, fontWeight: 850, color: '#0f172a' }}>{viewingJob.title}</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <span style={{ fontSize: 24 }}>{categoryEmojis[viewingJob.category] || '✨'}</span>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#334155' }}>{viewingJob.category}</div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                  <span style={{ background: '#eef2ff', color: '#4338ca', fontSize: 20, fontWeight: 900, padding: '6px 12px', borderRadius: 12 }}>
                    {viewingJob.budgetMin && viewingJob.budgetMax && viewingJob.budgetMin !== viewingJob.budgetMax
                      ? `R${viewingJob.budgetMin} – R${viewingJob.budgetMax}`
                      : `R${viewingJob.budget}`}
                  </span>
                  {viewingJob.isUrgent && <span style={{ background: '#ef4444', color: 'white', fontSize: 11, fontWeight: 800, padding: '5px 10px', borderRadius: 999 }}>URGENT</span>}
                  {viewingJob.estimatedDuration && <span style={{ background: '#f1f5f9', color: '#475569', fontSize: 11, fontWeight: 700, padding: '5px 10px', borderRadius: 999 }}>{viewingJob.estimatedDuration}</span>}
                </div>
              </div>
              <p style={{ fontSize: 16, color: '#334155', lineHeight: 1.65, marginBottom: 14, background: 'white', border: '1px solid #e2e8f0', borderRadius: 16, padding: '12px 14px' }}>{viewingJob.description}</p>

            <div style={{ marginBottom: 14, background: 'white', border: '1px solid #e2e8f0', borderRadius: 16, padding: '12px 12px' }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#334155', marginBottom: 8 }}>
                {currentWorkflowState.isPoster ? 'Poster Workflow' : 'Helper Workflow'} — Step {currentWorkflowState.currentStep} of {currentWorkflowState.steps.length}
              </div>
              <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
                {currentWorkflowState.steps.map((label, idx) => {
                  const stepNum = idx + 1;
                  const isDone = stepNum < currentWorkflowState.currentStep;
                  const isCurrent = stepNum === currentWorkflowState.currentStep;
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => handleWorkflowStepClick(stepNum)}
                      style={{
                        minWidth: isMobile ? 150 : 170,
                        borderRadius: 12,
                        padding: '8px 10px',
                        border: isCurrent ? '2px solid #4f46e5' : '1px solid #e2e8f0',
                        background: isDone ? '#ecfdf5' : isCurrent ? '#eef2ff' : '#f8fafc',
                        textAlign: 'left',
                        cursor: 'pointer'
                      }}
                    >
                      <div style={{ fontSize: 10, fontWeight: 800, color: isDone ? '#166534' : isCurrent ? '#4338ca' : '#64748b' }}>
                        {isDone ? '✓' : isCurrent ? '▶' : '•'} STEP {stepNum}
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#1e293b', marginTop: 2 }}>{label}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Job Images Gallery */}
            {viewingJob.images?.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Photos</div>
                <div style={{
                  display: 'flex',
                  gap: 10,
                  overflowX: 'auto',
                  overflowY: 'hidden',
                  paddingBottom: 4,
                  scrollSnapType: 'x mandatory',
                  WebkitOverflowScrolling: 'touch'
                }}>
                  {viewingJob.images.map((img, i) => (
                    <img key={i} src={getImageUrl(img)} alt=""
                      onClick={() => openGallery && openGallery(viewingJob.images, i)}
                      onError={(e) => { e.target.onerror = null; e.target.src = PLACEHOLDER_IMG; }}
                      style={{
                        width: isMobile ? 150 : 170,
                        height: isMobile ? 150 : 170,
                        minWidth: isMobile ? 150 : 170,
                        borderRadius: 14,
                        objectFit: 'cover',
                        cursor: 'pointer',
                        border: '2px solid #e2e8f0',
                        transition: 'transform 0.2s',
                        scrollSnapAlign: 'start'
                      }}
                      onMouseEnter={(e) => e.target.style.transform = 'scale(1.03)'}
                      onMouseLeave={(e) => e.target.style.transform = 'scale(1)'}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Job Key Details Section */}
            <div style={{ background: 'white', borderRadius: 18, padding: isMobile ? '14px 14px' : '16px 18px', marginBottom: 14, border: '1px solid #e2e8f0', boxShadow: '0 8px 24px rgba(15,23,42,0.05)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Job Details</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {/* Schedule */}
                <div>
                  <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>Schedule</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>
                    {viewingJob.proposedTime || viewingJob.scheduledDate
                      ? new Date(viewingJob.proposedTime || viewingJob.scheduledDate).toLocaleString()
                      : 'Flexible'}
                  </div>
                  {viewingJob.timeIsNegotiable && (
                    <div style={{ fontSize: 10, color: '#6366f1', fontWeight: 600, marginTop: 2 }}>Time negotiable</div>
                  )}
                </div>
                {/* Payment Method */}
                <div>
                  <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>Payment</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: viewingJob.paymentMethod === 'escrow' ? '#6366f1' : '#1e293b' }}>
                    {viewingJob.paymentMethod === 'escrow' ? 'Escrow (Secured)' : 'Cash on Completion'}
                  </div>
                  {viewingJob.paymentMethod === 'escrow' && (
                    <div style={{ fontSize: 10, color: '#16a34a', fontWeight: 600, marginTop: 2 }}>Funds held safely until done</div>
                  )}
                </div>
                {/* Budget */}
                <div>
                  <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>Budget</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: '#6366f1' }}>
                    {viewingJob.budgetMin && viewingJob.budgetMax && viewingJob.budgetMin !== viewingJob.budgetMax
                      ? `R${viewingJob.budgetMin} – R${viewingJob.budgetMax}`
                      : `R${viewingJob.budget}`}
                  </div>
                  {(viewingJob.budgetMin && viewingJob.budgetMax && viewingJob.budgetMin !== viewingJob.budgetMax) && (
                    <div style={{ fontSize: 10, color: '#6366f1', fontWeight: 600, marginTop: 2 }}>Price negotiable</div>
                  )}
                </div>
                {/* Duration */}
                <div>
                  <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>Duration</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>
                    {viewingJob.estimatedDuration || 'Not specified'}
                  </div>
                </div>
                {/* Application Deadline */}
                {viewingJob.applicationDeadline && (
                  <div>
                    <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>Apply By</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#b45309' }}>
                      {new Date(viewingJob.applicationDeadline).toLocaleString()}
                    </div>
                  </div>
                )}
                {/* Job Expiry */}
                {viewingJob.expiresAt && (
                  <div>
                    <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>Expires</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>
                      {new Date(viewingJob.expiresAt).toLocaleDateString()}
                    </div>
                  </div>
                )}
                {/* Urgent Flag */}
                {viewingJob.isUrgent && (
                  <div style={{ gridColumn: 'span 2' }}>
                    <span style={{ background: '#ef4444', color: 'white', fontSize: 11, fontWeight: 800, padding: '4px 12px', borderRadius: 10 }}>URGENT</span>
                  </div>
                )}
              </div>
              {/* Tags */}
              {viewingJob.tags?.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                  {viewingJob.tags.map((tag, i) => (
                    <span key={i} style={{ fontSize: 11, fontWeight: 600, color: '#6366f1', background: '#e0e7ff', padding: '3px 10px', borderRadius: 10 }}>
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Job Started banner in detail view */}
            {['in_progress', 'pending_review'].includes(viewingJob.status) && (
              <div style={{ background: 'linear-gradient(135deg, #dcfce7, #bbf7d0)', borderRadius: 14, padding: '14px 16px', border: '1px solid #86efac', display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <div style={{ fontSize: 28, flexShrink: 0 }}>🎉</div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#166534' }}>Job Started!</div>
                  <div style={{ fontSize: 12, color: '#15803d', marginTop: 2 }}>
                    {viewingJob.startedAt ? `Started on ${new Date(viewingJob.startedAt).toLocaleString()}` : 'Work is now in progress'}
                  </div>
                </div>
              </div>
            )}

            {/* Job Details Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, marginBottom: 16 }}>
              <div style={{ background: 'white', borderRadius: 14, padding: '12px 12px', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>Status</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>{statusBadge(viewingJob.status)}</div>
              </div>
              <div style={{ background: 'white', borderRadius: 14, padding: '12px 12px', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>Budget</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#6366f1' }}>
                  {viewingJob.budgetMin && viewingJob.budgetMax && viewingJob.budgetMin !== viewingJob.budgetMax
                    ? `R${viewingJob.budgetMin} – R${viewingJob.budgetMax}`
                    : `R${viewingJob.budget}`}
                </div>
              </div>
              <div style={{ background: 'white', borderRadius: 14, padding: '12px 12px', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>Distance</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>
                  {viewingJob.distance !== null && viewingJob.distance !== undefined ? `${viewingJob.distance.toFixed(1)} km` : 'Nearby'}
                </div>
              </div>
              {viewingJob.estimatedDuration && (
                <div style={{ background: 'white', borderRadius: 14, padding: '12px 12px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>Duration</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>{viewingJob.estimatedDuration}</div>
                </div>
              )}
              <div style={{ background: 'white', borderRadius: 14, padding: '12px 12px', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>Posted</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>{new Date(viewingJob.createdAt).toLocaleDateString()}</div>
              </div>
              <div style={{ background: 'white', borderRadius: 14, padding: '12px 12px', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>Applications</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>{viewingJob.applications?.length || 0}</div>
              </div>
              {viewingJob.acceptedApplicationId && (
                <div style={{ background: 'white', borderRadius: 14, padding: '12px 12px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>Helper</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>
                    {viewingJob.applications?.find(a => a._id?.toString?.() === viewingJob.acceptedApplicationId?.toString?.())?.applicantId?.name || 'Assigned'}
                  </div>
                </div>
              )}
              {viewingJob.startedAt && (
                <div style={{ background: 'white', borderRadius: 14, padding: '12px 12px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>Started</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>{new Date(viewingJob.startedAt).toLocaleDateString()}</div>
                </div>
              )}
              {viewingJob.completedAt && (
                <div style={{ background: 'white', borderRadius: 14, padding: '12px 12px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>Completed</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>{new Date(viewingJob.completedAt).toLocaleDateString()}</div>
                </div>
              )}
              <div style={{ background: 'white', borderRadius: 14, padding: '12px 12px', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>Photos</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>{(viewingJob.images?.length || 0) + (viewingJob.workProofPhotos?.length || 0)} total</div>
              </div>
            </div>

            {/* Completion summary moved into Work Hub (complete tab) to keep workflow in one place */}
            {/* Non-completed jobs: show images and work proof photos normally */}
            {!['completed', 'pending_payment'].includes(viewingJob.status) && viewingJob.images?.length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                {viewingJob.images.map((img, i) => (
                  <img key={i} src={getImageUrl(img)} alt="" onClick={() => openGallery(viewingJob.images, i)} onError={(e) => { e.target.onerror = null; e.target.src = PLACEHOLDER_IMG; }} style={{ width: 80, height: 80, borderRadius: 14, objectFit: 'cover', cursor: 'pointer' }} />
                ))}
              </div>
            )}
            {!['completed', 'pending_payment'].includes(viewingJob.status) && viewingJob.workProofPhotos?.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 8 }}>📸 Work Proof Photos</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {viewingJob.workProofPhotos.map((p, i) => (
                    <img key={i} src={getImageUrl(p)} alt="" onClick={() => openGallery(viewingJob.workProofPhotos, i)} onError={(e) => { e.target.onerror = null; e.target.src = PLACEHOLDER_IMG; }} style={{ width: 72, height: 72, borderRadius: 12, objectFit: 'cover', cursor: 'pointer', border: '2px solid #e2e8f0' }} />
                  ))}
                </div>
              </div>
            )}
            {/* Negotiation Timeline */}
            {(() => {
              const acceptedApp = viewingJob.applications?.find(a => a.status === 'accepted') || viewingJob.applications?.[0];
              return acceptedApp?.negotiationHistory?.length > 0 ? (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#1e293b', marginBottom: 8 }}>💬 Negotiation History</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {acceptedApp.negotiationHistory.map((entry, i) => {
                      const isPoster = entry.proposedBy?.toString?.() === (viewingJob.posterId?._id?.toString?.() || viewingJob.posterId?.toString?.());
                      const posterName = viewingJob.posterId?.name || 'Client';
                      const providerName = acceptedApp.applicantId?.name || 'Provider';
                      const actorLabel = isPoster ? `${posterName} (Client)` : `${providerName} (Helper)`;
                      const statusLabel = String(entry.status || 'pending').replace(/_/g, ' ');
                      const statusColor = entry.status === 'accepted' ? '#166534' : entry.status === 'rejected' ? '#991b1b' : '#92400e';
                      const statusBg = entry.status === 'accepted' ? '#dcfce7' : entry.status === 'rejected' ? '#fee2e2' : '#fef3c7';
                      return (
                        <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                          <div style={{ width: 28, height: 28, borderRadius: '50%', background: isPoster ? '#dbeafe' : '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0 }}>{isPoster ? '👤' : '🛠️'}</div>
                          <div style={{ flex: 1, background: isPoster ? '#f8fafc' : '#f0fdf4', borderRadius: 12, padding: 10, border: `1px solid ${isPoster ? '#e2e8f0' : '#bbf7d0'}` }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              <div style={{ fontSize: 12, fontWeight: 800, color: '#1e293b' }}>{actorLabel}</div>
                              <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', color: statusColor, background: statusBg, borderRadius: 999, padding: '3px 8px' }}>{statusLabel}</div>
                            </div>
                            <div style={{ fontSize: 12, fontWeight: 700, color: '#1e293b', marginTop: 4 }}>
                              Offered <span style={{ color: '#22c55e' }}>R{entry.amount}</span>
                            </div>
                            {entry.proposedTime && <div style={{ fontSize: 11, color: '#64748b' }}>Proposed time: {new Date(entry.proposedTime).toLocaleString()}</div>}
                            {entry.message && <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>{entry.message}</div>}
                            <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4 }}>{new Date(entry.createdAt).toLocaleString()}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null;
            })()}
            {/* Issue Reports */}
            {!['accepted', 'in_progress', 'pending_review', 'pending_payment', 'completed'].includes(viewingJob.status) && viewingJob.issueReports?.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#991b1b', marginBottom: 8 }}>🚨 Issue Reports</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {viewingJob.issueReports.map((report, ri) => (
                    <div key={ri} style={{ background: '#fef2f2', borderRadius: 14, padding: 12, border: '1px solid #fca5a5' }}>
                      {report.note && <div style={{ fontSize: 13, color: '#7f1d1d', marginBottom: 8, lineHeight: 1.5 }}>{report.note}</div>}
                      {report.photos?.length > 0 && (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                          {report.photos.map((p, i) => (
                            <img key={i} src={getImageUrl(p)} alt="" onClick={() => openGallery(report.photos, i)} onError={(e) => { e.target.onerror = null; e.target.src = PLACEHOLDER_IMG; }} style={{ width: 64, height: 64, borderRadius: 10, objectFit: 'cover', cursor: 'pointer', border: '1px solid #fca5a5' }} />
                          ))}
                        </div>
                      )}
                      <div style={{ fontSize: 11, color: '#b91c1c', fontWeight: 600 }}>
                        Reported {new Date(report.createdAt || report.reportedAt).toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Location & Navigation (accepted / in_progress) */}
            {['accepted', 'in_progress', 'pending_review'].includes(viewingJob.status) && viewingJob.location && (currentWorkflowState.isPoster || viewingJob.myApplication?.status === 'accepted') && (
              <div ref={locationStartRef} style={{ marginBottom: 16, borderRadius: 16, overflow: 'hidden', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#1e293b', padding: '10px 12px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>📍 Job Location</span>
                  {viewingJob.myApplication?.status === 'accepted' && (
                    <button onClick={() => openNavigation(viewingJob.location.lat, viewingJob.location.lng)} style={{
                      padding: '5px 10px', borderRadius: 10, border: 'none', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                      background: '#dbeafe', color: '#1d4ed8'
                    }}>🧭 Navigate</button>
                  )}
                </div>
                <div style={{ padding: 12, background: 'white' }}>
                  <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>
                    Lat: <strong style={{ color: '#1e293b' }}>{viewingJob.location.lat?.toFixed(5)}</strong> &nbsp;•&nbsp;
                    Lng: <strong style={{ color: '#1e293b' }}>{viewingJob.location.lng?.toFixed(5)}</strong>
                  </div>

                  {/* Handshake options when accepted */}
                  {viewingJob.status === 'accepted' && (currentWorkflowState.isPoster || viewingJob.myApplication?.status === 'accepted') && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {/* QR Handshake — DEFAULT method */}
                      <div style={{ padding: 12, borderRadius: 12, background: '#dcfce7', border: '1px solid #bbf7d0' }}>
                        <div style={{ fontSize: 12, fontWeight: 800, color: '#166534', marginBottom: 4 }}>📱 QR Handshake — Default</div>
                        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>
                          Scan each other's QR code to confirm you met in person and start the job.
                        </div>
                        <button onClick={() => setQrHandshakeJob(viewingJob)} style={{
                          width: '100%', padding: '10px', borderRadius: 12, border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                          background: 'linear-gradient(135deg, #22c55e, #16a34a)', color: 'white'
                        }}>📱 Open QR Handshake</button>
                      </div>

                      {/* GPS proximity — provider-controlled fallback */}
                      <div style={{ padding: 10, borderRadius: 12, background: '#f1f5f9', border: '1px solid #e2e8f0' }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4 }}>📡 GPS Proximity Fallback (Provider Controlled)</div>
                        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>
                          Accepted helper can only use manual start within 20m after job provider enables permission.
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ width: 8, height: 8, borderRadius: '50%', background: myDistanceToJob !== null && myDistanceToJob <= 0.02 ? '#22c55e' : '#f59e0b', flexShrink: 0 }} />
                            <div style={{ flex: 1, fontSize: 11, color: '#64748b' }}>
                              You: {myDistanceToJob !== null ? `${(myDistanceToJob * 1000).toFixed(0)}m` : 'Locating...'}
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ width: 8, height: 8, borderRadius: '50%', background: otherDistanceToJob !== null && otherDistanceToJob <= 0.02 ? '#22c55e' : '#f59e0b', flexShrink: 0 }} />
                            <div style={{ flex: 1, fontSize: 11, color: '#64748b' }}>
                              Other: {otherDistanceToJob !== null ? `${(otherDistanceToJob * 1000).toFixed(0)}m` : 'Waiting...'}
                            </div>
                          </div>
                        </div>

                        {currentWorkflowState.isPoster ? (
                          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <button
                              onClick={() => handleManualStartPermission(viewingJob, !viewingJob.manualStartAllowedByPoster)}
                              style={{
                                width: '100%',
                                padding: '9px 10px',
                                borderRadius: 10,
                                border: 'none',
                                fontSize: 12,
                                fontWeight: 700,
                                cursor: 'pointer',
                                background: viewingJob.manualStartAllowedByPoster ? '#dc2626' : 'linear-gradient(135deg, #0ea5e9, #2563eb)',
                                color: 'white'
                              }}
                            >
                              {viewingJob.manualStartAllowedByPoster
                                ? '🔒 Disable 20m Manual Start'
                                : '✅ Allow Worker 20m Manual Start'}
                            </button>
                            <div style={{ fontSize: 11, color: '#475569' }}>
                              {viewingJob.manualStartAllowedByPoster
                                ? 'Worker can now start the job manually when within 20m.'
                                : 'Worker cannot use manual 20m start until you allow it.'}
                            </div>
                          </div>
                        ) : (
                          <div style={{ marginTop: 8 }}>
                            <div style={{ fontSize: 11, color: '#475569', marginBottom: 6 }}>
                              {viewingJob.manualStartAllowedByPoster
                                ? 'Job provider enabled manual start. You can use this only within 20m.'
                                : 'Waiting for job provider to enable manual 20m start.'}
                            </div>
                            <button
                              onClick={() => handleManualNearbyStart(viewingJob)}
                              disabled={!viewingJob.manualStartAllowedByPoster || myDistanceToJob === null || myDistanceToJob > 0.02}
                              style={{
                                width: '100%',
                                padding: '9px 10px',
                                borderRadius: 10,
                                border: 'none',
                                fontSize: 12,
                                fontWeight: 700,
                                cursor: viewingJob.manualStartAllowedByPoster && myDistanceToJob !== null && myDistanceToJob <= 0.02 ? 'pointer' : 'not-allowed',
                                background: viewingJob.manualStartAllowedByPoster && myDistanceToJob !== null && myDistanceToJob <= 0.02 ? 'linear-gradient(135deg, #0ea5e9, #2563eb)' : '#cbd5e1',
                                color: 'white',
                                opacity: viewingJob.manualStartAllowedByPoster && myDistanceToJob !== null && myDistanceToJob <= 0.02 ? 1 : 0.8
                              }}
                            >
                              {!viewingJob.manualStartAllowedByPoster
                                ? 'Awaiting Provider Permission'
                                : myDistanceToJob !== null && myDistanceToJob <= 0.02
                                  ? '🚀 Start Job Manually (within 20m)'
                                  : 'Move within 20m to unlock Manual Start'}
                            </button>
                          </div>
                        )}
                        {handshakeStatus !== 'complete' && (
                          <div style={{ marginTop: 6, height: 3, borderRadius: 2, background: '#e2e8f0', overflow: 'hidden' }}>
                            <div style={{
                              height: '100%',
                              width: handshakeStatus === 'nearby' ? '80%' : myDistanceToJob !== null && myDistanceToJob <= 0.02 ? '50%' : otherDistanceToJob !== null && otherDistanceToJob <= 0.02 ? '50%' : '10%',
                              borderRadius: 2,
                              background: '#6366f1',
                              transition: 'width 0.5s ease'
                            }} />
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {viewingJob.status === 'accepted' && !currentWorkflowState.isPoster && viewingJob.myApplication && viewingJob.myApplication.status !== 'accepted' && (
              <div style={{ marginBottom: 16, borderRadius: 14, border: '1px solid #fecaca', background: '#fef2f2', padding: '12px 14px' }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#991b1b', marginBottom: 4 }}>Job already assigned</div>
                <div style={{ fontSize: 12, color: '#7f1d1d', lineHeight: 1.45 }}>
                  Another applicant was selected for this job. Your application was not selected this time. You cannot open QR handshake, navigation, or Work Hub for this job. Keep going — opportunities come to those who keep applying. Tap Help Needed to find your next job.
                </div>
              </div>
            )}

            {/* Dedicated Work Hub: in-progress workspace */}
            {['in_progress', 'pending_review'].includes(viewingJob.status) && (currentWorkflowState.isPoster || viewingJob.myApplication?.status === 'accepted') && (
              <div ref={workHubCardRef} style={{ marginBottom: 16, background: 'white', border: '1px solid #dbeafe', borderRadius: 16, overflow: 'hidden' }}>
                <div style={{ padding: '10px 12px', background: 'linear-gradient(135deg, #eff6ff, #dbeafe)', borderBottom: '1px solid #bfdbfe' }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#1e3a8a' }}>🧰 Work Hub</div>
                  <div style={{ fontSize: 11, color: '#1d4ed8', marginTop: 2 }}>Track progress, report issues, upload proof, and finish safely.</div>
                </div>
                <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <button
                    type="button"
                    onClick={() => {
                      setWorkHubTab('overview');
                      setWorkHubOpen(true);
                      if (viewingJob?._id) navigate(`/jobs/workhub/${viewingJob._id}`, { replace: true });
                    }}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, #2563eb, #1d4ed8)', color: 'white', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}
                  >📋 Open Full Work Hub Page</button>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: '10px 10px' }}>
                      <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>Session Time</div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: '#0f172a', marginTop: 3 }}>
                        {viewingJob.startedAt ? formatElapsed((viewingJob.completedAt ? new Date(viewingJob.completedAt).getTime() : Date.now()) - new Date(viewingJob.startedAt).getTime()) : 'Not started'}
                      </div>
                      <div style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>
                        Start scan: {viewingJob.startedAt ? new Date(viewingJob.startedAt).toLocaleString() : '—'}
                      </div>
                      <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
                        Proof scan: {viewingJob.completedAt ? new Date(viewingJob.completedAt).toLocaleString() : 'Waiting'}
                      </div>
                    </div>
                    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: '10px 10px' }}>
                      <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>Progress State</div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: '#0f172a', marginTop: 3 }}>{viewingJob.status === 'pending_review' ? 'Awaiting confirmation' : 'Active work'}</div>
                    </div>
                  </div>

                  {currentWorkflowState.isPoster && ['in_progress', 'pending_review'].includes(viewingJob.status) && (
                    <div style={{ background: '#ecfeff', border: '1px solid #a5f3fc', borderRadius: 12, padding: '10px 12px' }}>
                      <div style={{ fontSize: 11, fontWeight: 800, color: '#0e7490', marginBottom: 4 }}>📍 Live Worker GPS (Session Active)</div>
                      <div style={{ fontSize: 11, color: '#155e75', lineHeight: 1.4 }}>
                        {otherLocation
                          ? `Lat ${Number(otherLocation.lat).toFixed(5)} • Lng ${Number(otherLocation.lng).toFixed(5)}${otherDistanceToJob !== null ? ` • ${Math.round(otherDistanceToJob * 1000)}m from job` : ''}`
                          : 'Waiting for worker location update...'}
                      </div>
                      <div style={{ fontSize: 10, color: '#0f766e', marginTop: 4 }}>
                        Tracking is active only during live session steps.
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => { setReportingIssueJob(viewingJob._id); setIssueNote(''); setIssuePhotos([]); }}
                      style={{ flex: 1, padding: '10px 12px', borderRadius: 12, border: '1px solid #fca5a5', background: '#fef2f2', color: '#991b1b', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                    >📝 Report Issue</button>
                  </div>

                  <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => handleCompleteJob(viewingJob)}
                      disabled={!!viewingJob.completionRequest?.status}
                      style={{ flex: 1, padding: '11px 12px', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, #16a34a, #15803d)', color: 'white', fontSize: 12, fontWeight: 800, cursor: viewingJob.completionRequest?.status ? 'not-allowed' : 'pointer', opacity: viewingJob.completionRequest?.status ? 0.6 : 1 }}
                    >✅ Mark Work Done + Upload Proof</button>
                    <button
                      type="button"
                      onClick={() => openNavigation(viewingJob.location?.lat, viewingJob.location?.lng)}
                      style={{ flex: 1, padding: '11px 12px', borderRadius: 12, border: '1px solid #bfdbfe', background: '#eff6ff', color: '#1d4ed8', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}
                    >🧭 Open Navigation</button>
                  </div>
                </div>
              </div>
            )}

            <div ref={jobDetailActionRef} style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
              {/* === POSTER ACTIONS === */}
              {(viewingJob.posterId?._id?.toString?.() === userId || viewingJob.posterId?.toString?.() === userId) && (
                <>
                  {/* Open/Negotiating: View Applicants + Cancel */}
                  {['open', 'negotiating'].includes(viewingJob.status) && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button onClick={() => { setViewingJob(null); setViewingApplicants(viewingJob); }} style={{
                        flex: 1, padding: '12px', borderRadius: 14, border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                        background: 'linear-gradient(135deg, #6366f1, #4f46e5)', color: 'white', minHeight: 44
                      }}>👥 View Applicants ({viewingJob.applications?.filter(a => ['pending','negotiating'].includes(a.status))?.length || 0})</button>
                      <button type="button" onClick={() => { setViewingJob(null); handleCancelJob(viewingJob._id); }} disabled={cancellingJobId === viewingJob._id} style={{
                        padding: '12px 16px', borderRadius: 14, border: 'none', fontSize: 13, fontWeight: 700, cursor: cancellingJobId === viewingJob._id ? 'not-allowed' : 'pointer',
                        background: '#fee2e2', color: '#991b1b', minHeight: 44, opacity: cancellingJobId === viewingJob._id ? 0.6 : 1,
                      }}>{cancellingJobId === viewingJob._id ? '⏳ Cancelling...' : 'Cancel Job'}</button>
                    </div>
                  )}
                  {/* Approved: waiting for applicant confirmation */}
                  {viewingJob.status === 'approved' && (
                    <div style={{ padding: '12px', borderRadius: 14, fontSize: 13, fontWeight: 700, textAlign: 'center', background: '#dbeafe', color: '#1d4ed8' }}>
                      ⏳ Waiting for applicant to confirm the schedule
                    </div>
                  )}
                  {/* Accepted QR start is handled in the newer Location & Start section above. */}
                </>
              )}

              {/* === APPLICANT / WORKER ACTIONS === */}
              {(viewingJob.posterId?._id?.toString?.() !== userId && viewingJob.posterId?.toString?.() !== userId) && (
                <>
                  {/* Not applied yet */}
                  {!viewingJob.myApplication && ['open', 'negotiating'].includes(viewingJob.status) && (
                    <button onClick={() => { setViewingJob(null); isLoggedIn ? setApplyingJob(viewingJob) : navigate('/login'); }} style={{
                      width: '100%', padding: '12px', borderRadius: 14, border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                      background: 'linear-gradient(135deg, #6366f1, #4f46e5)', color: 'white', minHeight: 44
                    }}>{isLoggedIn ? '📝 Apply Now' : '🔒 Log In to Apply'}</button>
                  )}
                  {/* Already applied - show status */}
                  {viewingJob.myApplication && !['in_progress', 'pending_review'].includes(viewingJob.status) && (
                    <div style={{ padding: '12px', borderRadius: 14, fontSize: 13, fontWeight: 700, textAlign: 'center', background: '#f8fafc', color: '#64748b', minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                      <span>📝 You applied</span>
                      {statusBadge(viewingJob.myApplication.status)}
                    </div>
                  )}
                  {/* Approved - needs confirmation */}
                  {viewingJob.myApplication?.status === 'approved' && (
                    <div ref={approvedActionRef} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <div style={{ width: '100%', fontSize: 11, color: '#1d4ed8', fontWeight: 600, textAlign: 'center' }}>
                        📅 {viewingJob.myApplication?.approvedTime ? new Date(viewingJob.myApplication.approvedTime).toLocaleString() : 'Scheduled'}
                        {viewingJob.myApplication?.approvedAmount && (
                          <span style={{ color: '#22c55e', marginLeft: 4 }}>• R{viewingJob.myApplication.approvedAmount}</span>
                        )}
                      </div>
                      <button type="button" onClick={() => handleConfirmApproval(viewingJob._id, viewingJob.myApplication?._id)} disabled={confirmingApproval === viewingJob._id} style={{
                        flex: 1, padding: '10px 14px', borderRadius: 12, border: 'none', fontSize: 12, fontWeight: 700, cursor: confirmingApproval === viewingJob._id ? 'not-allowed' : 'pointer',
                        background: 'linear-gradient(135deg, #22c55e, #16a34a)', color: 'white', minHeight: 40,
                        opacity: confirmingApproval === viewingJob._id ? 0.6 : 1,
                      }}>{confirmingApproval === viewingJob._id ? '⏳ Confirming...' : '✅ Confirm'}</button>
                      <button type="button" onClick={() => handleDeclineApproval(viewingJob._id, viewingJob.myApplication?._id)} disabled={confirmingApproval === viewingJob._id} style={{
                        flex: 1, padding: '10px 14px', borderRadius: 12, border: 'none', fontSize: 12, fontWeight: 700, cursor: confirmingApproval === viewingJob._id ? 'not-allowed' : 'pointer',
                        background: '#fee2e2', color: '#991b1b', minHeight: 40,
                        opacity: confirmingApproval === viewingJob._id ? 0.6 : 1,
                      }}>❌ Decline</button>
                    </div>
                  )}
                  {/* Accepted quick action rail removed (dedup): use Location & Start section above. */}
                  {/* Negotiation response for applicant in detail view */}
                  {(() => {
                    const app = viewingJob.myApplication;
                    const lastOffer = app?.negotiationHistory?.length > 0 ? app.negotiationHistory[app.negotiationHistory.length - 1] : null;
                    const isMyTurn = lastOffer && lastOffer.status === 'pending' && lastOffer.proposedBy?.toString?.() !== userId && lastOffer.proposedBy !== userId;
                    const isWaiting = lastOffer && lastOffer.status === 'pending' && (lastOffer.proposedBy?.toString?.() === userId || lastOffer.proposedBy === userId);
                    if (isMyTurn) {
                      const prevAmount = app.proposedAmount || 0;
                      const newAmount = lastOffer.amount || 0;
                      const diff = newAmount - prevAmount;
                      const isHigher = diff > 0;
                      const isLower = diff < 0;
                      const diffColor = isHigher ? '#16a34a' : isLower ? '#dc2626' : '#64748b';
                      const diffBg = isHigher ? '#dcfce7' : isLower ? '#fee2e2' : '#f1f5f9';
                      const diffArrow = isHigher ? '↑' : isLower ? '↓' : '→';
                      return (
                        <div ref={negotiationActionRef} style={{ width: '100%', background: '#fffbeb', borderRadius: 16, padding: 14, border: '2px solid #f59e0b', boxShadow: '0 0 0 3px rgba(245,158,11,0.15)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                            <span style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, background: '#f59e0b', color: 'white', padding: '2px 8px', borderRadius: 6 }}>Action Required</span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: '#b45309' }}>🔔 New counter offer from client:</span>
                          </div>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'stretch', marginBottom: 10, flexWrap: 'wrap' }}>
                            <div style={{ flex: '1 1 120px', background: '#f8fafc', borderRadius: 14, padding: '12px 14px', textAlign: 'center', border: '1px solid #e2e8f0' }}>
                              <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>Previous</div>
                              <div style={{ fontSize: 22, fontWeight: 800, color: '#475569', marginTop: 4 }}>R{prevAmount}</div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 28 }}>
                              <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#fef3c7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, color: '#b45309' }}>→</div>
                            </div>
                            <div style={{ flex: '1 1 120px', background: '#ffffff', borderRadius: 14, padding: '12px 14px', textAlign: 'center', border: '2px solid #fde68a' }}>
                              <div style={{ fontSize: 11, fontWeight: 700, color: '#b45309', textTransform: 'uppercase', letterSpacing: 0.5 }}>New Offer</div>
                              <div style={{ fontSize: 26, fontWeight: 800, color: '#1e293b', marginTop: 4 }}>R{newAmount}</div>
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: diffColor, background: diffBg, padding: '6px 14px', borderRadius: 20, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <span>{diffArrow}</span>
                              <span>R{Math.abs(diff)} {isHigher ? 'more' : isLower ? 'less' : 'no change'}</span>
                            </div>
                          </div>
                          <div style={{ background: '#f8fafc', borderRadius: 10, padding: '8px 12px', marginBottom: 10, border: '1px solid #e2e8f0' }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 4 }}>⏰ Time:</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                              {viewingJob.scheduledDate && (
                                <div style={{ fontSize: 11, color: '#94a3b8' }}>
                                  <span style={{ fontWeight: 600 }}>Original:</span> {new Date(viewingJob.scheduledDate).toLocaleString()}
                                </div>
                              )}
                              {app.proposedTime && (
                                <div style={{ fontSize: 11, color: '#94a3b8' }}>
                                  <span style={{ fontWeight: 600 }}>Yours:</span> {new Date(app.proposedTime).toLocaleString()}
                                </div>
                              )}
                              {lastOffer?.proposedTime && (
                                <div style={{ fontSize: 11, color: '#b45309', fontWeight: 700 }}>
                                  <span>🔄 New:</span> {new Date(lastOffer.proposedTime).toLocaleString()}
                                </div>
                              )}
                            </div>
                          </div>
                          {lastOffer.message && <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>{lastOffer.message}</div>}
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <button type="button" onClick={() => handleApplicantAcceptOffer(viewingJob._id, app._id)} disabled={acceptingOfferJobId === viewingJob._id} style={{
                              flex: '1 1 100px', padding: '10px', borderRadius: 12, border: 'none', fontSize: 12, fontWeight: 700, cursor: acceptingOfferJobId === viewingJob._id ? 'not-allowed' : 'pointer',
                              background: '#22c55e', color: 'white', minHeight: 40, opacity: acceptingOfferJobId === viewingJob._id ? 0.6 : 1,
                            }}>{acceptingOfferJobId === viewingJob._id ? '⏳ Accepting...' : '✅ Accept'}</button>
                            <button type="button" onClick={() => handleApplicantRejectOffer(viewingJob._id, app._id)} disabled={rejectingOfferJobId === viewingJob._id} style={{
                              flex: '1 1 100px', padding: '10px', borderRadius: 12, border: 'none', fontSize: 12, fontWeight: 700, cursor: rejectingOfferJobId === viewingJob._id ? 'not-allowed' : 'pointer',
                              background: '#fee2e2', color: '#991b1b', minHeight: 40, opacity: rejectingOfferJobId === viewingJob._id ? 0.6 : 1,
                            }}>{rejectingOfferJobId === viewingJob._id ? '⏳ Rejecting...' : '❌ Reject'}</button>
                            <button onClick={() => openApplicantCounter(viewingJob)} disabled={app.negotiationHistory?.length >= MAX_NEGOTIATION_ROUNDS} style={{
                              flex: '1 1 100px', padding: '10px', borderRadius: 12, border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                              background: '#dbeafe', color: '#1d4ed8', minHeight: 40,
                              opacity: app.negotiationHistory?.length >= MAX_NEGOTIATION_ROUNDS ? 0.5 : 1
                            }}>💬 Counter</button>
                          </div>
                        </div>
                      );
                    }
                    if (isWaiting) {
                      return (
                        <div style={{ width: '100%', padding: '10px 12px', background: '#eff6ff', borderRadius: 10, border: '1px solid #bfdbfe', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                          <span style={{ fontSize: 16 }}>⏳</span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: '#1d4ed8' }}>Waiting for client to respond to your offer</span>
                        </div>
                      );
                    }
                    return null;
                  })()}
                  {/* Applicant counter form in detail view */}
                  {applicantCounterJob?._id === viewingJob._id && (
                    <div style={{ width: '100%', background: 'white', borderRadius: 16, padding: 12, border: '2px solid #6366f1', boxShadow: '0 4px 12px rgba(99,102,241,0.12)' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', marginBottom: 6 }}>💬 Send Counter Offer</div>
                      {viewingJob.myApplication?.negotiationHistory?.length >= 2 && (
                        <div style={{ fontSize: 11, color: '#991b1b', background: '#fee2e2', padding: '8px 10px', borderRadius: 8, marginBottom: 8, fontWeight: 600 }}>
                          ⚠️ Final round — {viewingJob.myApplication.negotiationHistory.length}/${MAX_NEGOTIATION_ROUNDS} used
                        </div>
                      )}
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#1e293b', marginBottom: 6 }}>Your Price (R)</label>
                      <input type="number" value={applicantCounterAmount} onChange={e => setApplicantCounterAmount(e.target.value)} placeholder="Amount"
                        onFocus={(e) => { e.target.style.borderColor = '#6366f1'; e.target.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.12)'; e.target.style.background = 'white'; mobileFieldFocusScroll(e); }}
                        onBlur={(e) => { e.target.style.borderColor = '#e2e8f0'; e.target.style.boxShadow = 'none'; e.target.style.background = '#fafbfc'; }}
                        style={{ width: '100%', padding: '12px 14px', borderRadius: 14, border: '1px solid #e2e8f0', fontSize: 14, marginBottom: 10, boxSizing: 'border-box', minHeight: 48, outline: 'none', background: '#fafbfc', transition: 'border-color 0.2s, box-shadow 0.2s, background 0.2s' }} />
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#1e293b', marginBottom: 6 }}>Work Time</label>
                      <input type="datetime-local" value={applicantCounterTime} onChange={e => setApplicantCounterTime(e.target.value)}
                        onFocus={(e) => { e.target.style.borderColor = '#6366f1'; e.target.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.12)'; e.target.style.background = 'white'; mobileFieldFocusScroll(e); }}
                        onBlur={(e) => { e.target.style.borderColor = '#e2e8f0'; e.target.style.boxShadow = 'none'; e.target.style.background = '#fafbfc'; }}
                        style={{ width: '100%', padding: '12px 14px', borderRadius: 14, border: '1px solid #e2e8f0', fontSize: 14, marginBottom: 10, boxSizing: 'border-box', minHeight: 48, outline: 'none', background: '#fafbfc', transition: 'border-color 0.2s, box-shadow 0.2s, background 0.2s' }} />
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#1e293b', marginBottom: 6 }}>Message <span style={{ fontWeight: 500, color: '#94a3b8' }}>(optional)</span></label>
                      <input value={applicantCounterMessage} onChange={e => setApplicantCounterMessage(e.target.value)} placeholder="Add a note..."
                        onFocus={(e) => { e.target.style.borderColor = '#6366f1'; e.target.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.12)'; e.target.style.background = 'white'; mobileFieldFocusScroll(e); }}
                        onBlur={(e) => { e.target.style.borderColor = '#e2e8f0'; e.target.style.boxShadow = 'none'; e.target.style.background = '#fafbfc'; }}
                        style={{ width: '100%', padding: '12px 14px', borderRadius: 14, border: '1px solid #e2e8f0', fontSize: 14, marginBottom: 10, boxSizing: 'border-box', minHeight: 48, outline: 'none', background: '#fafbfc', transition: 'border-color 0.2s, box-shadow 0.2s, background 0.2s' }} />
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button type="button" onClick={() => handleApplicantCounterSubmit(viewingJob._id, viewingJob.myApplication?._id)} disabled={counterSubmittingJobId === viewingJob._id} style={{
                          flex: 1, padding: '10px', borderRadius: 10, border: 'none', fontSize: 12, fontWeight: 700, cursor: counterSubmittingJobId === viewingJob._id ? 'not-allowed' : 'pointer',
                          background: 'linear-gradient(135deg, #6366f1, #4f46e5)', color: 'white', minHeight: 40, opacity: counterSubmittingJobId === viewingJob._id ? 0.6 : 1,
                        }}>{counterSubmittingJobId === viewingJob._id ? '⏳ Sending...' : 'Send Counter'}</button>
                        <button onClick={() => setApplicantCounterJob(null)} style={{
                          padding: '10px 14px', borderRadius: 10, border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                          background: '#f1f5f9', color: '#475569', minHeight: 40
                        }}>Cancel</button>
                      </div>
                    </div>
                  )}
                  {/* Navigate + Doorbell for accepted only (outside Work Hub) */}
                  {viewingJob.status === 'accepted' && viewingJob.myApplication?.status === 'accepted' && (
                    <>
                      <button onClick={() => openNavigation(viewingJob.location?.lat, viewingJob.location?.lng)} style={{
                        width: '100%', padding: '12px', borderRadius: 14, border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                        background: '#dbeafe', color: '#1d4ed8', minHeight: 44
                      }}>🧭 Navigate to Job</button>

                      {(viewingJob.posterId?._id?.toString?.() !== userId && viewingJob.posterId?.toString?.() !== userId) && (
                        (viewingJob.myApplication?.pingCount || 0) >= 3 ? (
                          <div style={{
                            padding: '10px 12px', borderRadius: 12, background: '#fee2e2', color: '#991b1b',
                            fontSize: 12, fontWeight: 700, textAlign: 'center'
                          }}>
                            🚫 Max doorbell rings reached (3/3)
                          </div>
                        ) : (
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              setPingingJob(viewingJob._id);
                              try {
                                const res = await axios.post(`${API_URL}/api/jobs/${viewingJob._id}/ping`, { type: 'manual' }, {
                                  headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
                                });
                                if (res.data.impatient) {
                                  showMsg('Doorbell rung! Flagged as impatient (3 rings in under 5 min)');
                                } else {
                                  showMsg(`Doorbell rung! (${res.data.pingCount}/3)`);
                                }
                                silentRefresh(viewingJob._id);
                              } catch (err) {
                                const msg = err.response?.data?.error || 'Failed to ring doorbell';
                                showMsg(msg);
                              }
                              setPingingJob(null);
                            }}
                            disabled={pingingJob === viewingJob._id}
                            style={{
                              width: '100%', padding: '11px', borderRadius: 14, border: 'none',
                              fontSize: 13, fontWeight: 700, cursor: 'pointer',
                              background: (viewingJob.myApplication?.pingCount || 0) > 0 ? '#fef3c7' : 'linear-gradient(135deg, #f59e0b, #d97706)',
                              color: (viewingJob.myApplication?.pingCount || 0) > 0 ? '#92400e' : 'white',
                              minHeight: 44
                            }}
                          >
                            {pingingJob === viewingJob._id ? '⏳ Ringing...' : `🔔 Ring Doorbell (${viewingJob.myApplication?.pingCount || 0}/3)`}
                          </button>
                        )
                      )}
                    </>
                  )}
                </>
              )}

              {/* === COMMON ACTIONS for in_progress / pending_review === */}
              {['in_progress', 'pending_review'].includes(viewingJob.status) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

                  {/* Release Half Escrow — poster only, escrow payment */}
                  {(viewingJob.posterId?._id?.toString?.() === userId || viewingJob.posterId?.toString?.() === userId) && viewingJob.paymentMethod === 'escrow' && viewingJob.transactionId && !viewingJob.partialEscrowReleased && (
                    <button
                      type="button"
                      onClick={async () => {
                        if (!window.confirm(`Release 50% of escrow (R${Math.round((viewingJob.budget || viewingJob.negotiatedAmount || 0) * 0.5)}) to the provider now?\n\nThe remaining 50% stays secured until job completion.`)) return;
                        try {
                          const token = localStorage.getItem('token');
                          const res = await fetch(`${API_URL}/api/jobs/${viewingJob._id}/partial-release`, {
                            method: 'POST',
                            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
                            body: JSON.stringify({ percentage: 50 })
                          });
                          const data = await res.json();
                          if (res.ok) {
                            alert(`R${data.partialReleaseAmount} released to provider! Remaining escrow: R${data.remainingEscrow}`);
                            if (typeof fetchJobs === 'function') fetchJobs();
                          } else {
                            alert(data.error || 'Failed to release partial escrow');
                          }
                        } catch (err) {
                          alert('Network error: ' + err.message);
                        }
                      }}
                      style={{
                        width: '100%', padding: '12px', borderRadius: 14, border: '2px solid #22c55e',
                        fontSize: 13, fontWeight: 700, cursor: 'pointer',
                        background: 'linear-gradient(135deg, #dcfce7, #bbf7d0)', color: '#166534', minHeight: 44
                      }}
                    >
                      💰 Release 50% Escrow to Provider
                    </button>
                  )}
                  {(viewingJob.posterId?._id?.toString?.() === userId || viewingJob.posterId?.toString?.() === userId) && viewingJob.paymentMethod === 'escrow' && viewingJob.partialEscrowReleased && (
                    <div style={{ background: '#f0fdf4', borderRadius: 12, padding: 10, border: '1px solid #bbf7d0', fontSize: 12, fontWeight: 600, color: '#166534' }}>
                      ✅ 50% escrow (R{viewingJob.partialEscrowAmount || Math.round((viewingJob.budget || 0) * 0.5)}) released to provider. Remaining held until completion.
                    </div>
                  )}
                  {(viewingJob.posterId?._id?.toString?.() !== userId && viewingJob.posterId?.toString?.() !== userId) && viewingJob.paymentMethod === 'escrow' && viewingJob.partialEscrowReleased && (
                    <div style={{ background: 'linear-gradient(135deg, #eff6ff, #dbeafe)', borderRadius: 12, padding: 12, border: '1px solid #93c5fd' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#1e40af' }}>💰 50% Escrow Released to You</div>
                      <div style={{ fontSize: 12, color: '#3b82f6', marginTop: 4 }}>
                        R{viewingJob.partialEscrowAmount || Math.round((viewingJob.budget || 0) * 0.5)} has been transferred to your account. The remaining 50% will be released when the job is completed.
                      </div>
                    </div>
                  )}

                  {/* Completion + payment workflow is handled inside Work Hub only */}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: '#f8fafc', borderRadius: 16 }}>
              <div style={{
                width: 40, height: 40, borderRadius: '50%',
                background: viewingJob.posterId?.avatar ? `url(${getImageUrl(viewingJob.posterId.avatar)}) center/cover` : 'linear-gradient(135deg, #6366f1, #4f46e5)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: 'white', fontWeight: 600
              }}>{!viewingJob.posterId?.avatar && viewingJob.posterId?.name?.charAt(0).toUpperCase()}</div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#1e293b' }}>{viewingJob.posterId?.name || 'Unknown'}</div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>
                  {viewingJob.posterId?.rating > 0 ? `⭐ ${viewingJob.posterId.rating.toFixed(1)} • ` : ''}
                  Posted {new Date(viewingJob.createdAt).toLocaleDateString()}
                </div>
              </div>
            </div>
            </div>


          </div>
        </div>
      )}

      {workHubOpen && viewingJob && ['in_progress', 'pending_review', 'pending_payment', 'completed'].includes(viewingJob.status) && (
        <div style={{ position: 'fixed', inset: 0, background: 'linear-gradient(180deg, #eff6ff 0%, #f8fafc 40%, #f8fafc 100%)', zIndex: 10020, display: 'flex', flexDirection: 'column' }}>
          <div style={{ background: 'white', borderBottom: '1px solid #dbeafe', padding: isMobile ? '12px 14px' : '14px 18px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={() => {
              setWorkHubOpen(false);
              setViewingJob(null);
              navigate('/jobs', { replace: true });
            }} style={{ width: 38, height: 38, borderRadius: 999, border: 'none', background: '#eff6ff', color: '#1d4ed8', fontSize: 20, cursor: 'pointer' }}>←</button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#1e3a8a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Work Hub</div>
              <div style={{ fontSize: 11, color: '#1d4ed8' }}>{viewingJob.title}</div>
            </div>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#0f172a', background: '#e0e7ff', borderRadius: 10, padding: '5px 8px' }}>{viewingJob.status}</div>
          </div>

          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '10px 12px', background: '#f8fbff', borderBottom: '1px solid #e2e8f0' }}>
            {workHubTabs.map(([key, label]) => (
              <button key={key} onClick={() => setWorkHubTab(key)} style={{ border: 'none', borderRadius: 999, padding: '8px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', background: workHubTab === key ? '#1d4ed8' : '#e2e8f0', color: workHubTab === key ? 'white' : '#334155' }}>{label}</button>
            ))}
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '12px 12px 130px' : '16px 18px 130px' }}>
            {workHubTab === 'overview' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 14, padding: 12 }}><div style={{ fontSize: 10, color: '#64748b', fontWeight: 700 }}>SESSION TIME</div><div style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', marginTop: 4 }}>{viewingJob.startedAt ? formatElapsed(((viewingJob.paymentConfirmedAt || viewingJob.completedAt) ? new Date(viewingJob.paymentConfirmedAt || viewingJob.completedAt).getTime() : Date.now()) - new Date(viewingJob.startedAt).getTime()) : 'Not started'}</div></div>
                <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 14, padding: 12 }}><div style={{ fontSize: 10, color: '#64748b', fontWeight: 700 }}>LOCATION</div><div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginTop: 4 }}>{viewingJob.location?.lat ? `${viewingJob.location.lat.toFixed(4)}, ${viewingJob.location.lng.toFixed(4)}` : 'Not set'}</div></div>
                {(viewingJob.status === 'pending_review' || viewingJob.status === 'pending_payment' || viewingJob.status === 'completed') && (
                  <div style={{ gridColumn: '1 / -1', background: 'white', border: '1px solid #c7d2fe', borderRadius: 14, padding: 12 }}>
                    <div style={{ fontSize: 10, color: '#3730a3', fontWeight: 800, textTransform: 'uppercase' }}>Workflow status</div>
                    {viewingJob.status === 'pending_review' && (
                      <>
                        <div style={{ fontSize: 13, fontWeight: 800, color: '#4338ca', marginTop: 6 }}>⏳ Waiting for the other party to confirm completion</div>
                        {viewingJob.completionRequest?.status === 'pending' && viewingJob.completionRequest.initiatedBy?.toString?.() !== userId && (
                          <button onClick={() => openConfirmCompletion(viewingJob)} style={{ marginTop: 8, width: '100%', padding: '10px 12px', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, #22c55e, #16a34a)', color: 'white', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>✅ Confirm Completion</button>
                        )}
                      </>
                    )}
                    {viewingJob.status === 'pending_payment' && (
                      <>
                        <div style={{ fontSize: 13, fontWeight: 800, color: '#92400e', marginTop: 6 }}>💳 Waiting for payment confirmation</div>
                        <button onClick={() => setPaymentHandshakeJob(viewingJob)} style={{ marginTop: 8, width: '100%', padding: '10px 12px', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)', color: 'white', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>📱 Open Payment QR</button>
                      </>
                    )}
                    {viewingJob.status === 'completed' && (
                      <div style={{ fontSize: 13, fontWeight: 800, color: '#166534', marginTop: 6 }}>✅ Job completed and confirmed</div>
                    )}
                  </div>
                )}
                <div style={{ gridColumn: '1 / -1', background: 'white', border: '1px solid #fde68a', borderRadius: 14, padding: 12 }}>
                  <div style={{ fontSize: 10, color: '#92400e', fontWeight: 700 }}>DOORBELL / ASSISTANCE STATUS</div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#78350f', marginTop: 4 }}>
                    {viewingJobMyApp?.pingCount > 0 ? `Doorbell rung ${viewingJobMyApp.pingCount}/3 times` : 'No doorbell pings sent yet'}
                  </div>
                  {!!viewingJobMyApp?.lastPingAt && (
                    <div style={{ fontSize: 11, color: '#92400e', marginTop: 4 }}>
                      Last ping: {new Date(viewingJobMyApp.lastPingAt).toLocaleString()}
                    </div>
                  )}
                </div>
              </div>
            )}

            {workHubTab === 'issues' && (
              <div style={{ background: 'white', border: '1px solid #fecaca', borderRadius: 14, padding: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#991b1b', marginBottom: 8 }}>Issue management</div>
                {reportingIssueJob === viewingJob._id ? (
                  <div style={{ background: '#fef2f2', borderRadius: 12, padding: 10, border: '1px solid #fca5a5' }}>
                    <textarea
                      value={issueNote}
                      onChange={e => setIssueNote(e.target.value)}
                      placeholder="Describe the issue..."
                      rows={3}
                      style={{ width: '100%', padding: 10, borderRadius: 10, border: '1px solid #fca5a5', fontSize: 13, resize: 'vertical', boxSizing: 'border-box', marginBottom: 8 }}
                    />
                    <PhotoUploadFlow label="Add Photos" onChange={setIssuePhotos} />
                    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                      <button type="button" onClick={() => handleReportIssue(viewingJob._id)} disabled={reportingIssue} style={{ flex: 1, padding: '10px 12px', borderRadius: 10, border: 'none', fontSize: 12, fontWeight: 700, cursor: reportingIssue ? 'not-allowed' : 'pointer', background: '#ef4444', color: 'white', opacity: reportingIssue ? 0.6 : 1 }}>
                        {reportingIssue ? '⏳ Sending...' : '📤 Send Report'}
                      </button>
                      <button type="button" onClick={() => { setReportingIssueJob(null); setIssueNote(''); setIssuePhotos([]); }} style={{ padding: '10px 12px', borderRadius: 10, border: 'none', background: '#f1f5f9', color: '#475569', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => { setReportingIssueJob(viewingJob._id); setIssueNote(''); setIssuePhotos([]); }} style={{ width: '100%', padding: '10px 12px', borderRadius: 12, border: '1px solid #fca5a5', background: '#fef2f2', color: '#991b1b', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Create issue report</button>
                )}

                {viewingJob.issueReports?.length > 0 ? (
                  <div style={{ marginTop: 10, background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 12, padding: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: '#9a3412', marginBottom: 8 }}>Logged issues ({viewingJob.issueReports.length})</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {viewingJob.issueReports.map((report, ri) => (
                        <div key={ri} style={{ background: 'white', border: '1px solid #fdba74', borderRadius: 10, padding: 8 }}>
                          <div style={{ fontSize: 11, color: '#7c2d12', fontWeight: 700 }}>{report.note || 'Issue reported'}</div>
                          <div style={{ fontSize: 10, color: '#9a3412', marginTop: 2 }}>{new Date(report.createdAt).toLocaleString()}</div>
                          {Array.isArray(report.photos) && report.photos.length > 0 && (
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                              {report.photos.map((p, pi) => (
                                <img
                                  key={pi}
                                  src={getImageUrl(p)}
                                  alt={`Issue evidence ${pi + 1}`}
                                  onClick={() => openGallery(report.photos, pi)}
                                  onError={(e) => { e.target.onerror = null; e.target.src = PLACEHOLDER_IMG; }}
                                  style={{ width: 64, height: 64, borderRadius: 10, objectFit: 'cover', cursor: 'pointer', border: '1px solid #fed7aa' }}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div style={{ marginTop: 10, fontSize: 11, color: '#64748b' }}>No issues logged yet.</div>
                )}
              </div>
            )}

            {workHubTab === 'proof' && (
              <div style={{ background: 'white', border: '1px solid #bbf7d0', borderRadius: 14, padding: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#166534', marginBottom: 8 }}>Proof of work</div>
                <div style={{ fontSize: 12, color: '#334155', marginBottom: 8 }}>Clearly label who uploaded what. Helper can upload BEFORE and AFTER photos here once QR start is done.</div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  {['before','during','after'].map(s => (
                    <button key={s} onClick={() => setProofStage(s)} style={{ border: 'none', borderRadius: 999, padding: '7px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer', background: proofStage === s ? '#16a34a' : '#e2e8f0', color: proofStage === s ? 'white' : '#334155' }}>{s.toUpperCase()}</button>
                  ))}
                </div>
                <input value={proofNote} onChange={(e) => setProofNote(e.target.value)} placeholder="Optional note (e.g. Kitchen before cleaning)" style={{ width: '100%', marginBottom: 8, padding: 10, borderRadius: 10, border: '1px solid #d1d5db', fontSize: 12, boxSizing: 'border-box' }} />
                <PhotoUploadFlow label="Upload Proof Photos" onChange={setProofPhotos} />
                <button onClick={() => handleUploadWorkProof(viewingJob._id)} disabled={uploadingProof} style={{ width: '100%', marginTop: 8, padding: '10px 12px', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, #16a34a, #15803d)', color: 'white', fontSize: 12, fontWeight: 800, cursor: uploadingProof ? 'not-allowed' : 'pointer', opacity: uploadingProof ? 0.6 : 1 }}>{uploadingProof ? 'Uploading...' : `Upload ${proofStage} photos`}</button>

                {Array.isArray(viewingJob.workProofPhotos) && viewingJob.workProofPhotos.length > 0 && (
                  <div style={{ marginTop: 10, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: '#1e293b', marginBottom: 8 }}>Uploaded proof timeline</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {viewingJob.workProofPhotos.map((p, i) => {
                        const uploaderId = p.uploadedBy?._id || p.uploadedBy;
                        const isPosterUploader = String(uploaderId || '') === String(viewingJob.posterId?._id || viewingJob.posterId || '');
                        const isMe = String(uploaderId || '') === String(userId);
                        const uploaderName = p.uploadedBy?.name || (isPosterUploader ? 'Job Provider' : 'Helper');
                        const uploaderLabel = isMe ? `${uploaderName} (You)` : uploaderName;
                        const roleBadge = isPosterUploader
                          ? { text: 'PROVIDER', bg: '#dbeafe', color: '#1e40af' }
                          : { text: 'HELPER', bg: '#dcfce7', color: '#166534' };
                        return (
                          <div key={`proof-${i}`} style={{ display: 'flex', gap: 8, alignItems: 'center', border: '1px solid #e2e8f0', borderRadius: 10, padding: 8, background: 'white' }}>
                            <img src={getImageUrl(p)} alt="Proof" onClick={() => openGallery(viewingJob.workProofPhotos, i)} onError={(e) => { e.target.onerror = null; e.target.src = PLACEHOLDER_IMG; }} style={{ width: 54, height: 54, borderRadius: 8, objectFit: 'cover', cursor: 'pointer' }} />
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                <span style={{ fontSize: 11, fontWeight: 800, color: '#0f172a' }}>{String(p.stage || 'during').toUpperCase()}</span>
                                <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: roleBadge.bg, color: roleBadge.color }}>{roleBadge.text}</span>
                                {isMe && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: '#f3f4f6', color: '#374151' }}>YOU</span>}
                              </div>
                              <div style={{ fontSize: 10, color: '#64748b' }}>{uploaderLabel}{p.uploadedAt ? ` • ${new Date(p.uploadedAt).toLocaleString()}` : ''}</div>
                              {!!p.note && <div style={{ fontSize: 10, color: '#334155', marginTop: 2 }}>{p.note}</div>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {workHubTab === 'complete' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ background: 'white', border: '1px solid #c7d2fe', borderRadius: 14, padding: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#3730a3', marginBottom: 8 }}>Completion controls</div>
                  {viewingJob.status === 'pending_review' && (
                    <div style={{ marginBottom: 8, padding: '10px 12px', borderRadius: 10, background: '#fff7ed', border: '1px solid #fdba74', color: '#9a3412', fontSize: 12, fontWeight: 700 }}>
                      ⏳ Waiting for the other party to confirm completion.
                    </div>
                  )}
                  {viewingJob.status === 'pending_payment' && (
                    <div style={{ marginBottom: 8, padding: '10px 12px', borderRadius: 10, background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', fontSize: 12, fontWeight: 700 }}>
                      💳 Completion confirmed. Waiting for payment confirmation.
                    </div>
                  )}
                  {viewingJob.status === 'completed' && (
                    <div style={{ marginBottom: 8, padding: '10px 12px', borderRadius: 10, background: '#ecfdf5', border: '1px solid #86efac', color: '#166534', fontSize: 12, fontWeight: 700 }}>
                      ✅ Job fully completed.
                    </div>
                  )}
                  <div style={{ fontSize: 12, color: '#334155', marginBottom: 8 }}>When job is done, submit completion and proceed to payment QR confirmation.</div>
                  <button onClick={() => handleCompleteJob(viewingJob)} disabled={!!viewingJob.completionRequest?.status || ['pending_review', 'pending_payment', 'completed'].includes(viewingJob.status)} style={{ width: '100%', padding: '10px 12px', borderRadius: 12, border: 'none', background: '#4f46e5', color: 'white', fontSize: 12, fontWeight: 800, cursor: (viewingJob.completionRequest?.status || ['pending_review', 'pending_payment', 'completed'].includes(viewingJob.status)) ? 'not-allowed' : 'pointer', opacity: (viewingJob.completionRequest?.status || ['pending_review', 'pending_payment', 'completed'].includes(viewingJob.status)) ? 0.6 : 1 }}>Mark done & continue</button>
                  {viewingJob.status === 'pending_payment' && (
                    <button onClick={() => setPaymentHandshakeJob(viewingJob)} style={{ marginTop: 8, width: '100%', padding: '10px 12px', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)', color: 'white', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>📱 Open Payment QR</button>
                  )}
                  {viewingJob.status === 'pending_review' && viewingJob.completionRequest?.status === 'pending' && viewingJob.completionRequest.initiatedBy?.toString?.() !== userId && (
                    <button onClick={() => openConfirmCompletion(viewingJob)} style={{ marginTop: 8, width: '100%', padding: '10px 12px', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, #22c55e, #16a34a)', color: 'white', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>✅ Confirm Completion</button>
                  )}

                  {(viewingJob.posterId?._id?.toString?.() === userId || viewingJob.posterId?.toString?.() === userId) && ['accepted','in_progress','pending_review','pending_payment'].includes(viewingJob.status) && (
                    <div style={{ marginTop: 10, background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: 12, padding: 10 }}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: '#9f1239', marginBottom: 6 }}>Stop Job (Provider can’t continue)</div>
                      <textarea value={stopReason} onChange={(e) => setStopReason(e.target.value)} placeholder="Reason (e.g. helper sick / unsafe / cannot continue)" rows={3} style={{ width: '100%', boxSizing: 'border-box', padding: 9, borderRadius: 10, border: '1px solid #fda4af', fontSize: 12, marginBottom: 8 }} />
                      <PhotoUploadFlow label="Evidence photos" onChange={setStopPhotos} />
                      <button onClick={() => handleStopJobWithEvidence(viewingJob._id)} disabled={stoppingJob} style={{ marginTop: 8, width: '100%', padding: '10px 12px', borderRadius: 10, border: 'none', background: '#e11d48', color: 'white', fontSize: 12, fontWeight: 800, cursor: stoppingJob ? 'not-allowed' : 'pointer', opacity: stoppingJob ? 0.65 : 1 }}>{stoppingJob ? 'Stopping...' : '🛑 Stop Job with Evidence'}</button>
                    </div>
                  )}
                </div>

                {(viewingJob.images?.length > 0 || viewingJob.workProofPhotos?.length > 0) && (
                  <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 14, padding: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: '#1e293b', marginBottom: 8 }}>📸 Before & After</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {(viewingJob.images || []).map((img, i) => (
                        <div key={`before-${i}`} style={{ position: 'relative' }}>
                          <img src={getImageUrl(img)} alt="Before" onClick={() => openGallery(viewingJob.images, i)} onError={(e) => { e.target.onerror = null; e.target.src = PLACEHOLDER_IMG; }} style={{ width: 72, height: 72, borderRadius: 10, objectFit: 'cover', cursor: 'pointer', border: '1px solid #fecaca' }} />
                          <span style={{ position: 'absolute', bottom: 2, left: 2, fontSize: 8, fontWeight: 700, padding: '1px 4px', borderRadius: 3, background: '#fee2e2', color: '#991b1b' }}>BEFORE</span>
                        </div>
                      ))}
                      {(viewingJob.workProofPhotos || []).map((img, i) => {
                        const uploaderId = img.uploadedBy?._id || img.uploadedBy;
                        const isPosterUploader = String(uploaderId || '') === String(viewingJob.posterId?._id || viewingJob.posterId || '');
                        const isMe = String(uploaderId || '') === String(userId);
                        const uploaderName = img.uploadedBy?.name || (isPosterUploader ? 'Provider' : 'Helper');
                        const label = isMe ? `${uploaderName} (You)` : uploaderName;
                        const stageLabel = String(img.stage || 'after').toUpperCase();
                        const stageColor = img.stage === 'before' ? { bg: '#fee2e2', color: '#991b1b' } : img.stage === 'during' ? { bg: '#fef3c7', color: '#92400e' } : { bg: '#dcfce7', color: '#166534' };
                        return (
                          <div key={`after-${i}`} style={{ position: 'relative' }}>
                            <img src={getImageUrl(img)} alt={stageLabel} onClick={() => openGallery(viewingJob.workProofPhotos, i)} onError={(e) => { e.target.onerror = null; e.target.src = PLACEHOLDER_IMG; }} style={{ width: 72, height: 72, borderRadius: 10, objectFit: 'cover', cursor: 'pointer', border: '1px solid #bbf7d0' }} />
                            <span style={{ position: 'absolute', bottom: 2, left: 2, fontSize: 8, fontWeight: 700, padding: '1px 4px', borderRadius: 3, background: stageColor.bg, color: stageColor.color }}>{stageLabel}</span>
                            <span style={{ position: 'absolute', top: 2, right: 2, fontSize: 7, fontWeight: 700, padding: '1px 3px', borderRadius: 3, background: 'rgba(0,0,0,0.6)', color: 'white' }}>{label}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 10021, background: 'white', borderTop: '1px solid #dbeafe', padding: isMobile ? '10px 12px' : '12px 16px', display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(2, 1fr)', gap: 8 }}>
            {!['pending_payment', 'completed'].includes(viewingJob.status) && (
              <button onClick={() => { setReportingIssueJob(viewingJob._id); setIssueNote(''); setIssuePhotos([]); setWorkHubTab('issues'); }} style={{ padding: '11px 12px', borderRadius: 12, border: '1px solid #fca5a5', background: '#fef2f2', color: '#991b1b', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>Report Issue</button>
            )}
            {['accepted', 'in_progress'].includes(viewingJob.status) ? (
              <button onClick={() => handleCompleteJob(viewingJob)} style={{ padding: '11px 12px', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, #16a34a, #15803d)', color: 'white', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>Mark Done + Photos (Rating Required)</button>
            ) : (
              <button onClick={() => setWorkHubTab('complete')} style={{ padding: '11px 12px', borderRadius: 12, border: '1px solid #c7d2fe', background: '#eef2ff', color: '#3730a3', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>View Completion</button>
            )}
          </div>
        </div>
      )}

      {/* Complete Job Workflow Modal */}
      {completingJob && (
        <JobCompleteWorkflow
          job={completingJob}
          userId={userId}
          onClose={() => setCompletingJob(null)}
          onCompleted={async () => {
            const completedJobId = completingJob?._id;
            setCompletingJob(null);
            setCompletionPhotos([]);
            await fetchMyJobs();
            await fetchMyApplications();
            await fetchJobs();
            if (completedJobId) {
              try {
                const res = await axios.get(`${API_URL}/api/jobs/${completedJobId}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
                if (res.data) {
                  setViewingJob(res.data);
                  if (['pending_review', 'pending_payment', 'completed'].includes(res.data.status)) {
                    setWorkHubOpen(true);
                    navigate(`/jobs/workhub/${completedJobId}`, { replace: true });
                    autoRouteWorkHub(res.data, 'completion_submitted');
                  }
                }
              } catch (e) {
                // Non-blocking fallback; list refresh already ran
              }
            }
          }}
        />
      )}

      {/* Confirm Completion Modal */}
      {confirmingJob && (
        <div style={{ ...modalOverlayStyle, alignItems: isMobile ? 'flex-end' : 'center', padding: isMobile ? 0 : 'clamp(12px, 3vw, 20px)', paddingBottom: isMobile ? 'env(safe-area-inset-bottom)' : 'clamp(12px, 3vw, 20px)' }} onClick={() => setConfirmingJob(null)}>
          <div style={{ ...modalContentStyle(440), width: isMobile ? '100%' : '92vw', maxWidth: isMobile ? '100%' : 440, borderRadius: isMobile ? '24px 24px 0 0' : 28, marginTop: isMobile ? 'auto' : undefined }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
              <div style={{ width: 48, height: 48, borderRadius: 16, background: 'linear-gradient(135deg, #22c55e, #16a34a)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>✅</div>
              <div>
                <h3 style={{ margin: 0, fontSize: 'clamp(18px, 4vw, 20px)', fontWeight: 800, color: '#1e293b' }}>Confirm Job Completion</h3>
                <p style={{ margin: '2px 0 0', fontSize: 13, color: '#64748b' }}>{confirmingJob.title}</p>
              </div>
            </div>

            <div style={{ background: '#dbeafe', borderRadius: 14, padding: 12, marginBottom: 16, border: '1px solid #93c5fd' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#1d4ed8', marginBottom: 4 }}>📸 Confirmation Required</div>
              <div style={{ fontSize: 12, color: '#1e40af' }}>Upload your own photos and make sure you have rated the other party before confirming.</div>
            </div>

            {/* Show initiator's completion photos */}
            {confirmingJob.completionRequest?.initiatorPhotos?.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 8 }}>📸 Their Completion Photos</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {confirmingJob.completionRequest.initiatorPhotos.map((p, i) => (
                    <img key={i} src={getImageUrl(p)} alt="" onClick={() => openGallery(confirmingJob.completionRequest.initiatorPhotos, i)} onError={(e) => { e.target.onerror = null; e.target.src = PLACEHOLDER_IMG; }} style={{ width: 72, height: 72, borderRadius: 12, objectFit: 'cover', cursor: 'pointer', border: '2px solid #e2e8f0' }} />
                  ))}
                </div>
              </div>
            )}

            {/* Rating status */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              <span style={{ background: confirmingJob.posterReviewed ? '#dcfce7' : '#fef3c7', color: confirmingJob.posterReviewed ? '#166534' : '#b45309', padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700 }}>
                {confirmingJob.posterReviewed ? '✅' : '⏳'} Poster rated
              </span>
              <span style={{ background: confirmingJob.providerReviewed ? '#dcfce7' : '#fef3c7', color: confirmingJob.providerReviewed ? '#166534' : '#b45309', padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700 }}>
                {confirmingJob.providerReviewed ? '✅' : '⏳'} Helper rated
              </span>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#1e293b', marginBottom: 6 }}>Your Photos *</label>
              <PhotoUploadFlow label="Your Photos" onChange={setConfirmPhotos} />
            </div>

            {/* Inline rating form */}
            {(() => {
              const confIsPoster = confirmingJob.posterId?._id?.toString?.() === userId || confirmingJob.posterId?.toString?.() === userId;
              const confAlreadyReviewed = confIsPoster ? confirmingJob.posterReviewed : confirmingJob.providerReviewed;
              const confRevieweeName = confIsPoster ? 'Helper' : 'Neighbour';
              const confOverallRating = Math.round(Object.values(confirmCategories).reduce((a, b) => a + b, 0) / 4);
              const confLowest = Math.min(...Object.values(confirmCategories));
              const confNeedsConstructive = confLowest <= 2;
              const confIsExcellent = Object.values(confirmCategories).every(v => v >= 4);

              if (confAlreadyReviewed) {
                return (
                  <div style={{ background: '#dcfce7', borderRadius: 12, padding: 10, marginBottom: 16, fontSize: 12, color: '#166534', fontWeight: 600 }}>
                    ✅ You have already rated this job.
                  </div>
                );
              }

              return (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', marginBottom: 8 }}>⭐ Rate {confRevieweeName}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {[
                      { key: 'punctuality', label: '⏰ Punctuality', hint: 'Did they show up on time?' },
                      { key: 'quality', label: '🔧 Quality of Work', hint: 'Was the work done well?' },
                      { key: 'communication', label: '💬 Communication', hint: 'Were they clear and responsive?' },
                      { key: 'respect', label: '🤝 Respect', hint: 'Were they kind and professional?' }
                    ].map(({ key, label, hint }) => (
                      <div key={key} style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#374151' }}>{label}</div>
                        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>{hint}</div>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                          {[1, 2, 3, 4, 5].map(s => (
                            <button key={s} onClick={() => setConfirmCategories(prev => ({ ...prev, [key]: s }))} style={{
                              fontSize: 24, background: 'none', border: 'none', cursor: 'pointer',
                              opacity: s <= confirmCategories[key] ? 1 : 0.25
                            }}>{s <= confirmCategories[key] ? '⭐' : '☆'}</button>
                          ))}
                        </div>
                      </div>
                    ))}
                    <div style={{ background: '#f0fdf4', borderRadius: 14, padding: 12, textAlign: 'center' }}>
                      <div style={{ fontSize: 13, color: '#166534', fontWeight: 600 }}>Overall: {confOverallRating}/5</div>
                      <div style={{ fontSize: 12, color: '#22c55e', marginTop: 2 }}>
                        {confIsExcellent ? '🎉 Outstanding! Help them celebrate.' :
                         confNeedsConstructive ? '💡 A quick tip can help them improve.' :
                         '✨ Great experience! Share what stood out.'}
                      </div>
                    </div>
                    <div>
                      <label style={{ fontSize: 13, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 4 }}>
                        {confNeedsConstructive ? '💚 Help them grow — what could be better?' : '✨ What did they do well? (optional)'}
                      </label>
                      <textarea value={confirmComment} onChange={(e) => setConfirmComment(e.target.value)} rows={3}
                        placeholder={confNeedsConstructive
                          ? 'Be kind and specific. Instead of "bad quality", try "The repair worked but needed a second visit for tightening."'
                          : 'Share a specific moment or detail that made this a great experience...'}
                        style={{
                          width: '100%', padding: 12, borderRadius: 14,
                          border: confNeedsConstructive && confirmComment.trim().length < 10 ? '2px solid #ef4444' : '2px solid #e2e8f0',
                          fontSize: 13, resize: 'vertical', outline: 'none', fontFamily: 'inherit'
                        }}
                      />
                      {confNeedsConstructive && (
                        <div style={{ fontSize: 11, color: '#ef4444', marginTop: 2 }}>
                          Required for lower ratings — min 10 characters ({confirmComment.trim().length}/10)
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}

            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" onClick={handleConfirmCompletionSubmit} disabled={confirmPhotos.length === 0 || confirmingCompletion} style={{
                flex: 1, padding: 'clamp(12px, 3vw, 14px)', borderRadius: 16, border: 'none', fontSize: 14, fontWeight: 800, cursor: confirmingCompletion ? 'not-allowed' : 'pointer',
                background: 'linear-gradient(135deg, #22c55e, #16a34a)', color: 'white',
                boxShadow: '0 4px 16px rgba(34,197,94,0.3)', opacity: (confirmPhotos.length === 0 || confirmingCompletion) ? 0.5 : 1, minHeight: 48
              }}>{confirmingCompletion ? '⏳ Confirming...' : '✅ Confirm Completion'}</button>
            </div>


          </div>
        </div>
      )}

      {workflowAlert && (
        <div
          style={{ ...modalOverlayStyle, alignItems: 'center', padding: isMobile ? '18px 12px' : '24px' }}
          onClick={() => setWorkflowAlert(null)}
        >
          <div
            style={{
              ...modalContentStyle(520),
              width: isMobile ? '96vw' : '92vw',
              maxWidth: 520,
              borderRadius: 24,
              border: `2px solid ${workflowAlert.type === 'accepted' ? '#86efac' : '#fecaca'}`,
              boxShadow: workflowAlert.type === 'accepted' ? '0 16px 50px rgba(34,197,94,0.28)' : '0 16px 50px rgba(239,68,68,0.24)',
              padding: isMobile ? '18px 16px' : '22px 20px'
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <div style={{ width: 52, height: 52, borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, background: workflowAlert.type === 'accepted' ? '#dcfce7' : '#fee2e2' }}>
                {workflowAlert.type === 'accepted' ? '✅' : '❌'}
              </div>
              <div>
                <div style={{ fontSize: 20, fontWeight: 900, color: '#0f172a' }}>{workflowAlert.title}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: workflowAlert.type === 'accepted' ? '#166534' : '#991b1b' }}>
                  {workflowAlert.type === 'accepted' ? 'Step moved forward' : 'Action needed'}
                </div>
              </div>
            </div>
            <div style={{ fontSize: 14, color: '#334155', lineHeight: 1.5, marginBottom: 16 }}>{workflowAlert.body}</div>
            <button
              type="button"
              onClick={() => setWorkflowAlert(null)}
              style={{ width: '100%', minHeight: 46, borderRadius: 14, border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 800, color: 'white', background: workflowAlert.type === 'accepted' ? 'linear-gradient(135deg, #16a34a, #15803d)' : 'linear-gradient(135deg, #dc2626, #b91c1c)' }}
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {/* Photo Gallery Viewer */}
      {showGallery && galleryPhotos.length > 0 && (
        <PhotoGallery
          photos={galleryPhotos}
          onClose={() => setShowGallery(false)}
          startIndex={galleryIndex}
        />
      )}

      {qrHandshakeJob && (
        <QRHandshakeModal
          jobId={qrHandshakeJob._id}
          userId={userId}
          isPoster={qrHandshakeJob.posterId?._id?.toString?.() === userId || qrHandshakeJob.posterId?.toString?.() === userId}
          onClose={() => setQrHandshakeJob(null)}
          onScanned={handleQRScanned}
        />
      )}

      {paymentHandshakeJob && (
        <QRHandshakeModal
          jobId={paymentHandshakeJob._id}
          userId={userId}
          isPoster={paymentHandshakeJob.posterId?._id?.toString?.() === userId || paymentHandshakeJob.posterId?.toString?.() === userId}
          onClose={() => {
            setPaymentHandshakeJob(null);
            // Always refresh data when closing payment modal so user sees latest job state
            fetchMyJobs();
            fetchMyApplications();
            fetchJobs();
          }}
          onScanned={handlePaymentQRScanned}
          handshakeMode="payment"
          job={paymentHandshakeJob}
        />
      )}

      {viewingCompletionSummary && (
        <JobCompletionSummary
          job={viewingCompletionSummary}
          userId={userId}
          onClose={() => setViewingCompletionSummary(null)}
          onPhotoClick={(photos, index) => { setGalleryPhotos(photos); setGalleryIndex(index || 0); setShowGallery(true); }}
        />
      )}
    </div>
  );
}

export default JobBoard;
