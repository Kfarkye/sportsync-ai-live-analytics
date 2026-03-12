import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

declare const Deno: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type RawOdds = Record<string, any> | null;

type ParsedOdds = {
  spreadLine: number | null;
  spreadHomePrice: number | null;
  spreadAwayPrice: number | null;
  totalLine: number | null;
  overPrice: number | null;
  underPrice: number | null;
  homeMl: number | null;
  awayMl: number | null;
  drawMl: number | null;
  provider: string | null;
};

type PulseRow = {
  id: string;
  ts: string;
  period: string | null;
  clock: string | null;
  score: string;
  scoreStateTag: string;
  eventType: string;
  eventLabel: string;
  teamSide: 'home' | 'away' | null;
  marketBefore: string;
  marketAfter: string;
  moveLabel: string;
  moveMagnitude: 'small' | 'medium' | 'large';
  badge: 'Normal' | 'Sharp Move' | 'Lagging' | 'No Reaction';
  explanation: string;
  pre?: ParsedOdds;
  post?: ParsedOdds;
};

type SnapshotEvent = {
  id: string | number;
  match_id: string;
  league_id: string;
  sport: string;
  event_type: string;
  sequence: number | null;
  period: number | null;
  clock: string | null;
  home_score: number;
  away_score: number;
  play_data: Record<string, any> | null;
  odds_snapshot: RawOdds;
  created_at: string;
};

const toNum = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const match = value.match(/[+-]?\d+(?:\.\d+)?/);
    if (!match) return null;
    const parsed = Number(match[0]);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const toAmerican = (value: number | null): string => {
  if (value === null || !Number.isFinite(value)) return 'N/A';
  if (value > 0) return `+${Math.round(value)}`;
  return `${Math.round(value)}`;
};

const toSigned = (value: number | null): string => {
  if (value === null || !Number.isFinite(value)) return 'N/A';
  if (value > 0) return `+${value.toFixed(Math.abs(value) % 1 === 0 ? 0 : 1)}`;
  return `${value.toFixed(Math.abs(value) % 1 === 0 ? 0 : 1)}`;
};

const impliedProb = (ml: number | null): number | null => {
  if (ml === null || !Number.isFinite(ml)) return null;
  if (ml > 0) return 100 / (ml + 100);
  return Math.abs(ml) / (Math.abs(ml) + 100);
};

const magnitudeLabel = (delta: number): 'small' | 'medium' | 'large' => {
  const abs = Math.abs(delta);
  if (abs >= 3) return 'large';
  if (abs >= 1) return 'medium';
  return 'small';
};

const parseOddsSnapshot = (raw: RawOdds): ParsedOdds => {
  const spread = raw?.spread || raw?.spreads || {};
  const total = raw?.total || raw?.totals || {};
  const moneyline = raw?.moneyline || raw?.ml || {};

  return {
    spreadLine: toNum(spread?.line ?? raw?.spread ?? raw?.homeSpread ?? raw?.spread_home),
    spreadHomePrice: toNum(spread?.home ?? raw?.homeSpreadOdds ?? raw?.spread_home_price),
    spreadAwayPrice: toNum(spread?.away ?? raw?.awaySpreadOdds ?? raw?.spread_away_price),
    totalLine: toNum(total?.line ?? raw?.total ?? raw?.overUnder ?? raw?.total_line),
    overPrice: toNum(total?.over ?? raw?.overOdds ?? raw?.over_price),
    underPrice: toNum(total?.under ?? raw?.underOdds ?? raw?.under_price),
    homeMl: toNum(moneyline?.home ?? raw?.homeWin ?? raw?.home_ml ?? raw?.moneylineHome),
    awayMl: toNum(moneyline?.away ?? raw?.awayWin ?? raw?.away_ml ?? raw?.moneylineAway),
    drawMl: toNum(moneyline?.draw ?? raw?.draw ?? raw?.draw_ml ?? raw?.drawML),
    provider: raw?.provider ?? null,
  };
};

