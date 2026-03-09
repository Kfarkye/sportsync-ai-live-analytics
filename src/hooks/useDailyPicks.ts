import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { formatLocalDate, safeParseDate } from '@/utils/dateUtils';
import type { DailyPickRecord, MatchPickSummary } from '@/types/dailyPicks';

const toNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const fetchDailyPicks = async (date: Date): Promise<DailyPickRecord[]> => {
  if (!isSupabaseConfigured()) return [];
  const p_date = formatLocalDate(date);

  const { data, error } = await supabase.rpc('get_daily_picks', { p_date });
  if (error) {
    throw new Error(`get_daily_picks failed: ${error.message}`);
  }
  if (!Array.isArray(data)) return [];

  return data
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object')
    .map((row) => ({
      match_id: String(row.match_id ?? ''),
      home_team: String(row.home_team ?? ''),
      away_team: String(row.away_team ?? ''),
      league_id: String(row.league_id ?? ''),
      start_time: String(row.start_time ?? ''),
      play: String(row.play ?? ''),
      home_rate: toNumber(row.home_rate),
      home_sample: toNumber(row.home_sample),
      away_rate: toNumber(row.away_rate),
      away_sample: toNumber(row.away_sample),
      avg_rate: toNumber(row.avg_rate),
      pick_type: String(row.pick_type ?? ''),
      last_refreshed_at: String(row.last_refreshed_at ?? ''),
    }))
    .filter((row) => row.match_id.length > 0 && row.play.length > 0);
};

const canonicalMatchId = (value: string): string => value.split('_')[0] || value;

export function useDailyPicks(selectedDate: Date | string) {
  const dateObj = safeParseDate(selectedDate);
  const dateKey = formatLocalDate(dateObj);

  const query = useQuery({
    queryKey: ['daily-picks', dateKey],
    queryFn: () => fetchDailyPicks(dateObj),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: 1,
  });

  const picksByMatch = useMemo(() => {
    const map = new Map<string, MatchPickSummary>();
    for (const pick of query.data ?? []) {
      const key = canonicalMatchId(pick.match_id);
      const existing = map.get(key);
      const markets = existing
        ? [...existing.markets, { play: pick.play, avgRate: pick.avg_rate }]
        : [{ play: pick.play, avgRate: pick.avg_rate }];

      const marketRate = (pattern: RegExp): number | undefined => {
        const hit = markets.find((m) => pattern.test(m.play.toLowerCase()));
        return hit?.avgRate;
      };

      const summary: MatchPickSummary = {
        matchId: pick.match_id,
        play: pick.play,
        avgRate: pick.avg_rate,
        homeRate: pick.home_rate,
        awayRate: pick.away_rate,
        homeSample: pick.home_sample,
        awaySample: pick.away_sample,
        pickType: pick.pick_type,
        lastRefreshedAt: pick.last_refreshed_at,
        markets,
        bttsRate: marketRate(/\bbtts\b|both teams to score/),
        o25Rate: marketRate(/over 2\.?5|under 2\.?5/),
        streakRate: pick.avg_rate,
        streakSample: Math.max(0, Math.min(10, Math.round(Math.min(pick.home_sample || 10, pick.away_sample || 10)))),
      };
      map.set(key, summary);
      map.set(pick.match_id, summary);
    }
    return map;
  }, [query.data]);

  return {
    ...query,
    picks: query.data ?? [],
    picksByMatch,
  };
}
