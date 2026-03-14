import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

declare const Deno: any;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ESPN Enrichment Drain v2
// v2: Fixed signal extraction. Market data comes from
//   summary.pickcenter[] (inline), NOT the Core API odds
//   endpoint (returns $ref links). Implied spread derived
//   from ESPN BPI win probability via logistic conversion.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const L = {
  info: (e: string, d: Record<string, any> = {}) => console.log(JSON.stringify({ level: 'INFO', ts: new Date().toISOString(), fn: 'espn-enrichment-drain', event: e, ...d })),
  warn: (e: string, d: Record<string, any> = {}) => console.warn(JSON.stringify({ level: 'WARN', ts: new Date().toISOString(), fn: 'espn-enrichment-drain', event: e, ...d })),
  error: (e: string, d: Record<string, any> = {}) => console.error(JSON.stringify({ level: 'ERROR', ts: new Date().toISOString(), fn: 'espn-enrichment-drain', event: e, ...d })),
};

interface LeagueDef {
  sport: string;
  espnSlug: string;
  suffix: string;
  coreLeague: string;
  hasPredictor: boolean;
  hasAts: boolean;
  // Logistic k-factor for win_prob → implied_spread conversion
  // spread = k * ln(fav_prob / dog_prob)
  spreadK: number;
}

const LEAGUES: Record<string, LeagueDef> = {
  nba:        { sport: 'basketball', espnSlug: 'nba',                     suffix: '_nba',        coreLeague: 'nba',                     hasPredictor: true,  hasAts: true,  spreadK: 6.0 },
  nfl:        { sport: 'football',   espnSlug: 'nfl',                     suffix: '_nfl',        coreLeague: 'nfl',                     hasPredictor: true,  hasAts: true,  spreadK: 6.8 },
  nhl:        { sport: 'hockey',     espnSlug: 'nhl',                     suffix: '_nhl',        coreLeague: 'nhl',                     hasPredictor: true,  hasAts: true,  spreadK: 2.0 },
  mlb:        { sport: 'baseball',   espnSlug: 'mlb',                     suffix: '_mlb',        coreLeague: 'mlb',                     hasPredictor: true,  hasAts: true,  spreadK: 3.5 },
  ncaaf:      { sport: 'football',   espnSlug: 'college-football',        suffix: '_ncaaf',      coreLeague: 'college-football',        hasPredictor: true,  hasAts: true,  spreadK: 7.0 },
  ncaab:      { sport: 'basketball', espnSlug: 'mens-college-basketball', suffix: '_ncaab',      coreLeague: 'mens-college-basketball', hasPredictor: true,  hasAts: true,  spreadK: 6.0 },
  epl:        { sport: 'soccer',     espnSlug: 'eng.1',                   suffix: '_epl',        coreLeague: 'eng.1',                   hasPredictor: true,  hasAts: false, spreadK: 1.5 },
  laliga:     { sport: 'soccer',     espnSlug: 'esp.1',                   suffix: '_laliga',     coreLeague: 'esp.1',                   hasPredictor: true,  hasAts: false, spreadK: 1.5 },
  seriea:     { sport: 'soccer',     espnSlug: 'ita.1',                   suffix: '_seriea',     coreLeague: 'ita.1',                   hasPredictor: true,  hasAts: false, spreadK: 1.5 },
  bundesliga: { sport: 'soccer',     espnSlug: 'ger.1',                   suffix: '_bundesliga', coreLeague: 'ger.1',                   hasPredictor: true,  hasAts: false, spreadK: 1.5 },
  ligue1:     { sport: 'soccer',     espnSlug: 'fra.1',                   suffix: '_ligue1',     coreLeague: 'fra.1',                   hasPredictor: true,  hasAts: false, spreadK: 1.5 },
  mls:        { sport: 'soccer',     espnSlug: 'usa.1',                   suffix: '_mls',        coreLeague: 'usa.1',                   hasPredictor: true,  hasAts: false, spreadK: 1.5 },
  fifawc:     { sport: 'soccer',     espnSlug: 'fifa.world',              suffix: '_fifawc',     coreLeague: 'fifa.world',              hasPredictor: true,  hasAts: false, spreadK: 1.5 },
  ucl:        { sport: 'soccer',     espnSlug: 'uefa.champions',          suffix: '_ucl',        coreLeague: 'uefa.champions',          hasPredictor: true,  hasAts: false, spreadK: 1.5 },
  'ned.1':    { sport: 'soccer',     espnSlug: 'ned.1',                   suffix: '_ned.1',      coreLeague: 'ned.1',                   hasPredictor: true,  hasAts: false, spreadK: 1.5 },
  'por.1':    { sport: 'soccer',     espnSlug: 'por.1',                   suffix: '_por.1',      coreLeague: 'por.1',                   hasPredictor: true,  hasAts: false, spreadK: 1.5 },
  'bel.1':    { sport: 'soccer',     espnSlug: 'bel.1',                   suffix: '_bel.1',      coreLeague: 'bel.1',                   hasPredictor: true,  hasAts: false, spreadK: 1.5 },
  'tur.1':    { sport: 'soccer',     espnSlug: 'tur.1',                   suffix: '_tur.1',      coreLeague: 'tur.1',                   hasPredictor: true,  hasAts: false, spreadK: 1.5 },
  'bra.1':    { sport: 'soccer',     espnSlug: 'bra.1',                   suffix: '_bra.1',      coreLeague: 'bra.1',                   hasPredictor: true,  hasAts: false, spreadK: 1.5 },
  'arg.1':    { sport: 'soccer',     espnSlug: 'arg.1',                   suffix: '_arg.1',      coreLeague: 'arg.1',                   hasPredictor: true,  hasAts: false, spreadK: 1.5 },
  'sco.1':    { sport: 'soccer',     espnSlug: 'sco.1',                   suffix: '_sco.1',      coreLeague: 'sco.1',                   hasPredictor: true,  hasAts: false, spreadK: 1.5 },
};

