import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { isSupabaseConfigured, getSupabaseUrl } from '../lib/supabase';
import { formatLocalDate, safeParseDate } from '../utils/dateUtils';
import { Match } from '@/types';

const fetchMatches = async (date: Date): Promise<Match[]> => {
  // Defensive check for Safari/Mobile hangs
  if (!date || isNaN(date.getTime())) {
    console.error("useMatches: Invalid date provided to fetchMatches");
    return [];
  }

  const dateStr = formatLocalDate(date);

  if (!isSupabaseConfigured()) {
    console.warn("Supabase not configured. Cannot call fetch-matches.");
    return [];
  }

  try {
    const SUPABASE_URL = getSupabaseUrl();
    const SUPABASE_ANON_KEY = (import.meta as any).env.VITE_SUPABASE_ANON_KEY;

    // 1. Single DB-First Query (Eliminates 17x fan-out and race conditions)
    console.log("Calling fetch-matches v2 for DB-first schedule + odds:", dateStr);

    const res = await fetch(`${SUPABASE_URL}/functions/v1/fetch-matches?date=${dateStr}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}), // omitting leagueId to fetch all leagues
    });

    if (!res.ok) {
      console.error("fetch-matches returned an error status:", res.status);
      return [];
    }

    const matches = await res.json();
    return matches || [];

  } catch (err) {
    console.error("fetch-matches catch block:", err);
    return [];
  }
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
