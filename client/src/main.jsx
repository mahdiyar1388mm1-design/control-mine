import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/vazirmatn/400.css';
import '@fontsource/vazirmatn/500.css';
import '@fontsource/vazirmatn/700.css';
import './styles/global.css';
import './styles/brand-overrides.css';
import App from './App';
import { installEmojiScrubber } from './lib/stripEmoji';

// No emoji stickers anywhere on the site (pink SVG icons are used instead).
installEmojiScrubber();

// Keep the native install prompt available even if it fires before the auth page opens.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    window.__cmInstallPrompt = event;
    window.dispatchEvent(new Event('cm-install-available'));
  });
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Safe static-shell PWA registration (§16: static assets only; never caches /api/*)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* ignore SW registration error in restricted browsers */
    });
  });
}
