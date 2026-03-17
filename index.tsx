import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './src/App';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

const SW_DISABLE_STORAGE_KEY = 'sportsync-sw-disabled';
const SW_STORAGE_RELOAD_KEY = 'sportsync-sw-reloaded-for-storage';
const SW_DEBUG_DISABLE_PARAM = 'disable-sw';
type ServiceWorkerQuerySetting = 'enabled' | 'disabled';

const disableServiceWorker = async (reason: string = '1') => {
  try {
    sessionStorage.setItem(SW_DISABLE_STORAGE_KEY, reason);
  } catch {
    // Storage is optional in constrained environments.
  }
  await clearServiceWorkerArtifacts();
  try {
    const didReloadForStorage = sessionStorage.getItem(SW_STORAGE_RELOAD_KEY) === '1';
    if (!didReloadForStorage && navigator.serviceWorker.controller) {
      sessionStorage.setItem(SW_STORAGE_RELOAD_KEY, '1');
      window.location.replace(window.location.href);
    }
  } catch {
    // Storage is optional in constrained environments.
  }
};

const clearServiceWorkerDisabled = () => {
  try {
    sessionStorage.removeItem(SW_DISABLE_STORAGE_KEY);
  } catch {
    // Storage is optional in constrained environments.
  }
};

const isServiceWorkerDisabled = (): boolean => {
  try {
    return sessionStorage.getItem(SW_DISABLE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};

const getServiceWorkerQuerySetting = (): ServiceWorkerQuerySetting | null => {
  try {
    const params = new URLSearchParams(window.location.search);
    const flag = params.get(SW_DEBUG_DISABLE_PARAM);
    if (flag === '0' || flag?.toLowerCase() === 'false') return 'enabled';
    if (flag === '1' || flag?.toLowerCase() === 'true') return 'disabled';
    return null;
  } catch {
    return null;
  }
};

const clearServiceWorkerArtifacts = async () => {
  if (!('serviceWorker' in navigator)) return;

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  } catch {
    // Ignore cleanup failures.
  }

  if (!('caches' in window)) return;
  try {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((name) => caches.delete(name)));
  } catch {
    // Ignore cleanup failures.
  }
};

const isStorageAccessError = (error: unknown): boolean => {
  if (!error) return false;
  const normalized = [((error as { name?: unknown }).name as string | undefined), (error as Error)?.message].filter(Boolean).join(' ').toLowerCase();
  const message = String((error as Error)?.message ?? error).toLowerCase();
  return (
    normalized.includes('invalidstateerror') ||
    normalized.includes('databaseclosederror') ||
    message.includes('backing store') ||
    message.includes('storage') ||
    message.includes('database connection') ||
    message.includes('database is closing') ||
    message.includes('connection is closing') ||
    message.includes('indexeddb') ||
    message.includes('idb') ||
    message.includes('request storage') ||
    message.includes('failed to access storage') ||
    message.includes('quota')
  );
};

const canUseIndexedDB = async () => {
  if (typeof indexedDB === 'undefined') return false;
  try {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('__sportsync-idb-probe__');
      request.addEventListener('upgradeneeded', () => request.result.createObjectStore('probe', { autoIncrement: true }));
      request.addEventListener('success', () => {
        const db = request.result;
        db.close();
        indexedDB.deleteDatabase('__sportsync-idb-probe__');
        resolve();
      });
      request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB open failed')));
    });
    return true;
  } catch {
    return false;
  }
};

const canUseStorageEstimate = async () => {
  if (!('storage' in navigator) || !navigator.storage?.estimate) return true;
  try {
    const estimate = await navigator.storage.estimate();
    return estimate.quota === undefined || estimate.quota > 0;
  } catch {
    return false;
  }
};

const canUseServiceWorkerStorage = async (): Promise<boolean> => {
  return (await canUseIndexedDB()) && (await canUseStorageEstimate());
};

const scheduleWorkerRefresh = (registration: ServiceWorkerRegistration) => {
  window.setInterval(() => {
    void registration.update().catch((error) => {
      if (isStorageAccessError(error)) {
        void disableServiceWorker();
      }
    });
  }, 60_000);
};

const registerServiceWorker = async (storageCapable?: boolean) => {
  if (!('serviceWorker' in navigator)) return;
  if (isServiceWorkerDisabled()) {
    return;
  }

  if (storageCapable === undefined) {
    storageCapable = await canUseServiceWorkerStorage();
  }

  if (!storageCapable) {
    void disableServiceWorker();
    return;
  }

  try {
    const existing = await navigator.serviceWorker.getRegistration('/');
    if (existing) {
      await existing.update().catch((error) => {
        if (isStorageAccessError(error)) {
          void disableServiceWorker();
          return;
        }
        throw error;
      });
      scheduleWorkerRefresh(existing);
      clearServiceWorkerDisabled();
      return;
    }

    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    });

    registration.update().catch((error) => {
      if (isStorageAccessError(error)) {
        void disableServiceWorker();
        return;
      }
    });

    scheduleWorkerRefresh(registration);

    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          window.location.reload();
        }
      });
    });

    clearServiceWorkerDisabled();
  } catch (error) {
    if (isStorageAccessError(error)) {
      void disableServiceWorker();
      return;
    }
  }
};

if ('serviceWorker' in navigator) {
  window.addEventListener('unhandledrejection', (event) => {
    if (isStorageAccessError(event.reason)) {
      event.preventDefault();
      console.info('[ServiceWorker] Ignoring storage-related service worker rejection in this environment.');
      void disableServiceWorker();
    }
  });
}

if ('serviceWorker' in navigator) {
  window.addEventListener('error', (event) => {
    if (isStorageAccessError(event.error)) {
      event.preventDefault();
      console.info('[ServiceWorker] Ignoring storage-related service worker error in this environment.');
      void disableServiceWorker();
    }
  });
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const initializeServiceWorker = async () => {
      const swQuerySetting = getServiceWorkerQuerySetting();

      if (swQuerySetting === 'disabled') {
        (window as typeof window & { __sportsyncSwDebugDisabled?: boolean }).__sportsyncSwDebugDisabled = true;
        console.info('[ServiceWorker] Disabled via query param.');
        await clearServiceWorkerArtifacts();
        return;
      }

      if (swQuerySetting === 'enabled') {
        clearServiceWorkerDisabled();
        try {
          sessionStorage.removeItem(SW_STORAGE_RELOAD_KEY);
        } catch {
          // Storage is optional in constrained environments.
        }
      }

      (window as typeof window & { __sportsyncSwDebugDisabled?: boolean }).__sportsyncSwDebugDisabled = false;

      const storageCapable = await canUseServiceWorkerStorage();

      if (!storageCapable) {
        void disableServiceWorker();
        return;
      }

      if (isServiceWorkerDisabled()) {
        return;
      }

      registerServiceWorker(storageCapable).catch(() => {
        void disableServiceWorker();
      });
    };

    void initializeServiceWorker();
  });
}