const scoreStateTag = (homeScore: number, awayScore: number): string => {
  const diff = Math.abs(homeScore - awayScore);
  if (diff === 0) return 'tied';
  if (diff <= 3) return 'one-score';
  if (diff <= 8) return 'tight';
  if (diff <= 15) return 'comfortable';
  return 'blowout';
};

const detectTeamSide = (event: any, text: string): 'home' | 'away' | null => {
  const side = event?.play_data?.team_side || event?.play_data?.homeAway;
  if (side === 'home' || side === 'away') return side;
  const teamId = event?.play_data?.team_id;
  if (teamId && event?.home_team_id && String(teamId) === String(event.home_team_id)) return 'home';
  if (teamId && event?.away_team_id && String(teamId) === String(event.away_team_id)) return 'away';
  if (/\bhome\b/i.test(text)) return 'home';
  if (/\baway\b/i.test(text)) return 'away';
  return null;
};

const chooseMove = (pre: ParsedOdds, post: ParsedOdds, sport: string) => {
  const totalDelta = pre.totalLine !== null && post.totalLine !== null ? post.totalLine - pre.totalLine : 0;
  const spreadDelta = pre.spreadLine !== null && post.spreadLine !== null ? post.spreadLine - pre.spreadLine : 0;
  const homeProbDelta = (() => {
    const before = impliedProb(pre.homeMl);
    const after = impliedProb(post.homeMl);
    if (before === null || after === null) return 0;
    return after - before;
  })();
  const drawProbDelta = (() => {
    const before = impliedProb(pre.drawMl);
    const after = impliedProb(post.drawMl);
    if (before === null || after === null) return 0;
    return after - before;
  })();

  const absHomeProbPts = Math.abs(homeProbDelta) * 100;
  const absDrawProbPts = Math.abs(drawProbDelta) * 100;

  if (sport === 'soccer' && absDrawProbPts >= 2) {
    return {
      moveLabel: `Draw prob ${drawProbDelta > 0 ? '+' : ''}${drawProbDelta * 100 >= 0 ? (drawProbDelta * 100).toFixed(1) : (drawProbDelta * 100).toFixed(1)} pts`,
      moveMagnitude: magnitudeLabel(absDrawProbPts),
      strength: absDrawProbPts,
      badge: absDrawProbPts >= 4 ? 'Sharp Move' : 'Normal' as const,
      channel: 'draw_prob',
    };
  }

  if (Math.abs(totalDelta) >= 1) {
    return {
      moveLabel: `Total ${totalDelta > 0 ? '+' : ''}${totalDelta.toFixed(1)}`,
      moveMagnitude: magnitudeLabel(totalDelta),
      strength: Math.abs(totalDelta),
      badge: Math.abs(totalDelta) >= 2 ? 'Sharp Move' : 'Normal' as const,
      channel: 'total',
    };
  }

  if (Math.abs(spreadDelta) >= 1) {
    return {
      moveLabel: `Spread ${spreadDelta > 0 ? '+' : ''}${spreadDelta.toFixed(1)}`,
      moveMagnitude: magnitudeLabel(spreadDelta),
      strength: Math.abs(spreadDelta),
      badge: Math.abs(spreadDelta) >= 2 ? 'Sharp Move' : 'Normal' as const,
      channel: 'spread',
    };
  }

  if (absHomeProbPts >= 2) {
    return {
      moveLabel: `Home win prob ${homeProbDelta > 0 ? '+' : ''}${(homeProbDelta * 100).toFixed(1)} pts`,
      moveMagnitude: magnitudeLabel(absHomeProbPts),
      strength: absHomeProbPts,
      badge: absHomeProbPts >= 4 ? 'Sharp Move' : 'Normal' as const,
      channel: 'home_prob',
    };
  }

  return {
    moveLabel: 'No meaningful move',
    moveMagnitude: 'small' as const,
    strength: 0,
    badge: 'No Reaction' as const,
    channel: 'none',
  };
};

