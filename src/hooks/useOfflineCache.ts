/**
 * Offline Cache Hook — Edge Card Caching for Mobile
 *
 * Caches last 20 edge cards in localStorage for instant render on app open.
 * Queues save/bookmark actions for sync when connection returns.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Match } from '@/types';

const CACHE_KEY = 'drip_edge_cache_v1';
const QUEUE_KEY = 'drip_action_queue_v1';
const MAX_CACHED = 20;

interface CachedData {
  matches: Match[];
  timestamp: number;
}

interface QueuedAction {
  type: 'save' | 'bookmark' | 'pin';
  matchId: string;
  timestamp: number;
}

export function useOfflineCache() {
  const [cachedMatches, setCachedMatches] = useState<Match[]>([]);
  const [cacheAge, setCacheAge] = useState<number>(0);
  const queueRef = useRef<QueuedAction[]>([]);

  // Load cache on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const data: CachedData = JSON.parse(raw);
        setCachedMatches(data.matches);
        setCacheAge(Date.now() - data.timestamp);
      }
    } catch { /* corrupted cache, ignore */ }

    try {
      const rawQueue = localStorage.getItem(QUEUE_KEY);
      if (rawQueue) queueRef.current = JSON.parse(rawQueue);
    } catch { /* ignore */ }
  }, []);

  // Update cache with fresh matches
  const updateCache = useCallback((matches: Match[]) => {
    const toCache = matches.slice(0, MAX_CACHED);
    setCachedMatches(toCache);
    setCacheAge(0);
    try {
      const data: CachedData = { matches: toCache, timestamp: Date.now() };
      localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    } catch { /* quota exceeded, ignore */ }
  }, []);

  // Queue an action for offline sync
  const queueAction = useCallback((action: Omit<QueuedAction, 'timestamp'>) => {
    const entry: QueuedAction = { ...action, timestamp: Date.now() };
    queueRef.current.push(entry);
    try {
      localStorage.setItem(QUEUE_KEY, JSON.stringify(queueRef.current));
    } catch { /* ignore */ }
  }, []);

  // Flush queued actions (call when back online)
  const flushQueue = useCallback(async (handler: (action: QueuedAction) => Promise<void>) => {
    const queue = [...queueRef.current];
    queueRef.current = [];
    localStorage.removeItem(QUEUE_KEY);
    for (const action of queue) {
      try { await handler(action); } catch { /* re-queue on failure */ queueRef.current.push(action); }
    }
    if (queueRef.current.length > 0) {
      localStorage.setItem(QUEUE_KEY, JSON.stringify(queueRef.current));
    }
  }, []);

  const cacheAgeMinutes = Math.round(cacheAge / 60000);

  return {
    cachedMatches,
    cacheAge: cacheAgeMinutes,
    hasCachedData: cachedMatches.length > 0,
    updateCache,
    queueAction,
    flushQueue,
  };
}
