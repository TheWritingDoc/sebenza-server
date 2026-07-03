import React from 'react';

// Lightweight, dependency-free icon set (lucide-style inline SVGs).
// Reconstructed to match the props used across the app:
//   <Icon size={24} strokeWidth={2} color="#4f46e5" className="..." style={{}} />
// stroke defaults to currentColor so icons inherit text color unless `color` is passed.

function makeIcon(displayName, children) {
  const Icon = ({ size = 24, color = 'currentColor', strokeWidth = 2, className, style, ...rest }) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
  Icon.displayName = displayName;
  return Icon;
}

export const Home = makeIcon('Home', (
  <>
    <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </>
));

export const Briefcase = makeIcon('Briefcase', (
  <>
    <rect width="20" height="14" x="2" y="7" rx="2" ry="2" />
    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
  </>
));

export const ClipboardList = makeIcon('ClipboardList', (
  <>
    <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    <path d="M12 11h4" />
    <path d="M12 16h4" />
    <path d="M8 11h.01" />
    <path d="M8 16h.01" />
  </>
));

export const UserCircle = makeIcon('UserCircle', (
  <>
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="10" r="3" />
    <path d="M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662" />
  </>
));

export const Plus = makeIcon('Plus', (
  <>
    <path d="M5 12h14" />
    <path d="M12 5v14" />
  </>
));

export const Bell = makeIcon('Bell', (
  <>
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </>
));

export const X = makeIcon('X', (
  <>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </>
));

export const Trash2 = makeIcon('Trash2', (
  <>
    <path d="M3 6h18" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" x2="10" y1="11" y2="17" />
    <line x1="14" x2="14" y1="11" y2="17" />
  </>
));

export const CheckCircle2 = makeIcon('CheckCircle2', (
  <>
    <path d="M21.801 10A10 10 0 1 1 17 3.335" />
    <path d="m9 11 3 3L22 4" />
  </>
));

export const Handshake = makeIcon('Handshake', (
  <>
    <path d="m11 17 2 2a1 1 0 1 0 3-3" />
    <path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4" />
    <path d="m21 3 1 11h-2" />
    <path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3" />
    <path d="M3 4h8" />
  </>
));

export const Eye = makeIcon('Eye', (
  <>
    <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
    <circle cx="12" cy="12" r="3" />
  </>
));

export const Users = makeIcon('Users', (
  <>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </>
));

export const Banknote = makeIcon('Banknote', (
  <>
    <rect width="20" height="12" x="2" y="6" rx="2" />
    <circle cx="12" cy="12" r="2" />
    <path d="M6 12h.01M18 12h.01" />
  </>
));

export const Clock = makeIcon('Clock', (
  <>
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </>
));

export const MessageCircle = makeIcon('MessageCircle', (
  <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
));

export const ArrowRight = makeIcon('ArrowRight', (
  <>
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </>
));

export const Search = makeIcon('Search', (
  <>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </>
));

export const Share2 = makeIcon('Share2', (
  <>
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <line x1="8.59" x2="15.42" y1="13.51" y2="17.49" />
    <line x1="15.41" x2="8.59" y1="6.51" y2="10.49" />
  </>
));

export const Smartphone = makeIcon('Smartphone', (
  <>
    <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
    <path d="M12 18h.01" />
  </>
));

export const Star = makeIcon('Star', (
  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
));

export const UserPlus = makeIcon('UserPlus', (
  <>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <line x1="19" x2="19" y1="8" y2="14" />
    <line x1="22" x2="16" y1="11" y2="11" />
  </>
));

// --- Non-icon helpers imported by Home.js (currently unused in its JSX). ---
// Kept as safe, valid exports so the module resolves cleanly.

export const HOME_FEATURE_ICONS = {};

export function IconBox({ children, size = 48, bg = '#eef2ff', radius = 14, style }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: radius,
        background: bg,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

export function FeatureIcon({ icon: IconComp, size = 24, color = '#6366f1', ...rest }) {
  if (!IconComp) return null;
  return <IconComp size={size} color={color} {...rest} />;
}

export default {
  Home, Briefcase, ClipboardList, UserCircle, Plus, Bell, X, Trash2,
  CheckCircle2, Handshake, Eye, Users, Banknote, Clock, MessageCircle,
  ArrowRight, Search, Share2, Smartphone, Star, UserPlus,
  HOME_FEATURE_ICONS, IconBox, FeatureIcon,
};
