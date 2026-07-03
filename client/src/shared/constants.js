// Shared constants and helpers used across JobBoard, MapView, ApplyJobModal, PostJobModal

const API_URL = process.env.REACT_APP_API_URL || '';
const BASE_URL = API_URL || (typeof window !== 'undefined' ? window.location.origin : '');

export const MAX_NEGOTIATION_ROUNDS = 3;

export const PLACEHOLDER_IMG = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200' fill='%23f1f5f9'%3E%3Crect width='200' height='200' rx='16'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%23cbd5e1' font-size='40'%3E📷%3C/text%3E%3C/svg%3E";

export const PLACEHOLDER_USER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200' fill='%23e2e8f0'%3E%3Crect width='200' height='200' rx='50%25'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%2394a3b8' font-size='40'%3E👤%3C/text%3E%3C/svg%3E";

export function getImageUrl(img) {
  if (!img) return PLACEHOLDER_IMG;
  const url = typeof img === 'string' ? img : (img.url || '');
  if (!url) return PLACEHOLDER_IMG;
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) return url;
  const cleanUrl = url.startsWith('/') ? url : '/' + url;
  return BASE_URL + cleanUrl;
}

export const categoryEmojis = {
  'House Cleaning': '🧹', 'Yard Work': '🌿', 'Car Wash': '🚗', 'Dog Walking': '🐕', 'Laundry': '🧺',
  'Braai / BBQ': '🔥', 'Haircut': '💇', 'Errands': '🛒', 'Pet Wash': '🛁', 'Shoe Cleaning': '👟',
  'Moving Help': '📦', 'Furniture Assembly': '🪑', 'Gardening': '🌱', 'Babysitting': '👶',
  'Cooking': '🍳', 'Plumbing': '🔧', 'Electrical': '⚡', 'Tech Help': '💻', 'Tutoring': '📚',
  'Other': '✨'
};

export const categoryGradients = {
  'House Cleaning': 'linear-gradient(135deg, #cffafe, #a5f3fc)', 'Yard Work': 'linear-gradient(135deg, #dcfce7, #bbf7d0)',
  'Car Wash': 'linear-gradient(135deg, #dbeafe, #bfdbfe)', 'Dog Walking': 'linear-gradient(135deg, #ffedd5, #fed7aa)',
  'Laundry': 'linear-gradient(135deg, #eef2ff, #e0e7ff)', 'Braai / BBQ': 'linear-gradient(135deg, #fef3c7, #fde68a)',
  'Haircut': 'linear-gradient(135deg, #fce7f3, #fbcfe8)', 'Errands': 'linear-gradient(135deg, #f0fdf4, #dcfce7)',
  'Pet Wash': 'linear-gradient(135deg, #ecfeff, #cffafe)', 'Shoe Cleaning': 'linear-gradient(135deg, #f5f3ff, #ede9fe)',
  'Moving Help': 'linear-gradient(135deg, #fff7ed, #ffedd5)', 'Furniture Assembly': 'linear-gradient(135deg, #f1f5f9, #e2e8f0)',
  'Gardening': 'linear-gradient(135deg, #dcfce7, #bbf7d0)', 'Babysitting': 'linear-gradient(135deg, #fef3c7, #fde68a)',
  'Cooking': 'linear-gradient(135deg, #ffedd5, #fed7aa)', 'Plumbing': 'linear-gradient(135deg, #dbeafe, #bfdbfe)',
  'Electrical': 'linear-gradient(135deg, #fef3c7, #fde68a)', 'Tech Help': 'linear-gradient(135deg, #ede9fe, #ddd6fe)',
  'Tutoring': 'linear-gradient(135deg, #eef2ff, #e0e7ff)', 'Other': 'linear-gradient(135deg, #f1f5f9, #e2e8f0)'
};

