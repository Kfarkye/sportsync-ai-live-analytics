import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

declare const Deno: any;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ESPN_SUMMARY_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const FETCH_TIMEOUT_MS = 15000;
const MAX_CONCURRENT = 3;

const STATUS_FINAL_SET = [
  'STATUS_FINAL',
  'STATUS_FULL_TIME',
  'STATUS_AET',
  'STATUS_PENALTIES',
];

const SOCCER_LEAGUE_ALIAS: Record<string, string> = {
  epl: 'eng.1',
  laliga: 'esp.1',
  seriea: 'ita.1',
  bundesliga: 'ger.1',
  ligue1: 'fra.1',
  mls: 'usa.1',
  ucl: 'uefa.champions',
  uel: 'uefa.europa',
};

interface MatchRow {
  id: string;
  league_id: string;
  home_team: string | null;
  away_team: string | null;
  start_time: string;
  status: string | null;
}

function asString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function asInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string') {
    const parsed = parseInt(value.trim(), 10);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function stripLeagueSuffix(matchId: string): string {
  return matchId.replace(/_[a-z0-9.]+$/i, '');
}

function resolveLeagueSlug(leagueId: string): string {
  const lowered = leagueId.toLowerCase();
  return SOCCER_LEAGUE_ALIAS[lowered] ?? lowered;
}

function parseLeagueFilter(raw: string | null): string[] {
  if (!raw) return [];
  const requested = raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  const expanded = new Set<string>();
  for (const league of requested) {
    expanded.add(league);
    expanded.add(resolveLeagueSlug(league));
  }

  return Array.from(expanded);
}

async function fetchJsonWithTimeout(url: string): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function readPlayerStat(stats: any[], aliases: string[]): number | null {
  if (!Array.isArray(stats) || stats.length === 0) return null;
  const aliasSet = aliases.map((name) => name.toLowerCase());

  for (const stat of stats) {
    const candidates = [stat?.name, stat?.abbreviation, stat?.shortDisplayName]
      .map((value: any) => asString(value)?.toLowerCase())
      .filter(Boolean) as string[];

    if (!candidates.some((candidate) => aliasSet.includes(candidate))) continue;
    const value = asInt(stat?.value) ?? asInt(stat?.displayValue);
    if (value !== null) return value;
  }

  return null;
}

function extractRowsForMatch(match: MatchRow, summary: any, capturedAt: string): any[] {
  const rosters = Array.isArray(summary?.rosters) ? summary.rosters : [];
  const gameDate = match.start_time?.slice(0, 10) ?? null;
  const rows: any[] = [];

  for (const roster of rosters) {
    const side = asString(roster?.homeAway);
    if (!side) continue;

    const team = asString(roster?.team?.displayName) ?? (side === 'home' ? match.home_team : match.away_team);
    const opponent = side === 'home' ? match.away_team : match.home_team;
    const players = Array.isArray(roster?.roster) ? roster.roster : [];

    for (const player of players) {
      const playerId = asString(player?.athlete?.id);
      const playerName = asString(player?.athlete?.displayName) ?? asString(player?.athlete?.fullName);
      if (!playerId || !playerName) continue;

      const stats = Array.isArray(player?.stats) ? player.stats : [];
      rows.push({
        match_id: match.id,
        espn_event_id: stripLeagueSuffix(match.id),
        league_id: resolveLeagueSlug(match.league_id),
        game_date: gameDate,
        team,
        opponent,
        player_id: playerId,
        player_name: playerName,
        position: asString(player?.position?.abbreviation) ?? asString(player?.position?.displayName),
        minutes: readPlayerStat(stats, ['minutesPlayed', 'minutes', 'mins']),
        is_starter: player?.starter === true,
        goals: readPlayerStat(stats, ['totalGoals', 'goals']),
        assists: readPlayerStat(stats, ['goalAssists', 'assists']),
        shots: readPlayerStat(stats, ['totalShots', 'shots']),
        shots_on_target: readPlayerStat(stats, ['shotsOnTarget', 'shotsOnGoal', 'sot']),
        key_passes: readPlayerStat(stats, ['keyPasses', 'chancesCreated']),
        yellow_cards: readPlayerStat(stats, ['yellowCards', 'yc']),
        red_cards: readPlayerStat(stats, ['redCards', 'rc']),
        source: 'espn_summary',
        updated_at: capturedAt,
      });
    }
  }

  return rows;
}

async function processInBatches<T>(items: T[], maxConcurrent: number, fn: (item: T) => Promise<void>): Promise<void> {
  for (let index = 0; index < items.length; index += maxConcurrent) {
    const batch = items.slice(index, index + maxConcurrent);
    await Promise.allSettled(batch.map((item) => fn(item)));
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    const url = new URL(req.url);
    const days = Math.max(1, Math.min(120, parseInt(url.searchParams.get('days') || '30', 10)));
    const limit = Math.max(10, Math.min(600, parseInt(url.searchParams.get('limit') || '120', 10)));
    const dryRun = url.searchParams.get('dry') === 'true';
    const requestedLeagues = parseLeagueFilter(url.searchParams.get('league'));

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    let matchQuery = supabase
      .from('matches')
      .select('id, league_id, home_team, away_team, start_time, status')
      .eq('sport', 'soccer')
      .in('status', STATUS_FINAL_SET)
      .gte('start_time', cutoff.toISOString())
      .order('start_time', { ascending: false })
      .limit(limit);

    if (requestedLeagues.length > 0) {
      matchQuery = matchQuery.in('league_id', requestedLeagues);
    }

    const { data: matches, error: matchesError } = await matchQuery;
    if (matchesError) {
      throw new Error(`matches query failed: ${matchesError.message}`);
    }

    if (!matches || matches.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No finalized soccer matches in range',
        scanned_matches: 0,
        prepared_rows: 0,
        upserts: 0,
      }, null, 2), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const rows: any[] = [];
    const errors: string[] = [];
    const capturedAt = new Date().toISOString();

    await processInBatches(matches as MatchRow[], MAX_CONCURRENT, async (match) => {
      const leagueSlug = resolveLeagueSlug(match.league_id);
      const eventId = stripLeagueSuffix(match.id);
      const sourceUrl = `${ESPN_SUMMARY_BASE}/${leagueSlug}/summary?event=${eventId}`;

      try {
        const summary = await fetchJsonWithTimeout(sourceUrl);
        rows.push(...extractRowsForMatch(match, summary, capturedAt));
      } catch (error: any) {
        errors.push(`${match.id}: ${error?.message || 'summary_fetch_failed'}`);
      }
    });

    let upserted = 0;
    if (!dryRun && rows.length > 0) {
      for (let index = 0; index < rows.length; index += 250) {
        const batch = rows.slice(index, index + 250);
        const { error: upsertError } = await supabase
          .from('soccer_player_match_stats')
          .upsert(batch, { onConflict: 'match_id,player_id' });

        if (upsertError) {
          errors.push(`batch_${Math.floor(index / 250)}: ${upsertError.message}`);
          continue;
        }

        upserted += batch.length;
      }
    }

    const leaguesTouched = Array.from(new Set(rows.map((row) => row.league_id)));

    return new Response(JSON.stringify({
      success: errors.length === 0,
      dryRun,
      scanned_matches: matches.length,
      prepared_rows: rows.length,
      upserts: upserted,
      leagues_touched: leaguesTouched,
      errors_count: errors.length,
      errors: errors.slice(0, 30),
      sample: rows.slice(0, 3),
    }, null, 2), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({
      success: false,
      error: error?.message || 'sync_failed',
    }, null, 2), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
