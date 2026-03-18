export const maxDuration = 60;

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb';
const TIMEOUT_MS = 8000;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const setCorsHeaders = (res) => {
  Object.entries(CORS_HEADERS).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
};

const asString = (value, fallback = '') => {
  if (typeof value === 'string') {
    const t = value.trim();
    return t.length > 0 ? t : fallback;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
};

const asNumber = (value, fallback = null) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const cleaned = value.trim().replace(/[^0-9+.-]/g, '');
    if (!cleaned) return fallback;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
};

const asBool = (value, fallback = false) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const n = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(n)) return true;
    if (['false', '0', 'no', 'n'].includes(n)) return false;
  }
  return fallback;
};

const hash32 = (str) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

const seeded = (seed) => {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const initials = (name) => {
  const parts = asString(name).split(/\s+/).filter(Boolean);
  if (!parts.length) return '--';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase();
};

const normalizeCoord = (raw) => {
  const n = asNumber(raw, null);
  if (n === null) return null;
  if (n >= 0 && n <= 1) return n * 100;
  if (n >= 0 && n <= 100) return n;
  return null;
};

const classifyPitchResult = (text, typeText) => {
  const raw = `${asString(typeText)} ${asString(text)}`.toLowerCase();
  if (!raw) return null;

  if (raw.includes('hit by pitch')) return 'hit_by_pitch';
  if (raw.includes('swinging strike') || raw.includes('strikes out swinging')) return 'swinging_strike';
  if (raw.includes('called strike') || raw.includes('strikes out looking')) return 'called_strike';
  if (raw.includes('foul')) return 'foul';
  if (raw.includes('groundout') || raw.includes('flyout') || raw.includes('lineout') || raw.includes('pop out') || raw.includes('forceout')) return 'in_play_out';
  if (raw.includes('single') || raw.includes('double') || raw.includes('triple') || raw.includes('home run') || raw.includes('homers') || raw.includes('in play')) return 'hit';
  if (raw.includes(' ball') || raw.startsWith('ball') || raw.includes('walks')) return 'ball';
  if (raw.includes('strikeout')) return 'swinging_strike';

  return null;
};

const parsePitchType = (play) => {
  const candidates = [
    play?.pitch?.type?.text,
    play?.pitchType?.text,
    play?.type?.text,
  ];
  for (const c of candidates) {
    const v = asString(c);
    if (v) return v;
  }

  const text = asString(play?.text || play?.description || play?.shortText).toLowerCase();
  const m = text.match(/(four-seam fastball|fastball|slider|curveball|cutter|changeup|sinker|splitter|knuckleball)/i);
  if (m?.[1]) return m[1];
  return 'Pitch';
};

const parseMph = (play) => {
  const speedCandidates = [
    play?.pitch?.speed?.value,
    play?.pitch?.speed,
    play?.pitchSpeed,
  ];
  for (const c of speedCandidates) {
    const n = asNumber(c, null);
    if (n !== null && n >= 40 && n <= 115) return n;
  }

  const text = asString(play?.text || play?.description || play?.shortText);
  const match = text.match(/(\d{2,3})\s?mph/i);
  if (match?.[1]) {
    const n = Number(match[1]);
    if (Number.isFinite(n)) return n;
  }
  return 0;
};

const derivePitchCoords = (play, result) => {
  const rawX =
    normalizeCoord(play?.pitch?.x) ??
    normalizeCoord(play?.coordinate?.x) ??
    normalizeCoord(play?.coordinates?.x) ??
    normalizeCoord(play?.x);
  const rawY =
    normalizeCoord(play?.pitch?.y) ??
    normalizeCoord(play?.coordinate?.y) ??
    normalizeCoord(play?.coordinates?.y) ??
    normalizeCoord(play?.y);

  if (rawX !== null && rawY !== null) {
    return { x: Math.max(0, Math.min(100, rawX)), y: Math.max(0, Math.min(100, rawY)) };
  }

  const seedText = `${asString(play?.id)}|${asString(play?.text)}|${result}`;
  const rnd = seeded(hash32(seedText));

  if (result === 'ball') {
    const edge = rnd() > 0.5;
    return {
      x: edge ? (rnd() > 0.5 ? 85 + rnd() * 10 : 5 + rnd() * 10) : 20 + rnd() * 60,
      y: rnd() > 0.5 ? 7 + rnd() * 12 : 80 + rnd() * 12,
    };
  }

  if (result === 'called_strike' || result === 'swinging_strike') {
    return { x: 30 + rnd() * 40, y: 25 + rnd() * 45 };
  }

  return { x: 20 + rnd() * 60, y: 20 + rnd() * 60 };
};

const parseInningHalf = (competition, fallback = 'top') => {
  const s = [
    competition?.status?.type?.shortDetail,
    competition?.status?.type?.detail,
    competition?.status?.displayClock,
  ].map((v) => asString(v).toLowerCase()).join(' ');

  if (s.includes('bottom') || s.includes('bot')) return 'bottom';
  if (s.includes('top')) return 'top';
  return fallback;
};

const toScoringPlays = (data, competitorsById) => {
  const plays = Array.isArray(data?.scoringPlays) ? data.scoringPlays.slice(-12) : [];
  return plays.map((play) => {
    const teamId = asString(play?.team?.id);
    const teamAbbr = asString(play?.team?.abbreviation || competitorsById.get(teamId)?.abbr);
    const inningLabel =
      asString(play?.clock?.displayValue) ||
      asString(play?.period?.displayValue) ||
      asString(play?.period?.number ? `Inning ${play.period.number}` : '');

    return {
      inningLabel,
      teamId,
      teamAbbr,
      description: asString(play?.text || play?.shortText || play?.description),
      awayScore: asNumber(play?.awayScore, 0),
      homeScore: asNumber(play?.homeScore, 0),
    };
  }).filter((p) => p.description);
};

async function fetchSummary(eventId) {
  const target = `${ESPN_BASE}/summary?event=${eventId}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(target, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'sportsync-baseball-live/1.0',
        Accept: 'application/json',
      },
    });
    if (!res.ok) return null;
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req, res) {
  const respondJson = (status, body) => {
    setCorsHeaders(res);
    res.setHeader('Cache-Control', 'public, max-age=8');
    res.setHeader('Content-Type', 'application/json');
    return res.status(status).json(body);
  };

  if (req.method === 'OPTIONS') return respondJson(200, {});
  if (req.method !== 'GET') return respondJson(405, { error: 'Method not allowed' });

  const rawMatchId = asString(req.query?.matchId);
  const eventId = rawMatchId.split('_')[0];
  if (!eventId) return respondJson(400, { error: 'matchId required' });

  try {
    const data = await fetchSummary(eventId);
    if (!data) return respondJson(502, { error: 'Failed to fetch ESPN summary' });

    const competition = data?.header?.competitions?.[0];
    const competitors = Array.isArray(competition?.competitors) ? competition.competitors : [];
    if (competitors.length < 2) {
      return respondJson(200, {
        matchId: rawMatchId,
        inningHalf: 'top',
        pitcher: { name: 'Pitcher', shortName: 'Pitcher', initials: 'P', ip: '0.0', pitchCount: 0, er: 0, k: 0 },
        batter: { name: 'Batter', shortName: 'Batter', initials: 'B', todayLine: '0-0', avg: '.000' },
        pitches: [],
        dueUp: [],
        scoringPlays: [],
        asOfTs: Date.now(),
      });
    }

    const home = competitors.find((c) => c?.homeAway === 'home') || competitors[0];
    const away = competitors.find((c) => c?.homeAway === 'away') || competitors[1];
    const inningHalf = parseInningHalf(competition, 'top');
    const battingTeam = inningHalf === 'top' ? away : home;
    const fieldingTeam = inningHalf === 'top' ? home : away;

    const competitorsById = new Map(
      competitors.map((c) => [asString(c?.team?.id), { abbr: asString(c?.team?.abbreviation) }]),
    );

    const situation =
      data?.situation ||
      competition?.situation ||
      data?.drives?.current?.plays?.slice?.(-1)?.[0]?.situation ||
      {};

    const sourcePlays =
      (Array.isArray(data?.plays) && data.plays.length > 0 && data.plays) ||
      (Array.isArray(data?.drives?.current?.plays) && data.drives.current.plays.length > 0 && data.drives.current.plays) ||
      [];

    const classifiedPitches = sourcePlays
      .map((play) => {
        const text = asString(play?.text || play?.description || play?.shortText);
        const typeText = asString(play?.type?.text);
        const result = classifyPitchResult(text, typeText);
        if (!result) return null;

        const coords = derivePitchCoords(play, result);
        return {
          id: asString(play?.id || play?.sequence || play?.playId),
          text,
          typeText,
          result,
          mph: parseMph(play),
          x: coords.x,
          y: coords.y,
        };
      })
      .filter(Boolean)
      .slice(-12)
      .reverse()
      .map((p, idx) => ({
        x: p.x,
        y: p.y,
        result: p.result,
        type: parsePitchType({ type: { text: p.typeText }, text: p.text }),
        mph: p.mph,
        seq: idx + 1,
      }));

    const normalizedPitches =
      classifiedPitches.length > 0
        ? classifiedPitches
        : sourcePlays
            .slice(-8)
            .reverse()
            .map((play, idx) => {
              const text = asString(play?.text || play?.description || play?.shortText, 'Play');
              const result = classifyPitchResult(text, asString(play?.type?.text)) || 'in_play_out';
              const coords = derivePitchCoords(play, result);
              return {
                x: coords.x,
                y: coords.y,
                result,
                type: parsePitchType(play),
                mph: parseMph(play),
                seq: idx + 1,
              };
            });

    const pitcherName =
      asString(situation?.pitcher?.displayName) ||
      asString(situation?.pitcher?.athlete?.displayName) ||
      asString(fieldingTeam?.probables?.[0]?.athlete?.displayName) ||
      `${asString(fieldingTeam?.team?.shortDisplayName || fieldingTeam?.team?.abbreviation, 'Team')} Pitcher`;

    const batterName =
      asString(situation?.batter?.displayName) ||
      asString(situation?.batter?.athlete?.displayName) ||
      `${asString(battingTeam?.team?.shortDisplayName || battingTeam?.team?.abbreviation, 'Team')} Batter`;

    const dueUpCandidates = [
      situation?.onDeck,
      situation?.onDeckBatter,
      situation?.inHole,
      situation?.inHoleBatter,
    ].filter(Boolean);

    const dueUp = dueUpCandidates.slice(0, 2).map((item) => ({
      name: asString(item?.displayName || item?.athlete?.displayName || item?.name, '—'),
      position: asString(item?.position?.abbreviation || item?.position, '—'),
      bats: asString(item?.bats || item?.battingHand, '—'),
      todayLine: asString(item?.todayLine || item?.line || item?.summary, '—'),
    }));

    const response = {
      matchId: rawMatchId,
      inningHalf,
      pitcher: {
        id: asString(situation?.pitcher?.id || situation?.pitcher?.athlete?.id) || undefined,
        name: pitcherName,
        shortName: pitcherName,
        initials: initials(pitcherName),
        ip: asString(situation?.pitcher?.inningsPitched, '0.0'),
        pitchCount: asNumber(situation?.pitchCount ?? situation?.pitcher?.pitchCount, normalizedPitches.length || 0),
        er: asNumber(situation?.pitcher?.earnedRuns, 0),
        k: asNumber(situation?.pitcher?.strikeouts, 0),
      },
      batter: {
        id: asString(situation?.batter?.id || situation?.batter?.athlete?.id) || undefined,
        name: batterName,
        shortName: batterName,
        initials: initials(batterName),
        todayLine: asString(situation?.batter?.todayLine, '—'),
        avg: asString(situation?.batter?.average, '.000'),
      },
      pitches: normalizedPitches,
      dueUp,
      scoringPlays: toScoringPlays(data, competitorsById),
      asOfTs: Date.now(),
      oddsTs: Date.now(),
      inning: asNumber(competition?.status?.period, 1),
      balls: asNumber(situation?.balls, 0),
      strikes: asNumber(situation?.strikes, 0),
      outs: asNumber(situation?.outs, 0),
      onFirst: asBool(situation?.onFirst, false),
      onSecond: asBool(situation?.onSecond, false),
      onThird: asBool(situation?.onThird, false),
    };

    return respondJson(200, response);
  } catch (error) {
    return respondJson(500, { error: error?.message || 'Unknown error' });
  }
}