const ESPN_SITE = 'https://site.api.espn.com/apis/site/v2/sports';
const FETCH_TIMEOUT = 12000;
const MAX_CONCURRENT = 3;
const INTER_BATCH_DELAY_MS = 300;

async function safeFetch(url: string, label: string): Promise<{ data: any; ok: boolean; error?: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return { data: null, ok: false, error: `${label}: HTTP ${res.status}` };
    const data = await res.json();
    return { data, ok: true };
  } catch (e: any) {
    return { data: null, ok: false, error: `${label}: ${e.message}` };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function parallelLimit<T>(tasks: (() => Promise<T>)[], limit: number, delayMs = INTER_BATCH_DELAY_MS): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < tasks.length; i += limit) {
    const batch = tasks.slice(i, i + limit);
    const batchResults = await Promise.all(batch.map(fn => fn()));
    for (let j = 0; j < batchResults.length; j++) {
      results[i + j] = batchResults[j];
    }
    if (i + limit < tasks.length && delayMs > 0) await sleep(delayMs);
  }
  return results;
}

// ── Win probability → implied spread ─────────────────────────
// Logistic model: spread = k × ln(away_prob / home_prob)
// Positive spread = home is underdog. Negative = home is favorite.
// k calibrated per sport from historical data.
function winProbToImpliedSpread(homeProb: number, awayProb: number, k: number): number | null {
  if (homeProb <= 0 || homeProb >= 1 || awayProb <= 0 || awayProb >= 1) return null;
  // Spread from home team perspective: positive means home is underdog
  const implied = k * Math.log(awayProb / homeProb);
  return Math.round(implied * 10) / 10; // round to 0.1
}

// ── Win probability → implied moneyline ──────────────────────
function winProbToMoneyline(prob: number): number | null {
  if (prob <= 0 || prob >= 1) return null;
  if (prob >= 0.5) {
    // Favorite: negative moneyline
    return Math.round(-100 * prob / (1 - prob));
  } else {
    // Underdog: positive moneyline
    return Math.round(100 * (1 - prob) / prob);
  }
}

