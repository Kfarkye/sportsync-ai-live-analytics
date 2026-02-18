/**
 * Network Resilience Hook — Mobile Connection Handling
 *
 * Handles WiFi → cellular → tunnel drop transitions
 * Exponential backoff reconnection
 * Visibility-aware WebSocket management
 */

import { useState, useEffect, useCallback, useRef } from 'react';

export type ConnectionQuality = 'online' | 'slow' | 'offline';

interface NetworkState {
  online: boolean;
  quality: ConnectionQuality;
  reconnecting: boolean;
  lastOnlineAt: number;
}

export function useNetworkResilience() {
  const [state, setState] = useState<NetworkState>({
    online: typeof navigator !== 'undefined' ? navigator.onLine : true,
    quality: 'online',
    reconnecting: false,
    lastOnlineAt: Date.now(),
  });

  const backoffRef = useRef(0);

  useEffect(() => {
    const handleOnline = () => {
      backoffRef.current = 0;
      setState(s => ({ ...s, online: true, quality: 'online', reconnecting: false, lastOnlineAt: Date.now() }));
    };

    const handleOffline = () => {
      setState(s => ({ ...s, online: false, quality: 'offline', reconnecting: false }));
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Detect slow connections via Network Information API
    const conn = (navigator as { connection?: { effectiveType?: string } }).connection;
    if (conn) {
      const checkSpeed = () => {
        const type = conn.effectiveType;
        if (type === 'slow-2g' || type === '2g') {
          setState(s => ({ ...s, quality: 'slow' }));
        } else if (navigator.onLine) {
          setState(s => ({ ...s, quality: 'online' }));
        }
      };
      checkSpeed();
      (conn as EventTarget).addEventListener('change', checkSpeed);
      return () => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
        (conn as EventTarget).removeEventListener('change', checkSpeed);
      };
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const getBackoffDelay = useCallback(() => {
    const delay = Math.min(2000 * Math.pow(2, backoffRef.current), 16000);
    backoffRef.current++;
    return delay;
  }, []);

  const resetBackoff = useCallback(() => {
    backoffRef.current = 0;
  }, []);

  return { ...state, getBackoffDelay, resetBackoff };
}

// ============================================================================
// VISIBILITY-AWARE WebSocket Management
// ============================================================================
export function useVisibilityAware(onForeground: () => void, onBackground: () => void) {
  const wasForeground = useRef(true);

  useEffect(() => {
    const handleVisibility = () => {
      const isForeground = document.visibilityState === 'visible';
      if (isForeground && !wasForeground.current) {
        onForeground();
      } else if (!isForeground && wasForeground.current) {
        onBackground();
      }
      wasForeground.current = isForeground;
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [onForeground, onBackground]);
}
