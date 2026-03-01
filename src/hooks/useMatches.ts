import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { isSupabaseConfigured, getSupabaseUrl } from '../lib/supabase';
import { formatLocalDate, safeParseDate } from '../utils/dateUtils';
import { Match } from '@/types';

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
  const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

  console.log("Calling fetch-matches v2 for DB-first schedule + odds:", dateStr);

  const res = await fetch(`${SUPABASE_URL}/functions/v1/fetch-matches?date=${dateStr}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    // Safe fallback: send date in body too, just in case the Edge Function expects it there
    body: JSON.stringify({ date: dateStr }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("fetch-matches failed:", res.status, errText);
    // FIX: MUST throw the error so React Query catches it, retries, and shows error states
    throw new Error(`fetch-matches failed: ${res.status} ${errText}`);
  }

  const data = await res.json();

  // FIX: Safely extract matches in case Edge Function returns { data: [...] } or { matches: [...] }
  const matches = Array.isArray(data) ? data : (data?.data || data?.matches || []);
  return matches;
};

export const useMatches = (selectedDate: Date | string) => {
  const dateObj = safeParseDate(selectedDate);
  // Use a stable string key for the query cache
  const dateKey = formatLocalDate(dateObj);

  const matches = useQuery({
    queryKey: ['matches', dateKey],
    queryFn: () => fetchMatches(dateObj),
    staleTime: 5000,
    // ADAPTIVE POLLING: 5s if game is live, else 15s.
    refetchInterval: (query): number | false => {
      const data = query.state.data as Match[] | undefined;
      const hasLiveMatch = data?.some(m =>
        m.status === 'STATUS_IN_PROGRESS' ||
        m.status === 'IN_PROGRESS'
      );
      return hasLiveMatch ? 5000 : 15000;
    },
    refetchOnMount: true,
    retry: 1,
    placeholderData: keepPreviousData,
  });

  return matches;
};