// Suggested price ranges to help users price everyday tasks
export const categoryPriceHints = {
  'House Cleaning': { min: 50, max: 800, avg: 200, unit: 'per session' },
  'Yard Work': { min: 80, max: 600, avg: 250, unit: 'per job' },
  'Car Wash': { min: 30, max: 300, avg: 100, unit: 'per wash' },
  'Dog Walking': { min: 20, max: 150, avg: 60, unit: 'per walk' },
  'Laundry': { min: 30, max: 200, avg: 80, unit: 'per load' },
  'Braai / BBQ': { min: 100, max: 800, avg: 300, unit: 'per event' },
  'Haircut': { min: 30, max: 400, avg: 100, unit: 'per cut' },
  'Errands': { min: 20, max: 300, avg: 80, unit: 'per trip' },
  'Pet Wash': { min: 40, max: 250, avg: 100, unit: 'per wash' },
  'Shoe Cleaning': { min: 15, max: 150, avg: 50, unit: 'per pair' },
  'Moving Help': { min: 100, max: 2000, avg: 500, unit: 'per move' },
  'Furniture Assembly': { min: 50, max: 500, avg: 150, unit: 'per item' },
  'Gardening': { min: 50, max: 600, avg: 200, unit: 'per session' },
  'Babysitting': { min: 50, max: 500, avg: 150, unit: 'per hour' },
  'Cooking': { min: 50, max: 600, avg: 200, unit: 'per meal' },
  'Plumbing': { min: 100, max: 3000, avg: 500, unit: 'per job' },
  'Electrical': { min: 100, max: 3000, avg: 500, unit: 'per job' },
  'Tech Help': { min: 50, max: 1500, avg: 300, unit: 'per job' },
  'Tutoring': { min: 50, max: 500, avg: 150, unit: 'per hour' },
  'Other': { min: 10, max: 100000, avg: 100, unit: '' }
};

export const jobCategories = [
  'House Cleaning', 'Yard Work', 'Car Wash', 'Dog Walking', 'Laundry',
  'Braai / BBQ', 'Haircut', 'Errands', 'Pet Wash', 'Shoe Cleaning',
  'Moving Help', 'Furniture Assembly', 'Gardening', 'Babysitting',
  'Cooking', 'Plumbing', 'Electrical', 'Tech Help', 'Tutoring', 'Other'
];

export function openNavigation(lat, lng, label = 'Destination') {
  if (!lat || !lng) return;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const url = isIOS
    ? `https://maps.apple.com/?daddr=${lat},${lng}&q=${encodeURIComponent(label)}`
    : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  window.open(url, '_blank');
}

export function statusBadge(status) {
  const map = {
    open: { bg: '#dbeafe', color: '#1d4ed8', label: 'Open' },
    negotiating: { bg: '#fef3c7', color: '#b45309', label: 'Negotiating' },
    accepted: { bg: '#dcfce7', color: '#166534', label: 'Accepted' },
    in_progress: { bg: '#e0e7ff', color: '#4338ca', label: 'In Progress' },
    pending_review: { bg: '#f3e8ff', color: '#7e22ce', label: 'Awaiting Confirmation' },
    pending_payment: { bg: '#fef3c7', color: '#92400e', label: 'Pending Payment' },
    completed: { bg: '#d1fae5', color: '#065f46', label: 'Completed' },
    cancelled: { bg: '#fee2e2', color: '#991b1b', label: 'Cancelled' },
    pending: { bg: '#dbeafe', color: '#1d4ed8', label: 'Pending' },
    rejected: { bg: '#fee2e2', color: '#991b1b', label: 'Rejected' },
    withdrawn: { bg: '#f3f4f6', color: '#6b7280', label: 'Withdrawn' }
  };
  const s = map[status] || map.open;
  return (
    <span style={{ background: s.bg, color: s.color, padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700 }}>{s.label}</span>
  );
}

// Shared responsive modal styles for mobile-first design
export const modalOverlayStyle = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.5)',
  backdropFilter: 'blur(4px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 10040,
  padding: 'clamp(12px, 3vw, 20px)'
};

export const modalContentStyle = (maxWidth = 480) => ({
  background: 'white',
  borderRadius: 28,
  padding: 'clamp(16px, 4vw, 28px)',
  width: '92vw',
  maxWidth,
  maxHeight: '92vh',
  overflowY: 'auto',
  boxShadow: '0 20px 60px rgba(0,0,0,0.2)'
});
