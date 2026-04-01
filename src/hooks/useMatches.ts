import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { isSupabaseConfigured, getSupabaseUrl } from '../lib/supabase';
import { formatLocalDate, safeParseDate } from '../utils/dateUtils';
import { Match } from '@/types';
import { fetchAllMatches } from '@/services/espnService';
import { LEAGUES } from '@/constants';

const matchCache = new Map<string, { etag: string; data: Match[] }>();
const FALLBACK_LEAGUE_IDS = new Set([
  'nba',
  'nhl',
  'nfl',
  'college-football',
  'mens-college-basketball',
  'mlb',
  'eng.1',
  'usa.1',
  'ita.1',
  'esp.1',
  'ger.1',
  'fra.1',
  'ned.1',
  'por.1',
  'bel.1',
  'tur.1',
  'bra.1',
  'arg.1',
  'sco.1',
  'uefa.champions',
  'uefa.europa',
  'mex.1',
]);
const FALLBACK_LEAGUES = LEAGUES.filter((league) => FALLBACK_LEAGUE_IDS.has(league.id));

const fetchFallbackMatches = async (date: Date, fetchedAt: number = Date.now()): Promise<Match[]> => {
  const fallback = await fetchAllMatches(FALLBACK_LEAGUES, date);
  return (fallback || []).map((item: Match) => (
    typeof item?.fetched_at === 'number'
      ? item
      : { ...item, fetched_at: fetchedAt }
  ));
};

const fetchFallbackWithCache = async (
  date: Date,
  dateStr: string,
  fetchedAt: number,
  cached?: { etag: string; data: Match[] }
): Promise<Match[]> => {
  try {
    const fallback = await fetchFallbackMatches(date, fetchedAt);
    if (fallback.length > 0) {
      matchCache.set(dateStr, {
        etag: cached?.etag ?? `fallback-${fetchedAt}`,
        data: fallback,
      });
      return fallback;
    }
  } catch (error) {
    console.warn('ESPN fallback failed:', error);
  }

  if (cached?.data?.length) return cached.data;
  return [];
};

const fetchMatches = async (date: Date): Promise<Match[]> => {
  if (!date || isNaN(date.getTime())) {
    console.error("useMatches: Invalid date provided to fetchMatches");
    return [];
  }

  const dateStr = formatLocalDate(date);

  if (!isSupabaseConfigured()) {
    console.warn("Supabase not configured. Cannot call fetch-matches.");
    return [];
  }

  const SUPABASE_URL = getSupabaseUrl();
  const rawAnonKey = (
    typeof import.meta.env.VITE_SUPABASE_ANON_KEY === 'string'
      ? import.meta.env.VITE_SUPABASE_ANON_KEY
      : typeof (import.meta as any).env?.NEXT_PUBLIC_SUPABASE_ANON_KEY === 'string'
        ? (import.meta as any).env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        : ''
  ).trim();

  if (!SUPABASE_URL || !rawAnonKey) {
    return fetchFallbackWithCache(date, dateStr, Date.now(), matchCache.get(dateStr));
  }

  // FIX: Provide Vite the exact string to replace at build-time
  // @ts-ignore - Vite needs this exact string format for replacement, despite TS warnings
  const SUPABASE_ANON_KEY = rawAnonKey;

  const cached = matchCache.get(dateStr);
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/fetch-matches?date=${dateStr}&limit=140`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        ...(cached?.etag ? { 'If-None-Match': cached.etag } : {}),
      },
      // Safe fallback: send date in body too, just in case the Edge Function expects it there
      body: JSON.stringify({ date: dateStr, limit: 140 }),
    });
  } catch (err) {
    console.warn('fetch-matches network error, using ESPN fallback:', err);
    return fetchFallbackWithCache(date, dateStr, Date.now(), cached);
  }

  if (res.status === 304 && cached) {
    if (cached.data.length > 0) return cached.data;
    return fetchFallbackWithCache(date, dateStr, Date.now(), cached);
  }

  if (!res.ok) {
    const errText = await res.text();
    console.error("fetch-matches failed:", res.status, errText);
    return fetchFallbackWithCache(date, dateStr, Date.now(), cached);
  }

  const fetchedAt = Date.now();
  let data: unknown;

  try {
    data = await res.json();
  } catch (error) {
    console.warn('fetch-matches JSON parse failed:', error);
    return fetchFallbackWithCache(date, dateStr, fetchedAt, cached);
  }

  const payload = data as { data?: unknown; matches?: unknown } | unknown[];
  // FIX: Safely extract matches in case Edge Function returns { data: [...] } or { matches: [...] }
  const rawMatches = Array.isArray(payload)
    ? payload
    : (payload && typeof payload === 'object' && Array.isArray(payload.data))
      ? payload.data
      : (payload && typeof payload === 'object' && Array.isArray(payload.matches))
        ? payload.matches
        : [];
  if (!Array.isArray(rawMatches)) {
    return fetchFallbackWithCache(date, dateStr, fetchedAt, cached);
  }

  const matches: Match[] = rawMatches.map((item: Match) => (
    typeof item?.fetched_at === 'number'
      ? item
      : { ...item, fetched_at: fetchedAt }
  ));
  const etag = res.headers.get('etag');
  if (matches.length > 0) {
    matchCache.set(dateStr, {
      etag: etag ?? cached?.etag ?? `primary-${fetchedAt}`,
      data: matches,
    });
    return matches;
  }

  // Fail-open fallback: if Edge returns an empty slate, hydrate directly from ESPN.
  // This protects feed availability when DB ingest/joins are delayed.
  const fallbackMatches = await fetchFallbackWithCache(date, dateStr, fetchedAt, cached);
  if (fallbackMatches.length === 0 && !cached?.data?.length) {
    matchCache.delete(dateStr);
  }
  return fallbackMatches;
};

export const useMatches = (selectedDate: Date | string) => {
  const dateObj = safeParseDate(selectedDate);
  // Use a stable string key for the query cache
  const dateKey = formatLocalDate(dateObj);

  const matches = useQuery({
    queryKey: ['matches', dateKey],
    queryFn: () => fetchMatches(dateObj),
    staleTime: 15_000,
    // ADAPTIVE POLLING: 5s if game is live, else 15s.
    refetchInterval: (query): number | false => {
      const data = query.state.data as Match[] | undefined;
      const hasLiveMatch = data?.some(m => {
        // FIX: isLiveStatus doesn't match STATUS_IN_PROGRESS
        // Safely check status and isLiveStatus (even if not strictly typed in Match yet)
        const match = m as any;
        const status = String(match.status || '').toUpperCase();
        const liveStatus = String(match.isLiveStatus || '').toUpperCase();

        return (
          match.isLiveStatus === true ||
          liveStatus === 'STATUS_IN_PROGRESS' ||
          liveStatus === 'IN_PROGRESS' ||
          status === 'STATUS_IN_PROGRESS' ||
          status === 'IN_PROGRESS' ||
          status === 'LIVE' ||
          status === 'IN' ||
          status.includes('IN_PROGRESS')
        );
      });
      return hasLiveMatch ? 7000 : 30000;
    },
    // FIX: Feed polls at 60s not 15s. Browsers throttle inactive tabs to 60s 
    // unless refetchIntervalInBackground is strictly set to true.
    refetchIntervalInBackground: true,
    refetchOnMount: false,
    retry: 1,
    placeholderData: keepPreviousData,
  });

  return matches;
};
