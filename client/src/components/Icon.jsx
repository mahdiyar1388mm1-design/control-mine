import React from 'react';

// Pink line icons used across the site instead of colorful emoji stickers.
const PATHS = {
  search: (<><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>),
  wallet: (<><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18" /><path d="M16 14h2" /></>),
  landmark: (<><path d="M3 10l9-6 9 6" /><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8" /><path d="M3 20h18" /></>),
  calculator: (<><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 7h8" /><path d="M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01" /></>),
  tools: (<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z" />),
  cart: (<><circle cx="9" cy="20" r="1.5" /><circle cx="17" cy="20" r="1.5" /><path d="M3 4h2l2.4 11h11l2-8H6.2" /></>),
  user: (<><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>),
  users: (<><circle cx="9" cy="8" r="4" /><path d="M2 21a7 7 0 0 1 14 0" /><path d="M16 4a4 4 0 0 1 0 8" /><path d="M22 21a7 7 0 0 0-4-6.3" /></>),
  bag: (<><path d="M5 8h14l-1 12H6z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></>),
  headset: (<><path d="M4 14v-2a8 8 0 0 1 16 0v2" /><rect x="3" y="14" width="4" height="6" rx="1.5" /><rect x="17" y="14" width="4" height="6" rx="1.5" /></>),
  clock: (<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
  inbox: (<><path d="M3 13l3-8h12l3 8v6H3z" /><path d="M3 13h5l1 2h6l1-2h5" /></>),
  alert: (<><path d="M12 3l10 18H2z" /><path d="M12 10v5" /><path d="M12 18h.01" /></>),
  wifiOff: (<><path d="M2 2l20 20" /><path d="M8.5 16.5a5 5 0 0 1 7 0" /><path d="M5 12.5a10 10 0 0 1 5-2.7" /><path d="M12 20h.01" /></>),
  lock: (<><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>),
  ban: (<><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6l12.8 12.8" /></>),
  refresh: (<><path d="M20 11a8 8 0 0 0-14.9-3.5" /><path d="M4 4v4h4" /><path d="M4 13a8 8 0 0 0 14.9 3.5" /><path d="M20 20v-4h-4" /></>),
  image: (<><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M21 17l-5-5-9 8" /></>),
  package: (<><path d="M3 7l9-4 9 4v10l-9 4-9-4z" /><path d="M3 7l9 4 9-4" /><path d="M12 11v10" /></>),
  truck: (<><path d="M2 6h12v10H2z" /><path d="M14 10h4l3 3v3h-7" /><circle cx="6" cy="18" r="2" /><circle cx="17" cy="18" r="2" /></>),
  edit: (<path d="M4 20h4L19 9l-4-4L4 16z" />),
  send: (<><path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4z" /></>),
  folder: (<path d="M3 6h6l2 2h10v11H3z" />),
  settings: (<><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" /></>),
  message: (<path d="M4 4h16v12H8l-4 4z" />),
  help: (<><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5V14" /><path d="M12 17h.01" /></>),
  plus: (<path d="M12 5v14M5 12h14" />),
  archive: (<><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v12h14V8" /><path d="M10 12h4" /></>),
  check: (<path d="M5 12l5 5L20 7" />),
  x: (<path d="M6 6l12 12M18 6L6 18" />),
  undo: (<><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></>),
  shield: (<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />),
  shieldCheck: (<><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M9 12l2 2 4-4" /></>),
  phone: (<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />),
  mail: (<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></>),
  creditCard: (<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18" /><path d="M7 15h3" /></>),
  hash: (<path d="M5 9h14M5 15h14M10 3L8 21M16 3l-2 18" />),
  mapPin: (<><path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z" /><circle cx="12" cy="9" r="2.5" /></>),
  bulb: (<><path d="M9 18h6" /><path d="M10 21h4" /><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" /></>),
  coin: (<><circle cx="12" cy="12" r="9" /><path d="M12 6.5v11" /><path d="M15 9.5h-4a1.5 1.5 0 0 0 0 3h2a1.5 1.5 0 0 1 0 3H9" /></>),
  dot: (<circle cx="12" cy="12" r="3" />),
  // --- account & staff surfaces (replaces emoji that the scrubber stripped) ---
  home: (<><path d="M3 10l9-7 9 7" /><path d="M5 9v11h14V9" /><path d="M10 20v-6h4v6" /></>),
  address: (<><path d="M4 20V9l8-5 8 5v11z" /><path d="M9 20v-6h6v6" /><path d="M4 9h16" /></>),
  sku: (<><path d="M4 7l8-3 8 3v10l-8 3-8-3z" /><path d="M4 7l8 3 8-3" /><path d="M12 10v10" /><path d="M8 12.5v3" /></>),
  bell: (<><path d="M18 16V11a6 6 0 0 0-12 0v5l-2 3h16z" /><path d="M10 19a2 2 0 0 0 4 0" /></>),
  store: (<><path d="M3 9l2-5h14l2 5" /><path d="M4 9v11h16V9" /><path d="M9 20v-6h6v6" /><path d="M3 9h18" /></>),
  logout: (<><path d="M15 4h4v16h-4" /><path d="M10 8l-4 4 4 4" /><path d="M6 12h10" /></>),
  arrowLeft: (<><path d="M19 12H5" /><path d="M11 6l-6 6 6 6" /></>),
  arrowRight: (<><path d="M5 12h14" /><path d="M13 6l6 6-6 6" /></>),
  bellRing: (<><path d="M18 16V11a6 6 0 0 0-11.4-2.6" /><path d="M6 11v5l-2 3h14l-2-3" /><path d="M10 19a2 2 0 0 0 4 0" /><path d="M20 5l1.5-1.5M21 9h2M18.5 2.5L17 4" /></>),
  cartPlus: (<><circle cx="9" cy="20" r="1.5" /><circle cx="17" cy="20" r="1.5" /><path d="M3 4h2l2.4 11h11l2-8H6.2" /><path d="M13 8h4M15 6v4" /></>),
  tag: (<><path d="M20 12.5L12.5 20 4 11.5V4h7.5z" /><circle cx="8.5" cy="8.5" r="1.5" /></>),
  users2: (<><circle cx="8" cy="9" r="3.2" /><path d="M2.5 20a5.5 5.5 0 0 1 11 0" /><circle cx="17" cy="8" r="2.6" /><path d="M14.5 20a5 5 0 0 1 7-4.6" /></>),
  database: (<><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6" /><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></>),
  chart: (<><path d="M4 20V6" /><path d="M4 20h16" /><rect x="7" y="12" width="3" height="5" /><rect x="12" y="9" width="3" height="8" /><rect x="17" y="5" width="3" height="12" /></>),
  scale: (<><path d="M12 4v16" /><path d="M6 20h12" /><path d="M4 8h16" /><path d="M4 8l-2 5a3 3 0 0 0 4 0z" /><path d="M20 8l-2 5a3 3 0 0 0 4 0z" /><circle cx="12" cy="6" r="2" /></>),
  tax: (<><path d="M5 19L19 5" /><circle cx="7" cy="7" r="2.4" /><circle cx="17" cy="17" r="2.4" /></>),
  checkCircle: (<><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.8 2.8L16 10.5" /></>),
  eye: (<><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z" /><circle cx="12" cy="12" r="3" /></>),
  eyeOff: (<><path d="M2 12s3.6-6 10-6c1.6 0 3 .3 4.3.9" /><path d="M22 12s-3.6 6-10 6c-1.6 0-3-.3-4.3-.9" /><path d="M3 3l18 18" /></>),
  receipt2: (<><path d="M5 3h14v18l-3-2-2 2-2-2-2 2-3-2z" /><path d="M9 8h6M9 12h6" /></>),
  printer: (<><path d="M6 9V3h12v6" /><rect x="3" y="9" width="18" height="8" rx="2" /><path d="M6 17h12v4H6z" /></>),
  download2: (<><path d="M12 3v11" /><path d="M8 11l4 4 4-4" /><path d="M4 19h16" /></>),
  paperclip: (<><path d="M20 11l-8.5 8.5a4.5 4.5 0 0 1-6.4-6.4L13 5a3 3 0 0 1 4.2 4.2l-7.5 7.5a1.5 1.5 0 0 1-2.1-2.1L15 7.3" /></>),
  lock2: (<><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>),
  cpu: (<><rect x="7" y="7" width="10" height="10" rx="2" /><path d="M10 2v3M14 2v3M10 19v3M14 19v3M2 10h3M2 14h3M19 10h3M19 14h3" /></>),
  book: (<><path d="M4 5a3 3 0 0 1 3-3h13v18H7a3 3 0 0 0-3 3z" /><path d="M4 5v16" /></>),
  bank: (<><path d="M3 10l9-6 9 6" /><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8" /><path d="M3 20h18" /></>),
  money: (<><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="3" /><path d="M6 12h.01M18 12h.01" /></>),
  swap: (<><path d="M4 8h13l-3-3" /><path d="M20 16H7l3 3" /></>),
  plus2: (<><path d="M12 5v14M5 12h14" /></>),
  chart2: (<><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>),
  grid: (<><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>),
  image2: (<><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M21 17l-5-5-9 8" /></>),
  tagIcon: (<><path d="M20 12.5L12.5 20 4 11.5V4h7.5z" /><circle cx="8.5" cy="8.5" r="1.5" /></>),
  usersGroup: (<><circle cx="9" cy="8" r="3.2" /><path d="M2 20a7 7 0 0 1 14 0" /><circle cx="18" cy="9" r="2.4" /><path d="M16 20a5.5 5.5 0 0 1 6-4" /></>),
  sliders: (<><path d="M5 20V13M5 9V4M12 20v-9M12 7V4M19 20v-4M19 12V4" /><circle cx="5" cy="11" r="2" /><circle cx="12" cy="9" r="2" /><circle cx="19" cy="14" r="2" /></>),
  truck2: (<><path d="M2 6h12v10H2z" /><path d="M14 10h4l3 3v3h-7" /><circle cx="6" cy="18" r="2" /><circle cx="17" cy="18" r="2" /></>),
  arrowLeft2: (<><path d="M19 12H5" /><path d="M11 18l-6-6 6-6" /></>),
  close: (<><path d="M6 6l12 12M18 6L6 18" /></>),
  info2: (<><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>),
  forbidden: (<><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6l12.8 12.8" /></>),
  eyePlus: (<><path d="M2 12s3.6-6 10-6c1.3 0 2.5.2 3.6.6" /><path d="M22 12s-3.6 6-10 6c-1.3 0-2.5-.2-3.6-.6" /><circle cx="12" cy="12" r="2.6" /></>),
  coins: (<><ellipse cx="10" cy="7" rx="6" ry="3" /><path d="M4 7v5c0 1.7 2.7 3 6 3s6-1.3 6-3V7" /><path d="M4 12v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5" /><path d="M20 10.5c0 1.4-1.7 2.6-4 2.9" /></>),
  receipt: (<><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></>),
  link: (<><path d="M10 14a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 0 0-5.7-5.7L11 7.3" /><path d="M14 10a4 4 0 0 0-5.7 0L5.7 12.6a4 4 0 0 0 5.7 5.7L13 16.7" /></>),
  globe: (<><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z" /></>),
  spark: (<><path d="M12 3v4M12 17v4M3 12h4M17 12h4" /><path d="M6.3 6.3l2.8 2.8M14.9 14.9l2.8 2.8M6.3 17.7l2.8-2.8M14.9 9.1l2.8-2.8" /></>),
  download: (<><path d="M12 3v12" /><path d="M7 10l5 5 5-5" /><path d="M4 20h16" /></>),
  bell2: (<><path d="M12 3a5 5 0 0 0-5 5v4l-2 4h14l-2-4V8a5 5 0 0 0-5-5z" /><path d="M10 19a2 2 0 0 0 4 0" /></>)
};

export const CM_PINK = '#ec1e79';

export function Icon({ name, size = 18, color = CM_PINK, strokeWidth = 2, className = '', title, style }) {
  const body = PATHS[name] || PATHS.dot;
  return (
    <svg
      className={`cm-icon ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : 'true'}
      aria-label={title}
      focusable="false"
    >
      {body}
    </svg>
  );
}
