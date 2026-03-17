/**
 * Postgame Data Layer — Supabase queries for match and team pages
 * 
 * Every query hits soccer_postgame. One row = one match page.
 * Team page = aggregate of all rows where team appears as home or away.
 */

import { supabase } from './supabase';

// ─── Types ─────────────────────────────────────────────────────

export interface SoccerPostgame {
  id: string;
  match_id: string | null;
  espn_event_id: string | null;
  league_id: string;
  home_team: string;
  away_team: string;
  home_score: number;
  away_score: number;
  match_status: string;
  start_time: string;
  venue: string | null;
  attendance: number | null;
  referee: string | null;

  // Possession & Shots
  home_possession: number | null;
  away_possession: number | null;
  home_shots: number | null;
  away_shots: number | null;
  home_shots_on_target: number | null;
  away_shots_on_target: number | null;
  home_shot_accuracy: number | null;
  away_shot_accuracy: number | null;

  // Passing
  home_passes: number | null;
  away_passes: number | null;
  home_accurate_passes: number | null;
  away_accurate_passes: number | null;
  home_pass_pct: number | null;
  away_pass_pct: number | null;
  home_crosses: number | null;
  away_crosses: number | null;
  home_accurate_crosses: number | null;
  away_accurate_crosses: number | null;
  home_long_balls: number | null;
  away_long_balls: number | null;
  home_accurate_long_balls: number | null;
  away_accurate_long_balls: number | null;

  // Set Pieces & Discipline
  home_corners: number | null;
  away_corners: number | null;
  home_offsides: number | null;
  away_offsides: number | null;
  home_fouls: number | null;
  away_fouls: number | null;
  home_yellow_cards: number | null;
  away_yellow_cards: number | null;
  home_red_cards: number | null;
  away_red_cards: number | null;

  // Defense
  home_saves: number | null;
  away_saves: number | null;
  home_tackles: number | null;
  away_tackles: number | null;
  home_effective_tackles: number | null;
  away_effective_tackles: number | null;
  home_interceptions: number | null;
  away_interceptions: number | null;
  home_clearances: number | null;
  away_clearances: number | null;
  home_blocked_shots: number | null;
  away_blocked_shots: number | null;

  // Events (JSONB)
  goals: any[] | null;
  cards: any[] | null;
  substitutions: any[] | null;
  timeline: any[] | null;
  home_scorers: string[] | null;
  away_scorers: string[] | null;
  home_lineup: any | null;
  away_lineup: any | null;

  // DK Closing Odds
  dk_home_ml: number | null;
  dk_away_ml: number | null;
  dk_draw_ml: number | null;
  dk_spread: number | null;
  dk_home_spread_price: number | null;
  dk_away_spread_price: number | null;
  dk_total: number | null;
  dk_over_price: number | null;
  dk_under_price: number | null;
}

// ─── Derived Betting Computations ──────────────────────────────

export type SpreadResult = 'covered' | 'failed' | 'push';
export type TotalResult = 'over' | 'under' | 'push';
export type MLResult = 'home' | 'away' | 'draw';

/** Determine if the home team covered the spread */
export function getSpreadResult(match: SoccerPostgame): { result: SpreadResult; margin: number } | null {
  if (match.dk_spread == null) return null;
  const spread = Number(match.dk_spread);
  const homeMargin = match.home_score - match.away_score;
  const adjustedMargin = homeMargin + spread;
  if (adjustedMargin > 0) return { result: 'covered', margin: adjustedMargin };
  if (adjustedMargin < 0) return { result: 'failed', margin: Math.abs(adjustedMargin) };
  return { result: 'push', margin: 0 };
}

/** Determine over/under result */
export function getTotalResult(match: SoccerPostgame): { result: TotalResult; actual: number } | null {
  if (match.dk_total == null) return null;
  const total = Number(match.dk_total);
  const actual = match.home_score + match.away_score;
  if (actual > total) return { result: 'over', actual };
  if (actual < total) return { result: 'under', actual };
  return { result: 'push', actual };
}

/** Determine moneyline result */
export function getMLResult(match: SoccerPostgame): MLResult {
  if (match.home_score > match.away_score) return 'home';
  if (match.away_score > match.home_score) return 'away';
  return 'draw';
}

