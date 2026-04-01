import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ODDS_API_KEY = Deno.env.get('ODDS_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const BASE = 'https://api.the-odds-api.com/v4';

if (!ODDS_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error('Missing required env vars: ODDS_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

interface BookmakerMarket {
  key: string;
  last_update: string;
  outcomes: Array<{
    name: string;
    price: number;
    point?: number;
    description?: string;
  }>;
}

interface Bookmaker {
  key: string;
  title: string;
  last_update: string;
  markets: BookmakerMarket[];
}

interface HistoricalOddsResponse {
  timestamp: string;
  previous_timestamp: string | null;
  next_timestamp: string | null;
  data: {
    id: string;
    sport_key: string;
    sport_title: string;
    commence_time: string;
    home_team: string;
    away_team: string;
    bookmakers: Bookmaker[];
  };
}

interface HistoricalEventsResponse {
  timestamp: string;
  data: Array<{
    id: string;
    sport_key: string;
    commence_time: string;
    home_team: string;
    away_team: string;
  }>;
}

interface ScoreTimelinePoint {
  minute: number;
  home_score: number;
  away_score: number;
}

interface BackfillRequest {
  sport_key?: string;
  match_id: string;
  league_id?: string;
  home_team: string;
  away_team: string;
  kickoff_utc: string;
  interval_min?: number;
  duration_min?: number;
  regions?: string;
  score_timeline?: ScoreTimelinePoint[];
  odds_event_id?: string;
}

function americanOdds(decimal: number): number {
  if (!decimal || decimal <= 1) return 0;
  return decimal >= 2 ? Math.round((decimal - 1) * 100) : Math.round(-100 / (decimal - 1));
}

function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findOddsApiEventId(
  sportKey: string,
  date: string,
  homeTeam: string,
  awayTeam: string
): Promise<string | null> {
  const url = `${BASE}/historical/sports/${sportKey}/events?apiKey=${ODDS_API_KEY}&date=${date}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`Events lookup failed: ${res.status} ${await res.text()}`);
    return null;
  }

  const body: HistoricalEventsResponse = await res.json();
  const homeNorm = normalizeName(homeTeam);
  const awayNorm = normalizeName(awayTeam);

  for (const evt of body.data ?? []) {
    const evtHome = normalizeName(evt.home_team);
    const evtAway = normalizeName(evt.away_team);
    if ((evtHome.includes(homeNorm) || homeNorm.includes(evtHome)) && (evtAway.includes(awayNorm) || awayNorm.includes(evtAway))) {
      return evt.id;
    }
  }

  console.log('Available events:', (body.data ?? []).map((evt) => `${evt.home_team} v ${evt.away_team} (${evt.id})`));
  return null;
}

async function fetchHistoricalOdds(
  sportKey: string,
  eventId: string,
  date: string,
  regions = 'us,eu',
  markets = 'h2h,spreads,totals'
): Promise<HistoricalOddsResponse | null> {
  const url =
    `${BASE}/historical/sports/${sportKey}/events/${eventId}/odds` +
    `?apiKey=${ODDS_API_KEY}&date=${date}&regions=${regions}` +
    `&markets=${markets}&oddsFormat=decimal`;
  const res = await fetch(url);
  if (!res.ok) {
    const txt = await res.text();
    console.error(`Odds fetch failed at ${date}: ${res.status} ${txt}`);
    return null;
  }
  return await res.json();
}

function findOutcomeByName(
  outcomes: Array<{ name: string; price: number; point?: number }>,
  teamName: string
) {
  const normalizedTeam = normalizeName(teamName);
  return outcomes.find((o) => normalizeName(o.name) === normalizedTeam) ?? null;
}

function extractRows(
  snapshot: HistoricalOddsResponse,
  matchId: string,
  leagueId: string,
  homeTeam: string,
  awayTeam: string,
  homeScore: number | null,
  awayScore: number | null,
  clock: string | null
) {
  const rows: Record<string, unknown>[] = [];
  const capturedAt = snapshot.timestamp;

  for (const bk of snapshot.data.bookmakers ?? []) {
    const h2h = bk.markets.find((m) => m.key === 'h2h');
    const spreads = bk.markets.find((m) => m.key === 'spreads');
    const totals = bk.markets.find((m) => m.key === 'totals');

    let homeML: number | null = null;
    let awayML: number | null = null;
    let drawML: number | null = null;
    if (h2h) {
      const ho = findOutcomeByName(h2h.outcomes, homeTeam);
      const ao = findOutcomeByName(h2h.outcomes, awayTeam);
      const dr = h2h.outcomes.find((o) => o.name.toLowerCase() === 'draw');
      if (ho) homeML = americanOdds(ho.price);
      if (ao) awayML = americanOdds(ao.price);
      if (dr) drawML = americanOdds(dr.price);
    }

    let spreadHome: number | null = null;
    let spreadAway: number | null = null;
    let spreadHomePrice: number | null = null;
    let spreadAwayPrice: number | null = null;
    if (spreads) {
      const sh = findOutcomeByName(spreads.outcomes, homeTeam);
      const sa = findOutcomeByName(spreads.outcomes, awayTeam);
      if (sh) {
        spreadHome = sh.point ?? null;
        spreadHomePrice = americanOdds(sh.price);
      }
      if (sa) {
        spreadAway = sa.point ?? null;
        spreadAwayPrice = americanOdds(sa.price);
      }
    }

    let total: number | null = null;
    let overPrice: number | null = null;
    let underPrice: number | null = null;
    if (totals) {
      const ov = totals.outcomes.find((o) => o.name.toLowerCase() === 'over');
      const un = totals.outcomes.find((o) => o.name.toLowerCase() === 'under');
      if (ov) {
        total = ov.point ?? null;
        overPrice = americanOdds(ov.price);
      }
      if (un) {
        underPrice = americanOdds(un.price);
      }
    }

    rows.push({
      match_id: matchId,
      sport: 'soccer',
      league_id: leagueId,
      provider: bk.title,
      provider_id: bk.key,
      market_type: 'historical_backfill',
      captured_at: capturedAt,
      status: homeScore !== null ? 'STATUS_IN_PROGRESS' : 'STATUS_PREGAME',
      period: null,
      clock,
      home_score: homeScore,
      away_score: awayScore,
      home_team: homeTeam,
      away_team: awayTeam,
      home_ml: homeML,
      away_ml: awayML,
      draw_ml: drawML,
      spread_home: spreadHome,
      spread_away: spreadAway,
      spread_home_price: spreadHomePrice,
      spread_away_price: spreadAwayPrice,
      total,
      over_price: overPrice,
      under_price: underPrice,
      is_live: homeScore !== null,
      source: 'odds_api_historical',
      raw_payload: snapshot.data,
    });
  }
  return rows;
}

Deno.serve(async (req) => {
  try {
    const body: BackfillRequest = await req.json();

    const sportKey = body.sport_key || 'soccer_uefa_champs_league';
    const matchId = body.match_id;
    const leagueId = body.league_id || 'uefa.champions';
    const homeTeam = body.home_team;
    const awayTeam = body.away_team;
    const kickoffUtc = body.kickoff_utc;
    const intervalMin = body.interval_min || 5;
    const durationMin = body.duration_min || 110;
    const regions = body.regions || 'us,eu';
    const scoreTimeline = body.score_timeline || [];

    if (!matchId || !homeTeam || !awayTeam || !kickoffUtc) {
      return new Response(JSON.stringify({ error: 'match_id, home_team, away_team, kickoff_utc required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    console.log(`Looking up event: ${homeTeam} v ${awayTeam} at ${kickoffUtc}`);
    const oddsEventId = body.odds_event_id || (await findOddsApiEventId(sportKey, kickoffUtc, homeTeam, awayTeam));

    if (!oddsEventId) {
      return new Response(
        JSON.stringify({ error: 'Could not find Odds API event ID', homeTeam, awayTeam }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
    console.log(`Found event: ${oddsEventId}`);

    const kickoff = new Date(kickoffUtc);
    const timestamps: string[] = [];
    const preStart = new Date(kickoff.getTime() - 15 * 60 * 1000);
    const steps = Math.floor((durationMin + 15) / intervalMin);
    for (let i = 0; i <= steps; i += 1) {
      const t = new Date(preStart.getTime() + i * intervalMin * 60 * 1000);
      timestamps.push(t.toISOString().replace(/\.\d{3}Z$/, 'Z'));
    }

    console.log(`Will fetch ${timestamps.length} snapshots from ${timestamps[0]} to ${timestamps[timestamps.length - 1]}`);

    let inserted = 0;
    let errors = 0;
    const results: string[] = [];

    for (const ts of timestamps) {
      const snapshot = await fetchHistoricalOdds(sportKey, oddsEventId, ts, regions);
      if (!snapshot) {
        errors += 1;
        results.push(`${ts}: FAILED`);
        await sleep(300);
        continue;
      }

      const elapsed = (new Date(ts).getTime() - kickoff.getTime()) / 60000;
      let clock: string | null = null;
      let hScore: number | null = null;
      let aScore: number | null = null;

      if (elapsed >= 0 && scoreTimeline.length > 0) {
        clock = `${Math.floor(elapsed)}'`;
        for (const evt of scoreTimeline) {
          if (evt.minute <= elapsed) {
            hScore = evt.home_score;
            aScore = evt.away_score;
          }
        }
      } else if (elapsed < 0) {
        clock = 'PRE';
      }

      const rows = extractRows(snapshot, matchId, leagueId, homeTeam, awayTeam, hScore, aScore, clock);
      if (rows.length > 0) {
        const { error } = await sb.from('live_odds_snapshots').insert(rows);
        if (error) {
          console.error(`Insert failed at ${ts}:`, error.message);
          errors += 1;
          results.push(`${ts}: INSERT_ERROR ${error.message}`);
        } else {
          inserted += rows.length;
          const providers = rows
            .map((r) => String(r.provider ?? 'unknown'))
            .join(',');
          results.push(`${ts}: ${rows.length} rows (${providers})`);
        }
      } else {
        results.push(`${ts}: no bookmakers in response`);
      }

      await sleep(500);
    }

    return new Response(
      JSON.stringify({
        status: 'done',
        odds_event_id: oddsEventId,
        match_id: matchId,
        timestamps_fetched: timestamps.length,
        rows_inserted: inserted,
        errors,
        detail: results,
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (e) {
    console.error('Fatal:', e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
