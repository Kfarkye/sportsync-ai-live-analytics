import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

declare const Deno: any;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ESPN_SUMMARY_BASE = 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary';
const FETCH_TIMEOUT_MS = 15000;
const MAX_CONCURRENT = 4;

const HIGH_CONFIDENCE = 0.93;
const MEDIUM_CONFIDENCE = 0.64;
const LOW_CONFIDENCE = 0.28;

interface MatchRow {
  id: string;
  start_time: string;
  status: string | null;
  home_team: string | null;
  away_team: string | null;
}

interface LineupPlayer {
  order: number | null;
  player_id: string | null;
  player_name: string;
  position: string | null;
  starter: boolean;
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

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return LOW_CONFIDENCE;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return Math.round(value * 1000) / 1000;
}

async function fetchJsonWithTimeout(url: string): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: ctrl.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function normalizeLineupPlayers(rawPlayers: any[]): LineupPlayer[] {
  const players = rawPlayers
    .map((entry) => {
      const playerName = asString(entry?.athlete?.displayName) ?? asString(entry?.athlete?.fullName);
      if (!playerName) return null;

      return {
        order: asInt(entry?.batOrder) ?? asInt(entry?.battingOrder) ?? asInt(entry?.order),
        player_id: asString(entry?.athlete?.id),
        player_name: playerName,
        position: asString(entry?.position?.abbreviation) ?? asString(entry?.position?.displayName),
        starter: entry?.starter === true,
      } as LineupPlayer;
    })
    .filter((entry): entry is LineupPlayer => Boolean(entry));

  const withOrder = players.filter((entry) => entry.order !== null).sort((a, b) => (a.order as number) - (b.order as number));
  if (withOrder.length >= 9) {
    return withOrder.slice(0, 9);
  }

  const starters = players.filter((entry) => entry.starter === true);
  if (starters.length > 0) {
    return starters.slice(0, 9).map((entry, index) => ({ ...entry, order: entry.order ?? index + 1 }));
  }

  return players.slice(0, 9).map((entry, index) => ({ ...entry, order: entry.order ?? index + 1 }));
}

function resolveConfidence(lineup: LineupPlayer[], confirmed: boolean): number {
  if (confirmed) return HIGH_CONFIDENCE;
  if (lineup.length >= 7) return MEDIUM_CONFIDENCE;
  if (lineup.length > 0) return 0.46;
  return LOW_CONFIDENCE;
}

function extractTeamLineup(summary: any, side: 'home' | 'away', match: MatchRow, sourceUrl: string, capturedAt: string) {
  const competition = summary?.header?.competitions?.[0];
  const competitors = Array.isArray(competition?.competitors) ? competition.competitors : [];
  const competitor = competitors.find((entry: any) => entry?.homeAway === side) ?? null;
  const teamName = asString(competitor?.team?.displayName) ?? (side === 'home' ? match.home_team : match.away_team);
  if (!teamName) return null;

  const rosters = Array.isArray(summary?.rosters) ? summary.rosters : [];
  const roster = rosters.find((entry: any) => entry?.homeAway === side) ?? null;
  const rawPlayers = Array.isArray(roster?.roster) ? roster.roster : [];
  const lineup = normalizeLineupPlayers(rawPlayers);

  const hasCompleteOrder = lineup.length >= 9 && lineup.every((entry) => entry.order !== null);
  const confirmed = hasCompleteOrder;
  const confidenceScore = resolveConfidence(lineup, confirmed);

  return {
    game_id: match.id,
    team: teamName,
    batting_order: lineup,
    confirmed,
    source: 'espn_summary',
    source_url: sourceUrl,
    captured_at: capturedAt,
    confidence_score: clampConfidence(confidenceScore),
    raw_payload: {
      event_id: stripLeagueSuffix(match.id),
      side,
      status: asString(competition?.status?.type?.name) ?? match.status,
      lineup_count: lineup.length,
      has_complete_order: hasCompleteOrder,
      probable_pitcher: competitor?.probables?.[0]?.athlete?.displayName ?? competitor?.probables?.[0]?.displayName ?? null,
    },
    updated_at: capturedAt,
  };
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
    const days = Math.max(1, Math.min(7, parseInt(url.searchParams.get('days') || '2', 10)));
    const limit = Math.max(10, Math.min(250, parseInt(url.searchParams.get('limit') || '80', 10)));
    const dryRun = url.searchParams.get('dry') === 'true';

    const now = new Date();
    const windowStart = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString();
    const windowEnd = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();

    const { data: matches, error: matchesError } = await supabase
      .from('matches')
      .select('id, start_time, status, home_team, away_team')
      .eq('league_id', 'mlb')
      .gte('start_time', windowStart)
      .lte('start_time', windowEnd)
      .in('status', ['STATUS_SCHEDULED', 'STATUS_IN_PROGRESS'])
      .order('start_time', { ascending: true })
      .limit(limit);

    if (matchesError) {
      throw new Error(`matches query failed: ${matchesError.message}`);
    }

    if (!matches || matches.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No MLB matches in lineup sync window',
        scanned_matches: 0,
        upserts: 0,
      }, null, 2), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    const upsertRows: any[] = [];
    const errors: string[] = [];
    const capturedAt = new Date().toISOString();

    await processInBatches(matches as MatchRow[], MAX_CONCURRENT, async (match) => {
      const eventId = stripLeagueSuffix(match.id);
      const sourceUrl = `${ESPN_SUMMARY_BASE}?event=${eventId}`;

      try {
        const summary = await fetchJsonWithTimeout(sourceUrl);
        const homeRow = extractTeamLineup(summary, 'home', match, sourceUrl, capturedAt);
        const awayRow = extractTeamLineup(summary, 'away', match, sourceUrl, capturedAt);

        if (homeRow) upsertRows.push(homeRow);
        if (awayRow) upsertRows.push(awayRow);
      } catch (error: any) {
        errors.push(`${match.id}: ${error?.message || 'summary_fetch_failed'}`);
      }
    });

    let upserted = 0;
    if (!dryRun && upsertRows.length > 0) {
      const { error: upsertError } = await supabase
        .from('mlb_projected_lineups')
        .upsert(upsertRows, { onConflict: 'game_id,team,source' });

      if (upsertError) {
        throw new Error(`mlb_projected_lineups upsert failed: ${upsertError.message}`);
      }

      upserted = upsertRows.length;
    }

    return new Response(JSON.stringify({
      success: errors.length === 0,
      dryRun,
      scanned_matches: matches.length,
      prepared_rows: upsertRows.length,
      upserts: upserted,
      errors_count: errors.length,
      errors: errors.slice(0, 25),
      sample: upsertRows.slice(0, 2),
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
