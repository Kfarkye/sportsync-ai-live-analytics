
import { useState, useEffect } from 'react';
import { fetchPreGameData, PreGameData } from '../services/espnPreGame.ts';
import { Sport } from '../types';

// In-memory cache
const PREGAME_CACHE = new Map<string, { data: PreGameData; timestamp: number }>();
const CACHE_TTL_DEFAULT = 5 * 60 * 1000; // 5 minutes for scheduled/finished
const CACHE_TTL_LIVE = 15 * 1000;        // 15 seconds for live matches
const POLLING_INTERVAL = 30 * 1000;     // poll every 30s for live matches

export const usePreGameData = (matchId: string, sport: Sport, leagueId: string) => {
  const [data, setData] = useState<PreGameData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async (forceFresh = false) => {
    if (!matchId) return;

    // 1. Check Cache (unless forcing fresh)
    const cached = PREGAME_CACHE.get(matchId);

    // Determine TTL based on game status if we have it
    let currentTtl = CACHE_TTL_DEFAULT;
    if (data?.marketIntel) {
      // If we have data and it's from a live game context (determined by parent usually, 
      // but here we check if we have data already and if we should treat it as fresh)
      // Scoreboard status is best but PreGameData might not have it explicitly in the root.
      // However, if we are in this hook, we check the global state.
    }

    if (!forceFresh && cached) {
      const age = Date.now() - cached.timestamp;
      const isLive = cached.data.market?.currentTotal !== undefined; // Proxy check for active data
      const threshold = isLive ? CACHE_TTL_LIVE : CACHE_TTL_DEFAULT;

      if (age < threshold) {
        console.log(`[usePreGameData] Cache hit for ${matchId} (age: ${Math.round(age / 1000)}s)`);
        setData(cached.data);
        setIsLoading(false);
        return;
      }
    }

    console.log(`[usePreGameData] Fetching ${forceFresh ? 'FORCED ' : ''}fresh data for ${matchId}...`);
    if (!data) setIsLoading(true);

    try {
      const freshData = await fetchPreGameData(matchId, sport, leagueId);
      if (freshData) {
        setData(freshData);
        PREGAME_CACHE.set(matchId, { data: freshData, timestamp: Date.now() });
      } else if (!data) {
        setError("Could not load match intel.");
      }
    } catch (e) {
      console.error(`[usePreGameData] Error loading ${matchId}:`, e);
      if (!data) setError("Network error loading preview.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();

    // Set up polling for live matches or general freshness
    const interval = setInterval(() => {
      // Only poll if the tab is active and matchId exists
      if (document.visibilityState === 'visible' && matchId) {
        console.log(`[usePreGameData] Heartbeat refresh for ${matchId}`);
        load(true);
      }
    }, POLLING_INTERVAL);

    return () => clearInterval(interval);
  }, [matchId, sport, leagueId]);

  return { data, isLoading, error, refresh: () => load(true) };
};
