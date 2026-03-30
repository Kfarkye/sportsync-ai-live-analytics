declare const Deno: any;

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-cron-secret',
  'Content-Type': 'application/json',
};

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports';

const LEAGUE_ENDPOINTS: Record<string, string> = {
  nfl: 'football/nfl',
  'college-football': 'football/college-football',
  ncaaf: 'football/college-football',
  nba: 'basketball/nba',
  wnba: 'basketball/wnba',
  'mens-college-basketball': 'basketball/mens-college-basketball',
  ncaab: 'basketball/mens-college-basketball',
  mlb: 'baseball/mlb',
  nhl: 'hockey/nhl',
  epl: 'soccer/eng.1',
  'eng.1': 'soccer/eng.1',
  seriea: 'soccer/ita.1',
  'ita.1': 'soccer/ita.1',
  laliga: 'soccer/esp.1',
  'esp.1': 'soccer/esp.1',
  bundesliga: 'soccer/ger.1',
  'ger.1': 'soccer/ger.1',
  ligue1: 'soccer/fra.1',
  'fra.1': 'soccer/fra.1',
  mls: 'soccer/usa.1',
  'usa.1': 'soccer/usa.1',
  'mex.1': 'soccer/mex.1',
  ucl: 'soccer/uefa.champions',
  'uefa.champions': 'soccer/uefa.champions',
  uel: 'soccer/uefa.europa',
  'uefa.europa': 'soccer/uefa.europa',
  'ned.1': 'soccer/ned.1',
  'por.1': 'soccer/por.1',
  'bel.1': 'soccer/bel.1',
  'tur.1': 'soccer/tur.1',
  'bra.1': 'soccer/bra.1',
  'arg.1': 'soccer/arg.1',
  'sco.1': 'soccer/sco.1',
  'fifa.friendly': 'soccer/fifa.friendly',
  'fifa.worldq.uefa': 'soccer/fifa.worldq.uefa',
  atp: 'tennis/atp',
  wta: 'tennis/wta',
};

type MatchRow = {
  id: string;
  league_id: string | null;
  sport: string | null;
  status: string | null;
  start_time: string | null;
  home_score: number | null;
  away_score: number | null;
  period: number | null;
  display_clock: string | null;
};

type SummarySnapshot = {
  statusName: string;
  statusState: string;
  statusDetail: string | null;
  period: number | null;
  clock: string | null;
  homeScore: number;
  awayScore: number;
};

type JanitorBody = {
  stale_after_hours?: number;
  lookback_hours?: number;
  max_games?: number;
  leagues?: string[];
  target_match_ids?: string[];
  dry_run?: boolean;
};

function parseBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value !== 'string') return false;
  return ['1', 'true', 'yes', 'y', 'on'].includes(value.trim().toLowerCase());
}

function parsePositiveInt(value: unknown, fallback: number, min = 1, max = 5000): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(Math.floor(n), max));
}

function isLikelyInProgress(status: unknown): boolean {
  const s = String(status || '').toUpperCase();
  return s.includes('IN_PROGRESS') || s.includes('LIVE') || s.includes('HALF');
}

function isFinalStatus(statusName: string, statusState: string, statusDetail: string | null): boolean {
  const joined = `${statusName} ${statusState} ${statusDetail || ''}`.toUpperCase();
  return joined.includes('FINAL')
    || joined.includes('STATUS_FINAL')
    || joined.includes('COMPLETE')
    || joined.includes('FULL_TIME')
    || joined.includes('POST');
}

function eventIdFromMatchId(matchId: string): string {
  const idx = String(matchId || '').indexOf('_');
  return idx > 0 ? matchId.slice(0, idx) : String(matchId || '');
}

function normalizeLeagueId(leagueId: string | null | undefined): string {
  return String(leagueId || '').trim().toLowerCase();
}

function clampTextArray(values: string[], limit = 120): string[] {
  if (values.length <= limit) return values;
  return values.slice(0, limit);
}

