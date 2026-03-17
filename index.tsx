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

const disableServiceWorker = (reason: string = '1') => {
  try {
    sessionStorage.setItem(SW_DISABLE_STORAGE_KEY, reason);
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

const isStorageAccessError = (error: unknown): boolean => {
  if (!error) return false;
  const message = String((error as Error)?.message ?? error).toLowerCase();
  return (
    message.includes('storage') ||
    message.includes('indexeddb') ||
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
        disableServiceWorker();
      }
    });
  }, 60_000);
};

const registerServiceWorker = async (storageCapable?: boolean) => {
  if (!('serviceWorker' in navigator)) return;
  if (storageCapable === undefined) {
    storageCapable = await canUseServiceWorkerStorage();
  }

  if (!storageCapable) {
    disableServiceWorker();
    return;
  }

  try {
    const existing = await navigator.serviceWorker.getRegistration('/');
    if (existing) {
      await existing.update().catch((error) => {
        if (isStorageAccessError(error)) {
          disableServiceWorker();
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
        disableServiceWorker();
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
      disableServiceWorker();
      return;
    }
  }
};

if ('serviceWorker' in navigator) {
  window.addEventListener('unhandledrejection', (event) => {
    if (isStorageAccessError(event.reason)) {
      event.preventDefault();
      console.info('[ServiceWorker] Ignoring storage-related service worker rejection in this environment.');
    }
  });
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const initializeServiceWorker = async () => {
      const storageCapable = await canUseServiceWorkerStorage();

      if (!storageCapable) {
        disableServiceWorker();
        return;
      }

      if (isServiceWorkerDisabled()) {
        clearServiceWorkerDisabled();
      }

      registerServiceWorker(storageCapable).catch(() => {
        disableServiceWorker();
      });
    };

    void initializeServiceWorker();
  });
}
