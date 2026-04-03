const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb';
const TIMEOUT_MS = 8000;

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, if-none-match',
  'Access-Control-Max-Age': '86400',
  'Content-Type': 'application/json',
};

const asString = (value: unknown, fallback = ''): string => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : fallback;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
};

const asNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.trim().replace(/[^0-9+.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
};

const parseInningHalf = (competition: any): 'top' | 'bottom' => {
  const status = [
    asString(competition?.status?.type?.shortDetail).toLowerCase(),
    asString(competition?.status?.type?.detail).toLowerCase(),
    asString(competition?.status?.displayClock).toLowerCase(),
  ].join(' ');
  if (status.includes('bottom') || status.includes('bot')) return 'bottom';
  return 'top';
};

const buildFallbackPayload = (matchId: string) => ({
  matchId,
  inningHalf: 'top',
  pitcher: { name: 'Pitcher', shortName: 'Pitcher', initials: 'P', ip: '0.0', pitchCount: 0, er: 0, k: 0 },
  batter: { name: 'Batter', shortName: 'Batter', initials: 'B', todayLine: '0-0', avg: '.000' },
  pitches: [],
  dueUp: [],
  scoringPlays: [],
  asOfTs: Date.now(),
  oddsTs: Date.now(),
  inning: 1,
  balls: 0,
  strikes: 0,
  outs: 0,
  onFirst: false,
  onSecond: false,
  onThird: false,
});

async function fetchSummary(eventId: string): Promise<any | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${ESPN_BASE}/summary?event=${encodeURIComponent(eventId)}`, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return json({ ok: true }, 200);
  if (req.method !== 'POST' && req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  const url = new URL(req.url);
  let matchId = asString(url.searchParams.get('matchId'));

  if (!matchId && req.method === 'POST') {
    try {
      const body = await req.json();
      matchId = asString(body?.matchId);
    } catch {
      // Ignore parse error; fail-open fallback below.
    }
  }

  const eventId = matchId.split('_')[0];
  if (!eventId) return json(buildFallbackPayload(matchId), 200);

  const data = await fetchSummary(eventId);
  if (!data) return json(buildFallbackPayload(matchId), 200);

  const competition = data?.header?.competitions?.[0];
  const competitors = Array.isArray(competition?.competitors) ? competition.competitors : [];
  if (competitors.length < 2) return json(buildFallbackPayload(matchId), 200);

  const home = competitors.find((c: any) => c?.homeAway === 'home') ?? competitors[0];
  const away = competitors.find((c: any) => c?.homeAway === 'away') ?? competitors[1];
  const inningHalf = parseInningHalf(competition);
  const battingTeam = inningHalf === 'top' ? away : home;
  const fieldingTeam = inningHalf === 'top' ? home : away;
  const situation = data?.situation ?? competition?.situation ?? {};

  const payload = {
    matchId,
    inningHalf,
    pitcher: {
      id: asString(situation?.pitcher?.id || situation?.pitcher?.athlete?.id) || undefined,
      name: asString(situation?.pitcher?.displayName || situation?.pitcher?.athlete?.displayName) || `${asString(fieldingTeam?.team?.shortDisplayName || fieldingTeam?.team?.abbreviation, 'Pitcher')}`,
      shortName: asString(situation?.pitcher?.displayName || situation?.pitcher?.athlete?.displayName) || `${asString(fieldingTeam?.team?.abbreviation, 'P')}`,
      initials: 'P',
      ip: asString(situation?.pitcher?.inningsPitched, '0.0'),
      pitchCount: asNumber(situation?.pitchCount ?? situation?.pitcher?.pitchCount, 0),
      er: asNumber(situation?.pitcher?.earnedRuns, 0),
      k: asNumber(situation?.pitcher?.strikeouts, 0),
    },
    batter: {
      id: asString(situation?.batter?.id || situation?.batter?.athlete?.id) || undefined,
      name: asString(situation?.batter?.displayName || situation?.batter?.athlete?.displayName) || `${asString(battingTeam?.team?.shortDisplayName || battingTeam?.team?.abbreviation, 'Batter')}`,
      shortName: asString(situation?.batter?.displayName || situation?.batter?.athlete?.displayName) || `${asString(battingTeam?.team?.abbreviation, 'B')}`,
      initials: 'B',
      todayLine: asString(situation?.batter?.todayLine, '—'),
      avg: asString(situation?.batter?.average, '.000'),
    },
    pitches: [],
    dueUp: [],
    scoringPlays: [],
    asOfTs: Date.now(),
    oddsTs: Date.now(),
    inning: asNumber(competition?.status?.period, 1),
    balls: asNumber(situation?.balls, 0),
    strikes: asNumber(situation?.strikes, 0),
    outs: asNumber(situation?.outs, 0),
    onFirst: Boolean(situation?.onFirst),
    onSecond: Boolean(situation?.onSecond),
    onThird: Boolean(situation?.onThird),
  };

  return json(payload, 200);
});