async function fetchSummary(matchId: string, leagueId: string, timeoutMs: number): Promise<SummarySnapshot | null> {
  const endpoint = LEAGUE_ENDPOINTS[normalizeLeagueId(leagueId)];
  if (!endpoint) return null;

  const url = `${ESPN_BASE}/${endpoint}/summary?event=${eventIdFromMatchId(matchId)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const data = await res.json();
    const competition = data?.header?.competitions?.[0] || data?.competitions?.[0];
    const statusType = competition?.status?.type ?? {};
    const competitors = Array.isArray(competition?.competitors) ? competition.competitors : [];
    const home = competitors.find((c: any) => String(c?.homeAway || '').toLowerCase() === 'home');
    const away = competitors.find((c: any) => String(c?.homeAway || '').toLowerCase() === 'away');

    return {
      statusName: String(statusType?.name || statusType?.description || '').trim(),
      statusState: String(statusType?.state || '').trim(),
      statusDetail: statusType?.detail ? String(statusType.detail) : null,
      period: Number.isFinite(Number(competition?.status?.period)) ? Number(competition.status.period) : null,
      clock: competition?.status?.displayClock ? String(competition.status.displayClock) : null,
      homeScore: Number.parseInt(String(home?.score ?? '0'), 10) || 0,
      awayScore: Number.parseInt(String(away?.score ?? '0'), 10) || 0,
    };
  } catch {
    return null;
  }
}

async function safeInsertReliabilityLog(supabase: any, payload: Record<string, unknown>) {
  try {
    const { error } = await supabase.from('live_pipeline_reliability_logs').insert(payload);
    if (error) {
      console.warn('[history-janitor] reliability log insert failed:', error.message);
    }
  } catch (err) {
    console.warn('[history-janitor] reliability log insert exception:', String(err));
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  const startedAt = Date.now();
  const reqUrl = new URL(req.url);
  const body: JanitorBody = await req.json().catch(() => ({}));

  const staleAfterHours = parsePositiveInt(
    body.stale_after_hours ?? reqUrl.searchParams.get('stale_after_hours'),
    6,
    1,
    72,
  );
  const lookbackHours = parsePositiveInt(
    body.lookback_hours ?? reqUrl.searchParams.get('lookback_hours'),
    24 * 14,
    6,
    24 * 60,
  );
  const maxGames = parsePositiveInt(
    body.max_games ?? reqUrl.searchParams.get('max_games'),
    400,
    1,
    2000,
  );
  const timeoutMs = parsePositiveInt(reqUrl.searchParams.get('timeout_ms'), 8000, 1000, 20000);
  const dryRun = parseBool(body.dry_run ?? reqUrl.searchParams.get('dry_run'));
  const leagueFilter = new Set(
    (Array.isArray(body.leagues) ? body.leagues : String(reqUrl.searchParams.get('leagues') || '').split(','))
      .map((x) => String(x || '').trim().toLowerCase())
      .filter(Boolean),
  );
  const targetMatchIds = new Set(
    (Array.isArray(body.target_match_ids) ? body.target_match_ids : String(reqUrl.searchParams.get('target_match_ids') || '').split(','))
      .map((x) => String(x || '').trim())
      .filter(Boolean),
  );

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  );

  const nowIso = new Date().toISOString();
  const staleCutoffIso = new Date(Date.now() - staleAfterHours * 60 * 60 * 1000).toISOString();
  const lookbackStartIso = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();
  const triggerType = req.headers.get('x-cron-secret') ? 'scheduled' : 'manual';

  const stats = {
    scanned_games: 0,
    candidate_games: 0,
    finalized_games: 0,
    live_state_writes: 0,
    already_final_games: 0,
    still_live_games: 0,
    skipped_unknown_league: 0,
    fetch_failures: 0,
    update_failures: 0,
    dry_run: dryRun,
    stale_after_hours: staleAfterHours,
    lookback_hours: lookbackHours,
    max_games: maxGames,
    league_filter: [...leagueFilter],
    target_match_ids: [...targetMatchIds],
    detail: [] as string[],
  };

  try {
    let query = supabase
      .from('matches')
      .select('id,league_id,sport,status,start_time,home_score,away_score,period,display_clock')
      .gte('start_time', lookbackStartIso)
      .lte('start_time', staleCutoffIso)
      .order('start_time', { ascending: true })
      .limit(maxGames);

    const { data: rows, error } = await query;
    if (error) throw new Error(`match query failed: ${error.message}`);

    const rawMatches = (rows || []) as MatchRow[];
    stats.scanned_games = rawMatches.length;
    const candidates = rawMatches.filter((match) => {
      if (!match?.id) return false;
      if (targetMatchIds.size > 0 && !targetMatchIds.has(match.id)) return false;
      const leagueId = normalizeLeagueId(match.league_id);
      if (leagueFilter.size > 0 && !leagueFilter.has(leagueId)) return false;
      return isLikelyInProgress(match.status);
    });
    stats.candidate_games = candidates.length;

    for (const match of candidates) {
      const leagueId = normalizeLeagueId(match.league_id);
      if (!LEAGUE_ENDPOINTS[leagueId]) {
        stats.skipped_unknown_league++;
        stats.detail.push(`${match.id}: SKIP_UNKNOWN_LEAGUE(${leagueId || 'null'})`);
        continue;
      }

      const summary = await fetchSummary(match.id, leagueId, timeoutMs);
      if (!summary) {
        stats.fetch_failures++;
        stats.detail.push(`${match.id}: SUMMARY_FETCH_FAILED`);
        continue;
      }

      const finalBySummary = isFinalStatus(summary.statusName, summary.statusState, summary.statusDetail);
      if (!finalBySummary) {
        stats.still_live_games++;
        stats.detail.push(`${match.id}: STILL_${summary.statusName || summary.statusState || 'UNKNOWN'}`);
        continue;
      }

      if (dryRun) {
        stats.finalized_games++;
        stats.live_state_writes++;
        stats.detail.push(`${match.id}: DRY_FINALIZE(${summary.awayScore}-${summary.homeScore})`);
        continue;
      }

      const finalStatus = 'STATUS_FINAL';
      const updatePayload: Record<string, unknown> = {
        status: finalStatus,
        home_score: summary.homeScore,
        away_score: summary.awayScore,
        period: summary.period ?? match.period,
        display_clock: summary.clock ?? match.display_clock,
        updated_at: nowIso,
        last_updated: nowIso,
      };

      const { error: updateErr } = await supabase
        .from('matches')
        .update(updatePayload)
        .eq('id', match.id);
      if (updateErr) {
        stats.update_failures++;
        stats.detail.push(`${match.id}: MATCH_UPDATE_FAILED(${updateErr.message})`);
        continue;
      }

      const statePayload = {
        id: match.id,
        league_id: match.league_id ?? leagueId,
        sport: match.sport ?? 'unknown',
        game_status: finalStatus,
        period: summary.period ?? match.period,
        clock: summary.clock ?? match.display_clock,
        home_score: summary.homeScore,
        away_score: summary.awayScore,
        extra_data: {
          capture_mode: 'repair',
          capture_source: 'history_janitor',
          capture_reason: 'stale_in_progress_status',
          repaired_at: nowIso,
          espn_status_name: summary.statusName,
          espn_status_state: summary.statusState,
          espn_status_detail: summary.statusDetail,
        },
        updated_at: nowIso,
      };
      const { error: stateErr } = await supabase.from('live_game_state').upsert(statePayload, { onConflict: 'id' });
      if (stateErr) {
        stats.update_failures++;
        stats.detail.push(`${match.id}: LIVE_STATE_UPSERT_FAILED(${stateErr.message})`);
        continue;
      }

      stats.finalized_games++;
      stats.live_state_writes++;
      stats.detail.push(`${match.id}: FINALIZED(${summary.awayScore}-${summary.homeScore})`);
    }

    const elapsedMs = Date.now() - startedAt;
    const runStatus = stats.update_failures > 0 || stats.fetch_failures > 0 ? 'replayed' : 'succeeded';
    await safeInsertReliabilityLog(supabase, {
      function_name: 'history-janitor',
      status: runStatus,
      trigger_type: triggerType,
      scanned_games: stats.scanned_games,
      started_games: stats.candidate_games,
      snapshot_writes: 0,
      live_state_writes: stats.live_state_writes,
      pbp_writes: 0,
      missing_games: 0,
      stale_games: stats.still_live_games,
      retries_attempted: stats.candidate_games,
      retries_recovered: stats.finalized_games,
      provider_failures: stats.fetch_failures + stats.update_failures,
      degraded_snapshot_writes: 0,
      metadata: {
        ...stats,
        elapsed_ms: elapsedMs,
        completed_at: new Date().toISOString(),
      },
    });

    return new Response(
      JSON.stringify({
        ok: true,
        status: runStatus,
        elapsed_ms: elapsedMs,
        ...stats,
        detail: clampTextArray(stats.detail, 150),
      }),
      { headers: CORS_HEADERS },
    );
  } catch (err: any) {
    await safeInsertReliabilityLog(supabase, {
      function_name: 'history-janitor',
      status: 'failed',
      trigger_type: triggerType,
      scanned_games: stats.scanned_games,
      started_games: stats.candidate_games,
      snapshot_writes: 0,
      live_state_writes: stats.live_state_writes,
      pbp_writes: 0,
      missing_games: 0,
      stale_games: stats.still_live_games,
      retries_attempted: stats.candidate_games,
      retries_recovered: stats.finalized_games,
      provider_failures: stats.fetch_failures + stats.update_failures + 1,
      degraded_snapshot_writes: 0,
      metadata: {
        ...stats,
        error: err?.message || String(err),
      },
    });
    return new Response(
      JSON.stringify({
        ok: false,
        error: err?.message || String(err),
        ...stats,
      }),
      { status: 500, headers: CORS_HEADERS },
    );
  }
});