const formatMarket = (odds: ParsedOdds, sport: string): string => {
  const spread = odds.spreadLine !== null ? `Spr ${toSigned(odds.spreadLine)}` : null;
  const total = odds.totalLine !== null ? `O/U ${odds.totalLine.toFixed(odds.totalLine % 1 === 0 ? 0 : 1)}` : null;
  const ml = odds.homeMl !== null && odds.awayMl !== null
    ? sport === 'soccer' && odds.drawMl !== null
      ? `ML ${toAmerican(odds.homeMl)} / ${toAmerican(odds.drawMl)} / ${toAmerican(odds.awayMl)}`
      : `ML ${toAmerican(odds.homeMl)} / ${toAmerican(odds.awayMl)}`
    : null;
  return [spread, total, ml].filter(Boolean).join(' | ') || 'Market waiting';
};

const snapshotExplanation = (eventLabel: string, moveLabel: string, hasEvent: boolean): string => {
  if (hasEvent) return `${eventLabel} framed this 10-minute checkpoint. ${moveLabel}.`;
  return `Periodic 10-minute market check. ${moveLabel}.`;
};

const plusMinutes = (date: Date, minutes: number) => new Date(date.getTime() + minutes * 60_000);

const latestOddsEventAtOrBefore = (events: SnapshotEvent[], ts: number): SnapshotEvent | null => {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (Date.parse(events[i].created_at) <= ts) return events[i];
  }
  return null;
};

const latestContextEventInWindow = (events: SnapshotEvent[], startTs: number, endTs: number): SnapshotEvent | null => {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const created = Date.parse(events[i].created_at);
    if (created > endTs) continue;
    if (created < startTs) break;
    if (events[i].event_type !== 'odds_snapshot') return events[i];
  }
  return null;
};

const eventTextFromSnapshot = (event: SnapshotEvent): string => String(
  event.play_data?.text
  || event.play_data?.description
  || event.play_data?.type
  || event.event_type
);

