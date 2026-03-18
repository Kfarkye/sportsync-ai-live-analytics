
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './src/App';
import SoccerLeagueStructuralStatsPage, { getSoccerLeagueByPathname } from './src/pages/SoccerLeagueStructuralStatsPage';
import './index.css';

const isIndexedDbError = (error: unknown): boolean => {
  const message = String((error && typeof error === 'object' && 'message' in (error as any))
    ? (error as any).message
    : error);
  const lowered = message.toLowerCase();
  return lowered.includes('backing store') || lowered.includes('indexeddb');
};

const unregisterServiceWorkers = async () => {
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  } catch {
    // best effort cleanup
  }

  if ('caches' in window) {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    } catch {
      // best effort cleanup
    }
  }
};

const unregisterLegacyServiceWorkers = async () => {
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    const legacyRegistrations = registrations.filter((registration) => {
      const scriptUrls = [
        registration.active?.scriptURL,
        registration.waiting?.scriptURL,
        registration.installing?.scriptURL,
      ].filter(Boolean);

      return scriptUrls.some((url) => url?.includes('/2sw.js'));
    });

    if (!legacyRegistrations.length) return false;

    await Promise.all(legacyRegistrations.map((registration) => registration.unregister()));
    return true;
  } catch {
    return false;
  }
};

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
const leaguePage = getSoccerLeagueByPathname(window.location.pathname);

if (leaguePage) {
  root.render(
    <React.StrictMode>
      <SoccerLeagueStructuralStatsPage league={leaguePage} />
    </React.StrictMode>
  );
} else {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

// PWA: Register service worker for installability + offline shell
if ('serviceWorker' in navigator) {
  const handleIndexedDbWorkerFailure = async () => {
    if (localStorage.getItem('drip-sw-disabled') === '1') return;
    await unregisterServiceWorkers();
    localStorage.setItem('drip-sw-disabled', '1');
  };

  const handleSwError = (event: ErrorEvent) => {
    const value = event.error;
    if (isIndexedDbError(value)) {
      void handleIndexedDbWorkerFailure();
    }
  };

  const handleUnhandledSwError = (event: PromiseRejectionEvent) => {
    if (isIndexedDbError(event.reason)) {
      void handleIndexedDbWorkerFailure();
    }
  };

  window.addEventListener('error', handleSwError);
  window.addEventListener('unhandledrejection', handleUnhandledSwError);

  window.addEventListener('load', () => {
    const run = async () => {
      const hadLegacyWorker = await unregisterLegacyServiceWorkers();
      if (hadLegacyWorker && navigator.serviceWorker.controller && !sessionStorage.getItem('drip-sw-legacy-cleanup')) {
        sessionStorage.setItem('drip-sw-legacy-cleanup', '1');
        window.location.reload();
        return;
      }

      if (localStorage.getItem('drip-sw-disabled') === '1') return;

      try {
        const registration = await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });

        registration.update().catch(() => {});
        window.setInterval(() => registration.update().catch(() => {}), 60_000);

        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              window.location.reload();
            }
          });
        });

      } catch (error) {
        console.warn('Service worker registration failed:', error);

        if (isIndexedDbError(error)) {
          await handleIndexedDbWorkerFailure();
        }
      }
    };

    void run();
  });
}