/** Convert American odds to implied probability */
export function impliedProb(americanOdds: number): number {
  if (americanOdds < 0) return Math.abs(americanOdds) / (Math.abs(americanOdds) + 100);
  return 100 / (americanOdds + 100);
}

/** Format American odds with sign */
export function fmtOdds(odds: number | null): string {
  if (odds == null) return '—';
  return odds > 0 ? `+${odds}` : `${odds}`;
}

// ─── Supabase Queries ──────────────────────────────────────────

/** Fetch a single match by slug components */
export async function fetchMatchBySlug(
  homeSlug: string,
  awaySlug: string,
  date: string
): Promise<SoccerPostgame | null> {
  // Convert slug back to search terms: "arsenal" → "%arsenal%"
  const homeSearch = homeSlug.replace(/-/g, ' ');
  const awaySearch = awaySlug.replace(/-/g, ' ');

  const { data, error } = await supabase
    .from('soccer_postgame')
    .select('*')
    .ilike('home_team', `%${homeSearch}%`)
    .ilike('away_team', `%${awaySearch}%`)
    .gte('start_time', `${date}T00:00:00Z`)
    .lt('start_time', `${date}T23:59:59Z`)
    .limit(1)
    .single();

  if (error || !data) return null;
  return data as SoccerPostgame;
}

/** Fetch all matches for a team (home or away) */
export async function fetchTeamMatches(
  teamSearchTerm: string,
  leagueId?: string
): Promise<SoccerPostgame[]> {
  const search = teamSearchTerm.replace(/-/g, ' ');

  let query = supabase
    .from('soccer_postgame')
    .select('*')
    .or(`home_team.ilike.%${search}%,away_team.ilike.%${search}%`)
    .order('start_time', { ascending: false });

  if (leagueId) {
    query = query.eq('league_id', leagueId);
  }

  const { data, error } = await query;
  if (error || !data) return [];
  return data as SoccerPostgame[];
}

/** Fetch all matches for a league */
export async function fetchLeagueMatches(leagueId: string): Promise<SoccerPostgame[]> {
  const { data, error } = await supabase
    .from('soccer_postgame')
    .select('*')
    .eq('league_id', leagueId)
    .order('start_time', { ascending: false });

  if (error || !data) return [];
  return data as SoccerPostgame[];
}

/** Fetch all matches across all leagues */
export async function fetchAllMatches(): Promise<SoccerPostgame[]> {
  const { data, error } = await supabase
    .from('soccer_postgame')
    .select('*')
    .order('start_time', { ascending: false });

  if (error || !data) return [];
  return data as SoccerPostgame[];
}

/** Fetch distinct league IDs from soccer postgame table */
export async function fetchLeagueIds(): Promise<string[]> {
  const { data, error } = await supabase
    .from('soccer_postgame')
    .select('league_id')
    .not('league_id', 'is', null);

  if (error || !data) return [];

  const set = new Set<string>();
  for (const row of data as Array<{ league_id?: string | null }>) {
    if (row.league_id) set.add(row.league_id);
  }

  return [...set].sort();
}