const isMeaningfulPlay = (event: SnapshotEvent): boolean => {
  if (event.event_type === 'odds_snapshot') return false;
  if (event.play_data?.scoring_play) return true;

  return [
    'score',
    'goal',
    'timeout',
    'period_end',
    'red_card',
    'card',
    'penalty',
    'injury',
    'challenge',
  ].includes(event.event_type);
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

    const body = await req.json().catch(() => ({}));
    const matchId = typeof body?.matchId === 'string' ? body.matchId : '';
    const windowMinutes = Math.max(5, Math.min(30, Number(body?.windowMinutes ?? 10) || 10));

    if (!matchId) {
      return new Response(JSON.stringify({ error: 'matchId is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const [eventsRes, matchRes] = await Promise.all([
      supabase
        .from('game_events')
        .select('id, match_id, league_id, sport, event_type, sequence, period, clock, home_score, away_score, play_data, odds_snapshot, created_at')
        .eq('match_id', matchId)
        .order('created_at', { ascending: true })
        .limit(2000),
      supabase
        .from('matches')
        .select('id, sport, league_id, current_odds, start_time')
        .eq('id', matchId)
        .maybeSingle(),
    ]);

    if (eventsRes.error) throw eventsRes.error;
    if (matchRes.error) throw matchRes.error;

    const allEvents = (eventsRes.data ?? []) as SnapshotEvent[];
    const sport = (matchRes.data?.sport || allEvents[0]?.sport || '').toLowerCase();
    const oddsEvents = allEvents.filter((event) => event.odds_snapshot);
    const checkpointRows: PulseRow[] = [];
    const playRows: PulseRow[] = [];

    if (!oddsEvents.length) {
      return new Response(JSON.stringify({
        matchId,
        sport,
        windowMinutes,
        generatedAt: new Date().toISOString(),
        summary: `Waiting for the first priced snapshot to build ${windowMinutes}-minute checkpoints.`,
        rows: [],
        hasRows: false,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const startAnchor = matchRes.data?.start_time
      ? new Date(matchRes.data.start_time)
      : new Date(oddsEvents[0].created_at);
    const firstOddsAt = new Date(oddsEvents[0].created_at);
    const gameStart = startAnchor.getTime() > firstOddsAt.getTime() ? firstOddsAt : startAnchor;
    const latestSnapshotAt = new Date(oddsEvents[oddsEvents.length - 1].created_at);
    const endAnchor = latestSnapshotAt;

    let bucketEnd = plusMinutes(gameStart, windowMinutes);
    while (bucketEnd.getTime() <= endAnchor.getTime()) {
      const currentSnapshot = latestOddsEventAtOrBefore(oddsEvents, bucketEnd.getTime());
      const previousSnapshot = latestOddsEventAtOrBefore(oddsEvents, plusMinutes(bucketEnd, -windowMinutes).getTime());

      if (currentSnapshot && previousSnapshot) {
        const currentParsed = parseOddsSnapshot(currentSnapshot.odds_snapshot);
        const previousParsed = parseOddsSnapshot(previousSnapshot.odds_snapshot);
        const move = chooseMove(previousParsed, currentParsed, sport);
        const scoreHome = currentSnapshot.home_score ?? 0;
        const scoreAway = currentSnapshot.away_score ?? 0;

        checkpointRows.push({
          id: `${currentSnapshot.id}-${bucketEnd.toISOString()}`,
          ts: bucketEnd.toISOString(),
          period: currentSnapshot.period ? `P${currentSnapshot.period}` : null,
          clock: currentSnapshot.clock || null,
          score: `${scoreAway}-${scoreHome}`,
          scoreStateTag: scoreStateTag(scoreHome, scoreAway),
          eventType: 'odds',
          eventLabel: `Periodic ${windowMinutes}-minute market snapshot`,
          teamSide: null,
          marketBefore: formatMarket(previousParsed, sport),
          marketAfter: formatMarket(currentParsed, sport),
          moveLabel: move.moveLabel,
          moveMagnitude: move.moveMagnitude,
          badge: move.badge,
          explanation: `Periodic ${windowMinutes}-minute market check. ${move.moveLabel}.`,
          pre: previousParsed,
          post: currentParsed,
        });
      }

      bucketEnd = plusMinutes(bucketEnd, windowMinutes);
    }

    for (const event of allEvents) {
      if (!isMeaningfulPlay(event)) continue;
      playRows.push({
        id: `play-${event.id}`,
        ts: event.created_at,
        period: event.period ? `P${event.period}` : null,
        clock: event.clock || null,
        score: `${event.away_score ?? 0}-${event.home_score ?? 0}`,
        scoreStateTag: scoreStateTag(event.home_score ?? 0, event.away_score ?? 0),
        eventType: event.event_type,
        eventLabel: eventTextFromSnapshot(event),
        teamSide: detectTeamSide(event, eventTextFromSnapshot(event)),
        marketBefore: '—',
        marketAfter: '—',
        moveLabel: '—',
        moveMagnitude: 'small',
        badge: 'Normal',
        explanation: `Play-by-play event between market checkpoints.`,
      });
    }

    const rows = [...checkpointRows, ...playRows].sort((a, b) => {
      const tsDelta = Date.parse(b.ts) - Date.parse(a.ts);
      if (tsDelta !== 0) return tsDelta;
      return String(b.id).localeCompare(String(a.id));
    });

    const limitedRows = rows.slice(0, 30);
    const leadRow = limitedRows[0] ?? null;
    const summary = leadRow
      ? `${checkpointRows.length} ${windowMinutes}-minute checkpoints tracked so far, with ${playRows.length} live play markers layered in.`
      : `Waiting for enough priced data to build ${windowMinutes}-minute game checkpoints.`;

    return new Response(JSON.stringify({
      matchId,
      sport,
      windowMinutes,
      generatedAt: new Date().toISOString(),
      summary,
      rows: limitedRows,
      hasRows: limitedRows.length > 0,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error?.message || 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
