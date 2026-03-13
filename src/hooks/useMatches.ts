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
  'ita.1',
  'esp.1',
  'ger.1',
  'uefa.champions',
]);
const FALLBACK_LEAGUES = LEAGUES.filter((league) => FALLBACK_LEAGUE_IDS.has(league.id));

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
  // FIX: Provide Vite the exact string to replace at build-time
  // @ts-ignore - Vite needs this exact string format for replacement, despite TS warnings
  const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY.trim();

  const cached = matchCache.get(dateStr);
  const res = await fetch(`${SUPABASE_URL}/functions/v1/fetch-matches?date=${dateStr}&limit=140`, {
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

  if (res.status === 304 && cached) return cached.data;

  if (!res.ok) {
    const errText = await res.text();
    console.error("fetch-matches failed:", res.status, errText);
    // FIX: MUST throw the error so React Query catches it, retries, and shows error states
    throw new Error(`fetch-matches failed: ${res.status} ${errText}`);
  }

  const data = await res.json();
  const fetchedAt = Date.now();

  // FIX: Safely extract matches in case Edge Function returns { data: [...] } or { matches: [...] }
  const rawMatches = Array.isArray(data) ? data : (data?.data || data?.matches || []);
  const matches: Match[] = rawMatches.map((item: Match) => (
    typeof item?.fetched_at === 'number'
      ? item
      : { ...item, fetched_at: fetchedAt }
  ));
  const etag = res.headers.get('etag');
  if (etag) matchCache.set(dateStr, { etag, data: matches });
  if (matches.length > 0) return matches;

  // Fail-open fallback: if Edge returns an empty slate, hydrate directly from ESPN.
  // This protects feed availability when DB ingest/joins are delayed.
  const fallback = await fetchAllMatches(FALLBACK_LEAGUES, date);
  const fallbackMatches: Match[] = (fallback || []).map((item: Match) => (
    typeof item?.fetched_at === 'number'
      ? item
      : { ...item, fetched_at: fetchedAt }
  ));
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