// ── Extract signals from summary response ────────────────────
// Summary has two critical sections:
//   summary.predictor → ESPN BPI win probabilities
//   summary.pickcenter[] → DraftKings market odds (inline)
function extractSignals(summary: any, league: LeagueDef): {
  espnWinProb: any;
  espnImpliedSpread: number | null;
  espnImpliedMoneyline: any;
  marketSpread: number | null;
  marketTotal: number | null;
  marketMoneyline: any;
  marketSpreadOdds: any;
  marketOverOdds: number | null;
  marketUnderOdds: number | null;
  spreadDivergence: number | null;
  moneylineDivergence: any;
  provider: string | null;
} {
  const result = {
    espnWinProb: {} as any,
    espnImpliedSpread: null as number | null,
    espnImpliedMoneyline: {} as any,
    marketSpread: null as number | null,
    marketTotal: null as number | null,
    marketMoneyline: {} as any,
    marketSpreadOdds: {} as any,
    marketOverOdds: null as number | null,
    marketUnderOdds: null as number | null,
    spreadDivergence: null as number | null,
    moneylineDivergence: {} as any,
    provider: null as string | null,
  };

  if (!summary || typeof summary !== 'object') return result;

  // ── 1. ESPN BPI win probabilities from predictor ───────────
  const pred = summary.predictor;
  if (pred) {
    const homeProj = parseFloat(pred.homeTeam?.gameProjection || '0');
    const awayProj = parseFloat(pred.awayTeam?.gameProjection || '0');

    if (homeProj > 0 || awayProj > 0) {
      const homeProb = homeProj / 100;
      const awayProb = awayProj / 100;
      result.espnWinProb = { home: homeProb, away: awayProb };

      // Derive implied spread from BPI win probability
      result.espnImpliedSpread = winProbToImpliedSpread(homeProb, awayProb, league.spreadK);

      // Derive implied moneylines
      result.espnImpliedMoneyline = {
        home: winProbToMoneyline(homeProb),
        away: winProbToMoneyline(awayProb),
      };
    }
  }

  // ── 2. Market data from pickcenter (DraftKings inline) ─────
  const pc = summary.pickcenter;
  if (Array.isArray(pc) && pc.length > 0) {
    const primary = pc[0]; // First provider (highest priority)
    result.provider = primary.provider?.name || null;

    // Spread: ESPN convention is positive = away team favored
    // details field: "HOU -16.5" means away team (HOU) favored by 16.5
    if (primary.spread != null) {
      result.marketSpread = parseFloat(primary.spread);
    }
    if (primary.overUnder != null) {
      result.marketTotal = parseFloat(primary.overUnder);
    }
    if (primary.overOdds != null) {
      result.marketOverOdds = parseFloat(primary.overOdds);
    }
    if (primary.underOdds != null) {
      result.marketUnderOdds = parseFloat(primary.underOdds);
    }

    // Moneylines
    const homeML = primary.homeTeamOdds?.moneyLine;
    const awayML = primary.awayTeamOdds?.moneyLine;
    if (homeML != null || awayML != null) {
      result.marketMoneyline = {
        home: homeML != null ? parseFloat(homeML) : null,
        away: awayML != null ? parseFloat(awayML) : null,
      };
    }

    // Spread odds (juice)
    const homeSO = primary.homeTeamOdds?.spreadOdds;
    const awaySO = primary.awayTeamOdds?.spreadOdds;
    if (homeSO != null || awaySO != null) {
      result.marketSpreadOdds = {
        home: homeSO != null ? parseFloat(homeSO) : null,
        away: awaySO != null ? parseFloat(awaySO) : null,
      };
    }
  }

  // ── 3. Calculate divergences ───────────────────────────────
  // Spread divergence: ESPN implied spread vs market spread
  // Positive = ESPN thinks home team should be getting more points
  //   (market overvalues away team / underdog value on home)
  if (result.espnImpliedSpread != null && result.marketSpread != null) {
    result.spreadDivergence = Math.round((result.espnImpliedSpread - result.marketSpread) * 10) / 10;
  }

  // Moneyline divergence: ESPN implied ML vs market ML
  if (result.espnImpliedMoneyline?.home != null && result.marketMoneyline?.home != null) {
    result.moneylineDivergence = {
      home: result.espnImpliedMoneyline.home - result.marketMoneyline.home,
      away: (result.espnImpliedMoneyline.away || 0) - (result.marketMoneyline.away || 0),
    };
  }

  return result;
}

