import { supabase } from '@/lib/supabase';

export interface KalshiDivergenceAnchorRow {
  match_id: string;
  espn_event_id: string | null;
  espn_league_id: string | null;
  match_start_time: string | null;
  home_team: string | null;
  away_team: string | null;
  kalshi_event_ticker: string;
  kalshi_market_ticker: string;
  kalshi_line_value: number | null;
  dk_open_total: number | null;
  kalshi_implied_over_prob: number | null;
  espn_opening_total_over_prob: number | null;
  espn_kalshi_prob_gap: number | null;
  kalshi_price_source: string | null;
  kalshi_price_captured_at: string | null;
  latest_live_over_prob: number | null;
  latest_live_captured_at: string | null;
}

export interface GetKalshiAnchorOptions {
  leagueId?: string;
  fromIso?: string;
  toIso?: string;
  limit?: number;
}

export async function getKalshiDivergenceAnchorLines(
  options: GetKalshiAnchorOptions = {},
): Promise<KalshiDivergenceAnchorRow[]> {
  const limit = Math.max(1, Math.min(200, options.limit ?? 40));

  let query = supabase
    .from('mv_espn_kalshi_total_divergence_curve')
    .select(
      'match_id,espn_event_id,espn_league_id,match_start_time,home_team,away_team,kalshi_event_ticker,kalshi_market_ticker,kalshi_line_value,dk_open_total,kalshi_implied_over_prob,espn_opening_total_over_prob,espn_kalshi_prob_gap,kalshi_price_source,kalshi_price_captured_at,latest_live_over_prob,latest_live_captured_at',
    )
    .eq('is_dk_anchor_line', true)
    .order('match_start_time', { ascending: false })
    .limit(limit);

  if (options.leagueId) query = query.eq('espn_league_id', options.leagueId);
  if (options.fromIso) query = query.gte('match_start_time', options.fromIso);
  if (options.toIso) query = query.lte('match_start_time', options.toIso);

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []) as KalshiDivergenceAnchorRow[];
}

export async function getKalshiDivergenceCurveForMatch(matchId: string): Promise<KalshiDivergenceAnchorRow[]> {
  if (!matchId) return [];

  const { data, error } = await supabase
    .from('mv_espn_kalshi_total_divergence_curve')
    .select(
      'match_id,espn_event_id,espn_league_id,match_start_time,home_team,away_team,kalshi_event_ticker,kalshi_market_ticker,kalshi_line_value,dk_open_total,kalshi_implied_over_prob,espn_opening_total_over_prob,espn_kalshi_prob_gap,kalshi_price_source,kalshi_price_captured_at,latest_live_over_prob,latest_live_captured_at',
    )
    .eq('match_id', matchId)
    .order('kalshi_line_value', { ascending: true });

  if (error) throw error;
  return (data ?? []) as KalshiDivergenceAnchorRow[];
}