/** Fetch the most recent N matches with odds */
export async function fetchRecentMatches(limit: number = 50): Promise<SoccerPostgame[]> {
  const { data, error } = await supabase
    .from('soccer_postgame')
    .select('*')
    .not('dk_home_ml', 'is', null)
    .order('start_time', { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  return data as SoccerPostgame[];
}

/** Fetch all distinct teams from postgame data */
export async function fetchTeamsInLeague(leagueId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('soccer_postgame')
    .select('home_team, away_team')
    .eq('league_id', leagueId);

  if (error || !data) return [];

  const teams = new Set<string>();
  data.forEach((row: any) => {
    teams.add(row.home_team);
    teams.add(row.away_team);
  });
  return Array.from(teams).sort();
}

/** Fetch team metadata (logo, league) via canonical resolver with team_logos exact fallback */
export async function fetchTeamMeta(teamName: string) {
  const search = teamName.replace(/-/g, ' ').trim();
  if (!search) return null;

  const isResolverUnavailable = (error: unknown): boolean => {
    const candidate = error as { code?: string; message?: string; details?: string; hint?: string } | null;
    if (!candidate) return false;
    const text = `${candidate.code || ''} ${candidate.message || ''} ${candidate.details || ''} ${candidate.hint || ''}`.toLowerCase();
    return (
      text.includes('pgrst202') ||
      text.includes('42883') ||
      text.includes('resolve_team_logos') ||
      text.includes('could not find the function')
    );
  };

  const resolved = await supabase.rpc('resolve_team_logos', {
    p_names: [search],
    p_league_ids: null,
  });

  if (!resolved.error && Array.isArray(resolved.data) && resolved.data.length > 0) {
    const first = resolved.data[0] as {
      input_name?: unknown;
      canonical_name?: unknown;
      league_id?: unknown;
      logo_url?: unknown;
      match_type?: unknown;
      is_ambiguous?: unknown;
    };

    const logoUrl = typeof first.logo_url === 'string' ? first.logo_url.trim() : '';
    const matchType = typeof first.match_type === 'string' ? first.match_type.toLowerCase() : 'unresolved';
    const ambiguous = first.is_ambiguous === true;

    if (matchType === 'unresolved' || ambiguous) {
      console.warn('[Postgame][resolve_team_logos]', {
        input: search,
        match_type: matchType,
        is_ambiguous: ambiguous,
      });
    }

    if (logoUrl) {
      return {
        name: (typeof first.canonical_name === 'string' && first.canonical_name.trim()) || search,
        logo_url: logoUrl,
        league_id: (typeof first.league_id === 'string' && first.league_id.trim()) || null,
      };
    }
  }

  if (resolved.error && !isResolverUnavailable(resolved.error)) {
    console.warn('[Postgame][resolve_team_logos] RPC error', resolved.error);
  }

  const exact = await supabase
    .from('team_logos')
    .select('team_name, logo_url, league_id')
    .eq('team_name', search)
    .limit(1)
    .maybeSingle();

  if (!exact.error && exact.data) {
    return {
      name: exact.data.team_name,
      logo_url: exact.data.logo_url,
      league_id: exact.data.league_id,
    };
  }

  console.warn('[Postgame][resolve_team_logos]', {
    input: search,
    match_type: 'unresolved',
    is_ambiguous: false,
    fallback: 'team_logos_exact_miss',
  });
  return null;
}

// ─── Team ATS/OU Aggregations ──────────────────────────────────

export interface TeamRecord {
  wins: number;
  draws: number;
  losses: number;
  ats: { covered: number; failed: number; push: number };
  ou: { over: number; under: number; push: number };
  goalsFor: number;
  goalsAgainst: number;
  cleanSheets: number;
}

/** Compute team record from all their matches */
export function computeTeamRecord(matches: SoccerPostgame[], teamName: string): TeamRecord {
  const record: TeamRecord = {
    wins: 0, draws: 0, losses: 0,
    ats: { covered: 0, failed: 0, push: 0 },
    ou: { over: 0, under: 0, push: 0 },
    goalsFor: 0, goalsAgainst: 0, cleanSheets: 0,
  };

  const lowerTeam = teamName.toLowerCase();

  for (const m of matches) {
    const isHome = m.home_team.toLowerCase().includes(lowerTeam);
    const teamScore = isHome ? m.home_score : m.away_score;
    const oppScore = isHome ? m.away_score : m.home_score;

    // Straight-up record
    if (teamScore > oppScore) record.wins++;
    else if (teamScore < oppScore) record.losses++;
    else record.draws++;

    // Goals
    record.goalsFor += teamScore;
    record.goalsAgainst += oppScore;
    if (oppScore === 0) record.cleanSheets++;

    // ATS — spread is always from home perspective
    const spreadResult = getSpreadResult(m);
    if (spreadResult) {
      if (isHome) {
        record.ats[spreadResult.result]++;
      } else {
        // Away: inverse of home spread result
        if (spreadResult.result === 'covered') record.ats.failed++;
        else if (spreadResult.result === 'failed') record.ats.covered++;
        else record.ats.push++;
      }
    }

    // O/U
    const totalResult = getTotalResult(m);
    if (totalResult) {
      record.ou[totalResult.result]++;
    }
  }

  return record;
}
