import { useQuery } from '@tanstack/react-query';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { formatLocalDate, safeParseDate } from '../utils/dateUtils';
import { fetchAllMatches } from '../services/espnService'; // Fallback
import { Match } from '@/types';
import { LEAGUES } from '@/constants';

const fetchMatches = async (date: Date): Promise<Match[]> => {
  // Defensive check for Safari/Mobile hangs
  if (!date || isNaN(date.getTime())) {
    console.error("useMatches: Invalid date provided to fetchMatches");
    return [];
  }

  const dateStr = formatLocalDate(date);

  // 1. Client-Side Fetch (Guarantees Correct Schedule/Date)
  console.log("Using client-side service for date:", dateStr);
  const baseMatches = await fetchAllMatches(LEAGUES || [], date);

  if (isSupabaseConfigured() && baseMatches.length > 0) {
    try {
      // 2. Merge Premium Odds (Client-Side DB Query)
      // ARCHITECTURE: We use a 5-second timeout to prevent stalling on mobile/slow networks.
      // If it fails, the user still gets ESPN base scores.
      const { mergePremiumOdds } = await import('../services/oddsService');
      console.log("Merging premium odds client-side with 5s timeout...");

      const timeout = new Promise<Match[]>((_, reject) =>
        setTimeout(() => reject(new Error("Premium odds merge timed out")), 5000)
      );

      const enrichedMatches = await Promise.race([
        mergePremiumOdds(baseMatches),
        timeout
      ]);

      return enrichedMatches;
    } catch (err) {
      console.warn("Premium odds enrichment skipped or timed out:", err);
      return baseMatches;
    }
  }

  return baseMatches;
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
        m.status === 'IN_PROGRESS' ||
        m.current_odds?.isLive
      );
      return hasLiveMatch ? 5000 : 15000;
    },
    refetchOnMount: true,
    retry: 1,
  });

  return matches;
};