// ── Drain a single event ─────────────────────────────────────
async function drainEvent(
  eventId: string,
  league: LeagueDef,
  leagueKey: string,
  homeTeamId: string | null,
  awayTeamId: string | null,
  homeTeam: string | null,
  awayTeam: string | null,
  startTime: string | null,
): Promise<{ row: any; errors: string[]; endpointsHit: string[] }> {
  const errors: string[] = [];
  const endpointsHit: string[] = [];
  const t0 = Date.now();
  const { sport, espnSlug } = league;

  // ── Build endpoint URLs ────────────────────────────────────
  // Summary is the master endpoint — contains predictor, pickcenter,
  // and game metadata. No need for separate Core API odds fetch.
  const urls: Record<string, string> = {
    summary: `${ESPN_SITE}/${sport}/${espnSlug}/summary?event=${eventId}`,
  };

  // Team-specific endpoints
  if (homeTeamId) {
    urls.home_stats = `${ESPN_SITE}/${sport}/${espnSlug}/teams/${homeTeamId}/statistics`;
    if (league.hasAts) urls.home_ats = `${ESPN_SITE}/${sport}/${espnSlug}/teams/${homeTeamId}/ats`;
  }
  if (awayTeamId) {
    urls.away_stats = `${ESPN_SITE}/${sport}/${espnSlug}/teams/${awayTeamId}/statistics`;
    if (league.hasAts) urls.away_ats = `${ESPN_SITE}/${sport}/${espnSlug}/teams/${awayTeamId}/ats`;
  }

  // ── Parallel fetch ─────────────────────────────────────────
  const entries = Object.entries(urls);
  const fetches = entries.map(([key, url]) => async () => {
    const result = await safeFetch(url, key);
    return { key, ...result };
  });

  const results = await parallelLimit(fetches, MAX_CONCURRENT, 100);
  const raw: Record<string, any> = {};

  for (const r of results) {
    if (r.ok) {
      raw[r.key] = r.data;
      endpointsHit.push(r.key);
    } else if (r.error) {
      errors.push(r.error);
    }
  }

  // ── Extract signals from summary ───────────────────────────
  const signals = extractSignals(raw.summary || {}, league);

  const durationMs = Date.now() - t0;

  const row = {
    id: `${eventId}${league.suffix}`,
    espn_event_id: eventId,
    league_id: leagueKey,
    sport,
    home_team: homeTeam,
    away_team: awayTeam,
    home_team_id: homeTeamId ? `${homeTeamId}${league.suffix}` : null,
    away_team_id: awayTeamId ? `${awayTeamId}${league.suffix}` : null,
    start_time: startTime,

    // Raw payloads for reprocessing
    summary_raw: raw.summary || {},
    predictor_raw: raw.summary?.predictor || {},
    odds_raw: raw.summary?.pickcenter || {},
    odds_movement_raw: {},
    probabilities_raw: {},
    home_ats_raw: raw.home_ats || {},
    away_ats_raw: raw.away_ats || {},
    home_stats_raw: raw.home_stats || {},
    away_stats_raw: raw.away_stats || {},
    home_injuries_raw: raw.summary?.injuries?.[0] || {},
    away_injuries_raw: raw.summary?.injuries?.[1] || {},
    home_records_raw: {},
    away_records_raw: {},

    // ESPN intelligence signals
    espn_win_prob: signals.espnWinProb,
    espn_projected_score: signals.espnImpliedMoneyline, // repurposing: stores implied MLs
    espn_power_index: {},

    // Derived spreads
    espn_implied_spread: signals.espnImpliedSpread,
    espn_implied_total: null, // ESPN doesn't provide implied totals

    // Market data (from DraftKings via pickcenter)
    market_spread: signals.marketSpread,
    market_total: signals.marketTotal,

    // Divergence: the alpha signal
    spread_divergence: signals.spreadDivergence,
    total_divergence: null,

    // Metadata
    drain_version: 'v2',
    endpoints_hit: endpointsHit,
    last_drained_at: new Date().toISOString(),
    drain_errors: errors,
    drain_duration_ms: durationMs,
    updated_at: new Date().toISOString(),
  };

  return { row, errors, endpointsHit };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Main Handler
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const url = new URL(req.url);
  const leagueParam = url.searchParams.get('league') || 'nba';
  const daysAhead = parseInt(url.searchParams.get('days') || '7');
  const eventIdParam = url.searchParams.get('event');
  const dryRun = url.searchParams.get('dry') === 'true';

  const leagueKeys = leagueParam.split(',').map(l => l.trim().toLowerCase());
  const t0 = Date.now();

  const allRows: any[] = [];
  const allErrors: string[] = [];
  let totalEndpoints = 0;

  try {
    for (const leagueKey of leagueKeys) {
      const league = LEAGUES[leagueKey];
      if (!league) {
        allErrors.push(`Unknown league: ${leagueKey}`);
        continue;
      }

      L.info('DRAIN_LEAGUE_START', { league: leagueKey, version: 'v2' });

      let events: any[] = [];

      if (eventIdParam) {
        events = [{ id: eventIdParam, competitions: [] }];
      } else {
        const today = new Date();
        const end = new Date();
        end.setDate(today.getDate() + daysAhead);
        const dateRange = `${fmt(today)}-${fmt(end)}`;
        const groupsParam = leagueKey === 'ncaab' ? '&groups=50' : leagueKey === 'ncaaf' ? '&groups=80' : '';
        const sbUrl = `${ESPN_SITE}/${league.sport}/${league.espnSlug}/scoreboard?limit=100&dates=${dateRange}${groupsParam}`;

        const sbResult = await safeFetch(sbUrl, 'scoreboard');
        if (!sbResult.ok) {
          allErrors.push(`Scoreboard failed for ${leagueKey}: ${sbResult.error}`);
          continue;
        }
        events = sbResult.data?.events || [];
      }

      L.info('EVENTS_FOUND', { league: leagueKey, count: events.length });

      // Drain events sequentially with rate limiting to avoid ESPN throttle
      for (const event of events) {
        const comp = event.competitions?.[0];
        const home = comp?.competitors?.find((c: any) => c.homeAway === 'home');
        const away = comp?.competitors?.find((c: any) => c.homeAway === 'away');

        const { row, errors, endpointsHit } = await drainEvent(
          event.id,
          league,
          leagueKey,
          home?.team?.id || null,
          away?.team?.id || null,
          home?.team?.displayName || null,
          away?.team?.displayName || null,
          event.date || null,
        );

        allRows.push(row);
        allErrors.push(...errors);
        totalEndpoints += endpointsHit.length;

        L.info('EVENT_DRAINED', {
          event: event.id,
          home: row.home_team,
          away: row.away_team,
          espnSpread: row.espn_implied_spread,
          mktSpread: row.market_spread,
          divergence: row.spread_divergence,
          winProb: row.espn_win_prob,
        });
      }
    }

    // ── Batch upsert ─────────────────────────────────────────
    let upsertCount = 0;
    if (!dryRun && allRows.length > 0) {
      const BATCH = 25;
      for (let i = 0; i < allRows.length; i += BATCH) {
        const batch = allRows.slice(i, i + BATCH);
        const { error } = await supabase
          .from('espn_enrichment')
          .upsert(batch, { onConflict: 'id' });
        if (error) {
          L.error('UPSERT_FAILED', { batch: i / BATCH, error: error.message });
          allErrors.push(`Upsert batch ${i / BATCH}: ${error.message}`);
        } else {
          upsertCount += batch.length;
        }
      }
    }

    // ── Log drain run ────────────────────────────────────────
    const durationMs = Date.now() - t0;
    const status = allErrors.length === 0 ? 'success' : allRows.length > 0 ? 'partial' : 'failure';

    if (!dryRun) {
      await supabase.from('espn_drain_log').insert({
        leagues_queried: leagueKeys,
        events_found: allRows.length,
        events_drained: upsertCount,
        endpoints_total: totalEndpoints,
        errors: allErrors.slice(0, 50),
        duration_ms: durationMs,
        drain_version: 'v2',
        status,
      });
    }

    // ── Response with divergence report ───────────────────────
    const summary = {
      success: true,
      version: 'v2',
      dryRun,
      leagues: leagueKeys,
      eventsFound: allRows.length,
      eventsDrained: dryRun ? 0 : upsertCount,
      endpointsTotal: totalEndpoints,
      errorsCount: allErrors.length,
      durationMs,
      status: dryRun ? 'dry_run' : status,
      divergences: allRows
        .filter(r => r.spread_divergence != null)
        .map(r => ({
          id: r.id,
          home: r.home_team,
          away: r.away_team,
          espnWinProb: r.espn_win_prob,
          espnImpliedSpread: r.espn_implied_spread,
          marketSpread: r.market_spread,
          marketTotal: r.market_total,
          spreadDivergence: r.spread_divergence,
        }))
        .sort((a: any, b: any) => Math.abs(b.spreadDivergence) - Math.abs(a.spreadDivergence)),
      errors: allErrors.slice(0, 20),
    };

    return new Response(JSON.stringify(summary, null, 2), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    L.error('FATAL', { error: err.message, stack: err.stack?.substring(0, 500) });
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});

function fmt(d: Date): string {
  return d.toISOString().split('T')[0].replace(/-/g, '');
}
