
import { supabase } from '../lib/supabase';
import { MatchNews, PlayerPropBet } from '../types';
import { MatchInsight, TeamTrend } from '../types/historicalIntel';

// ═══════════════════════════════════════════════════════════════════════════
// CACHE TTL CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

export const CACHE_TTL = {
  VENUE: 24 * 60 * 60 * 1000,    // 24 hours
  NEWS: 2 * 60 * 60 * 1000,      // 2 hours
  REF: 12 * 60 * 60 * 1000,      // 12 hours
  ANGLE: 1 * 60 * 60 * 1000,    // 1 hour
  NARRATIVE: 2 * 60 * 60 * 1000, // 2 hours
  BOX_SCORE: 5 * 60 * 1000,      // 5 minutes (live games)
  EDGE: 15 * 60 * 1000,          // 15 minutes
  DAILY_ANGLE: 4 * 60 * 60 * 1000, // 4 hours
  STADIUM: 30 * 24 * 60 * 60 * 1000 // 30 days (Static data)
};

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface CacheResult<T> {
  data: T;
  isStale: boolean;
}

type DbValue = string | number | boolean | null | DbValue[] | { [key: string]: DbValue };

export interface DailyAngleRecord {
  id: string;
  date: string;
  match_id: string;
  headline: string;
  content: DbValue; // MatchAngle type
}

export interface TeamMetrics {
  team_name: string;
  rank: number | null;
  pace: number | null;
  defensive_rating: number | null;
  offensive_rating: number | null;
  net_rating: number | null;
  turnover_pct: number | null;
  games_played: number | null;
  updated_at: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// CORE CACHE FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

export async function getCachedData<T>(
  table: string,
  keyField: string,
  keyValue: string,
  ttl: number
): Promise<CacheResult<T> | null> {
  const { data, error } = await supabase
    .from(table)
    .select('content, fetched_at')
    .eq(keyField, keyValue)
    .maybeSingle();

  if (error || !data) return null;

  const fetchedAt = new Date(data.fetched_at).getTime();
  const isStale = Date.now() - fetchedAt > ttl;

  return {
    data: data.content as T,
    isStale,
  };
}

export async function cacheData(
  table: string,
  conflictField: string,
  payload: Record<string, DbValue>
): Promise<void> {
  await supabase
    .from(table)
    .upsert({
      ...payload,
      fetched_at: new Date().toISOString()
    }, { onConflict: conflictField });
}

// ═══════════════════════════════════════════════════════════════════════════
// DOMAIN-SPECIFIC METHODS
// ═══════════════════════════════════════════════════════════════════════════

export const dbService = {
  // Venue Intel
  getVenueData: (matchId: string) =>
    getCachedData('venue_intel', 'match_id', matchId, CACHE_TTL.VENUE),
  cacheVenueData: (matchId: string, venue: DbValue) =>
    cacheData('venue_intel', 'match_id', { match_id: matchId, content: venue }),

  // Stadium Lookups (Canonical)
  getStadiumByEspnId: async (espnId: number) => {
    const { data, error } = await supabase
      .from('stadiums')
      .select('*')
      .eq('espn_id', espnId)
      .maybeSingle();

    if (error || !data) return null;
    return data;
  },

  // Team News (Legacy - kept for reference, but prefer getMatchNews)
  getTeamNews: (homeTeam: string, awayTeam: string) => {
    const cacheKey = `${homeTeam}-${awayTeam}`.toLowerCase().replace(/\s+/g, '-');
    return getCachedData('news_intel', 'cache_key', cacheKey, CACHE_TTL.NEWS);
  },
  cacheTeamNews: (homeTeam: string, awayTeam: string, news: DbValue) => {
    const cacheKey = `${homeTeam}-${awayTeam}`.toLowerCase().replace(/\s+/g, '-');
    return cacheData('news_intel', 'cache_key', {
      cache_key: cacheKey,
      home_team: homeTeam,
      away_team: awayTeam,
      content: news,
    });
  },

  // Match News (Deep Intel from Edge Function)
  getMatchNews: async (matchId: string): Promise<CacheResult<MatchNews> | null> => {
    const { data, error } = await supabase
      .from('match_news')
      .select('*')
      .eq('match_id', matchId)
      .maybeSingle();

    if (error || !data) return null;

    const isStale = new Date() > new Date(data.expires_at);

    // Map snake_case DB columns to MatchNews camelCase type
    const mapped: MatchNews = {
      matchId: data.match_id,
      report: data.report || '',
      keyInjuries: data.key_injuries || [],
      bettingFactors: data.betting_factors || [],
      lineMovement: data.line_movement,
      weather: data.weather_forecast,
      fatigue: data.fatigue,
      officials: data.officials,
      sources: data.sources || [],
      status: data.status,
      sharp_data: data.sharp_data,
      generatedAt: data.generated_at,
      expiresAt: data.expires_at
    };

    return {
      data: mapped,
      isStale
    };
  },
  cacheMatchNews: (matchId: string, news: MatchNews) => {
    return cacheData('match_news', 'match_id', {
      match_id: matchId,
      report: news.report,
      key_injuries: news.keyInjuries,
      betting_factors: news.bettingFactors,
      line_movement: news.lineMovement,
      weather_forecast: news.weather,
      fatigue: news.fatigue,
      officials: news.officials,
      sources: news.sources,
      status: news.status,
      sharp_data: news.sharp_data,
      generated_at: news.generatedAt,
      expires_at: news.expiresAt
    });
  },

  // Player Props
  getPlayerProps: async (matchId: string): Promise<PlayerPropBet[]> => {
    // Fuzzy match to handle suffixed vs raw IDs
    const { data, error } = await supabase
      .from('player_prop_bets')
      .select('*')
      .ilike('match_id', `${matchId}%`)
      .order('player_name', { ascending: true });

    if (error || !data) return [];

    // Convert DB numeric types to number if needed (Postgres numeric comes as string/number)
    return data.map(d => ({
      ...d,
      lineValue: Number(d.line_value),
      oddsAmerican: Number(d.odds_american),
      marketLabel: d.market_label || d.bet_type // Fallback
    })) as unknown as PlayerPropBet[];
  },

  // Referee Intel
  getRefIntel: async (matchId: string): Promise<CacheResult<any> | null> => {
    // We use ILIKE and % to handle cases where the DB ID might have a sport suffix (e.g. 401810228_nba)
    const { data, error } = await supabase
      .from('ref_intel')
      .select('content, fetched_at')
      .ilike('match_id', `${matchId}%`)
      .maybeSingle();

    if (error || !data) return null;

    const fetchedAt = new Date(data.fetched_at).getTime();
    const isStale = Date.now() - fetchedAt > CACHE_TTL.REF;

    return {
      data: data.content,
      isStale,
    };
  },
  cacheRefIntel: (matchId: string, intel: DbValue) =>
    cacheData('ref_intel', 'match_id', { match_id: matchId, content: intel }),

  // Match Angle (Specific Match - generated on demand)
  getMatchAngle: (matchId: string) =>
    getCachedData('match_thesis', 'match_id', matchId, CACHE_TTL.ANGLE),
  cacheMatchAngle: (matchId: string, angle: DbValue) =>
    cacheData('match_thesis', 'match_id', { match_id: matchId, content: angle }),

  // Narrative Intel
  getNarrativeIntel: (matchId: string) =>
    getCachedData('narrative_intel', 'match_id', matchId, CACHE_TTL.NARRATIVE),
  cacheNarrativeIntel: (matchId: string, intel: DbValue) =>
    cacheData('narrative_intel', 'match_id', { match_id: matchId, content: intel }),

  // Edge Analysis
  getEdgeAnalysis: (matchId: string) =>
    getCachedData('edge_analysis', 'match_id', matchId, CACHE_TTL.EDGE),
  cacheEdgeAnalysis: (matchId: string, edge: DbValue) =>
    cacheData('edge_analysis', 'match_id', { match_id: matchId, content: edge }),

  // Deep Intel (JSON mode analysis)
  getCachedIntel: (matchId: string) =>
    getCachedData('deep_intel', 'match_id', matchId, CACHE_TTL.EDGE),
  cacheIntel: (matchId: string, intel: DbValue) =>
    cacheData('deep_intel', 'match_id', { match_id: matchId, content: intel }),

  // Versioned AISignals (Write-Once)
  storeAISignalSnapshot: async (matchId: string, signals: DbValue) => {
    await supabase
      .from('ai_signal_snapshots')
      .insert({
        match_id: matchId,
        signals: signals,
        system_state: signals.system_state,
        fetched_at: new Date().toISOString()
      });
  },

  // Box Score
  getBoxScore: (matchId: string) =>
    getCachedData('box_scores', 'match_id', matchId, CACHE_TTL.BOX_SCORE),
  cacheBoxScore: (matchId: string, boxScore: DbValue) =>
    cacheData('box_scores', 'match_id', { match_id: matchId, content: boxScore }),

  // Daily Angle (Cron Generated - Global)
  getDailyAngle: async (): Promise<DailyAngleRecord | null> => {
    // Get today's date YYYY-MM-DD
    const today = new Date().toISOString().split('T')[0];

    const { data, error } = await supabase
      .from('daily_thesis')
      .select('*')
      .eq('date', today)
      .maybeSingle();

    if (error || !data) return null;
    return data as DailyAngleRecord;
  },

  // Historical Intelligence Lookups
  getMatchInsights: async (matchId: string): Promise<MatchInsight[]> => {
    const { data, error } = await supabase
      .from('match_insights')
      .select('*')
      .eq('match_id', matchId)
      .eq('is_active', true)
      .order('impact_level', { ascending: false });

    if (error || !data) return [];
    return data as MatchInsight[];
  },

  getTeamTrend: async (teamId: string, sport: string, context: 'OVERALL' | 'HOME' | 'AWAY' = 'OVERALL'): Promise<TeamTrend | null> => {
    const { data, error } = await supabase
      .from('team_trends')
      .select('*')
      .eq('team_id', teamId)
      .eq('sport', sport)
      .eq('context', context)
      .maybeSingle();

    if (error || !data) return null;
    return data as TeamTrend;
  },

  // Team Metrics (Pace, ORtg, DRtg)
  getTeamMetrics: async (teamName: string): Promise<TeamMetrics | null> => {
    // First try exact match
    const { data: exactMatch, error: exactError } = await supabase
      .from('team_metrics')
      .select('*')
      .eq('team_name', teamName)
      .maybeSingle();

    if (exactMatch) return exactMatch as TeamMetrics;

    // Fuzzy match: try to find team by partial name
    // E.g. "Atlanta Hawks" should match "Atlanta"
    const shortName = teamName.split(' ')[0]; // Get first word (e.g. "Atlanta" from "Atlanta Hawks")
    const { data: fuzzyMatch, error: fuzzyError } = await supabase
      .from('team_metrics')
      .select('*')
      .ilike('team_name', `%${shortName}%`)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fuzzyError || !fuzzyMatch) return null;
    return fuzzyMatch as TeamMetrics;
  },

  // Player Prop Streaks
  getPlayerPropStreaks: async (teamName?: string): Promise<any[]> => {
    let query = supabase
      .from('player_prop_streaks')
      .select('*')
      .eq('is_active', true)
      .order('streak_count', { ascending: false });

    if (teamName) {
      query = query.ilike('team', `%${teamName}%`);
    }

    const { data, error } = await query;
    if (error || !data) return [];
    return data;
  }
};
