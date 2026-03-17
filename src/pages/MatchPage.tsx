import React, { useEffect, useId, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  type SoccerPostgame,
  fetchMatchBySlug,
  fetchTeamMeta,
  fmtOdds,
  getMLResult,
  getSpreadResult,
  getTotalResult,
  impliedProb,
} from '../lib/postgame';
import { LEAGUE_LABELS, LEAGUE_SHORT, parseMatchSlug, teamUrl } from '../lib/slugs';
import { color as C } from '../lib/tokens';
import TeamLogo from '../components/shared/TeamLogo';

type TabId = 'overview' | 'stats' | 'odds' | 'lineups';
type Side = 'home' | 'away';
type EventType = 'goal' | 'yellow' | 'red';

type TeamMeta = {
  name?: string | null;
  short_name?: string | null;
  abbreviation?: string | null;
  logo_url?: string | null;
  color?: string | null;
};

type MatchEvent = {
  min: number;
  raw: string;
  type: EventType;
  side: Side;
  player: string;
  detail?: string;
};

type StatRow = {
  label: string;
  homeDisplay: string;
  awayDisplay: string;
  homeValue: number;
  awayValue: number;
};

type LineupPlayer = {
  name: string;
  jersey: string;
  position: string;
  starter: boolean;
  subbedIn: boolean;
  goals: number;
  assists: number;
  yellowCards: number;
  redCards: number;
};

const MATCH_SURFACES = {
  shell: 'border border-white/55 bg-white/82 backdrop-blur-sm shadow-[0_12px_30px_-24px_rgba(15,23,42,0.28)]',
  softShell: 'border border-slate-200/65 bg-white/75 backdrop-blur-sm',
  page: 'bg-slate-100',
};

function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  return fallback;
}

function parseMinute(raw: unknown): number {
  const normalized = asString(raw).replace(/'/g, '').replace(/\+.*/, '');
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function extractLineupPlayers(raw: unknown): LineupPlayer[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { players?: unknown }).players)
      ? (raw as { players: unknown[] }).players
      : [];

  return list.map((item) => {
    const player = item as Record<string, unknown>;

    return {
      name: asString(player.name || player.player, 'Unknown'),
      jersey: asString(player.jersey || player.number, ''),
      position: asString(player.position, ''),
      starter: asBoolean(player.starter, false) || asBoolean(player.isStarter, false),
      subbedIn: asBoolean(player.subbedIn, false) || asBoolean(player.sub_in, false),
      goals: asNumber(player.goals, 0),
      assists: asNumber(player.assists, 0),
      yellowCards: asNumber(player.yellowCards || player.yellow_cards, 0),
      redCards: asNumber(player.redCards || player.red_cards, 0),
    };
  });
}

function formatPercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

function MomentumArc({
  events,
  homeColor,
  awayColor,
  homeAbbr,
  awayAbbr,
}: {
  events: MatchEvent[];
  homeColor: string;
  awayColor: string;
  homeAbbr: string;
  awayAbbr: string;
}) {
  const svgId = useId().replace(/:/g, '');
  const homeGradId = `${svgId}-home-grad`;
  const awayGradId = `${svgId}-away-grad`;
  const clipAboveId = `${svgId}-clip-up`;
  const clipBelowId = `${svgId}-clip-down`;

  const width = 520;
  const height = 130;
  const pad = { top: 18, bottom: 24, left: 0, right: 0 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const points: Array<{ min: number; val: number }> = [{ min: 0, val: 50 }];
  let momentum = 50;

  for (let minute = 5; minute <= 90; minute += 5) {
    const inRange = events.filter((event) => event.min > minute - 5 && event.min <= minute);

    for (const event of inRange) {
      if (event.type === 'goal') momentum += event.side === 'home' ? 15 : -15;
      if (event.type === 'red') momentum += event.side === 'home' ? -10 : 10;
      if (event.type === 'yellow') momentum += event.side === 'home' ? -3 : 3;
    }

    momentum = momentum + (50 - momentum) * 0.15;
    momentum = Math.max(10, Math.min(90, momentum));
    points.push({ min: minute, val: momentum });
  }

  const toX = (min: number) => pad.left + (min / 90) * plotW;
  const toY = (val: number) => pad.top + plotH - (val / 100) * plotH;

  const mapped = points.map((point) => [toX(point.min), toY(point.val)] as const);

  let linePath = `M ${mapped[0][0]} ${mapped[0][1]}`;
  for (let i = 1; i < mapped.length; i += 1) {
    const [x0, y0] = mapped[i - 1];
    const [x1, y1] = mapped[i];
    const cx = (x0 + x1) / 2;
    linePath += ` C ${cx} ${y0}, ${cx} ${y1}, ${x1} ${y1}`;
  }

  const midY = toY(50);
  const areaPath = `${linePath} L ${mapped[mapped.length - 1][0]} ${midY} L ${mapped[0][0]} ${midY} Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto block">
      <defs>
        <linearGradient id={homeGradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={homeColor} stopOpacity="0.25" />
          <stop offset="100%" stopColor={homeColor} stopOpacity="0" />
        </linearGradient>
        <linearGradient id={awayGradId} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor={awayColor} stopOpacity="0.2" />
          <stop offset="100%" stopColor={awayColor} stopOpacity="0" />
        </linearGradient>
        <clipPath id={clipAboveId}>
          <rect x="0" y="0" width={width} height={midY} />
        </clipPath>
        <clipPath id={clipBelowId}>
          <rect x="0" y={midY} width={width} height={height - midY} />
        </clipPath>
      </defs>

      <line x1={pad.left} y1={midY} x2={width - pad.right} y2={midY} stroke="rgba(15,23,42,0.08)" strokeWidth="1" />
      <path d={areaPath} fill={`url(#${homeGradId})`} clipPath={`url(#${clipAboveId})`} />
      <path d={areaPath} fill={`url(#${awayGradId})`} clipPath={`url(#${clipBelowId})`} />
      <path d={linePath} fill="none" stroke="rgba(15,23,42,0.3)" strokeWidth="1.5" strokeLinecap="round" />

      <line
        x1={toX(45)}
        y1={pad.top - 2}
        x2={toX(45)}
        y2={height - pad.bottom + 2}
        stroke="rgba(15,23,42,0.08)"
        strokeWidth="1"
        strokeDasharray="3 3"
      />
      <text x={toX(45)} y={height - 6} textAnchor="middle" fill="rgba(15,23,42,0.2)" fontSize="7" fontFamily="JetBrains Mono, monospace">
        HT
      </text>

      {events
        .filter((event) => event.type === 'goal' || event.type === 'red')
        .map((event, index) => {
          const x = toX(event.min);
          const markerColor = event.type === 'red' ? C.loss : event.side === 'home' ? homeColor : awayColor;

          return (
            <g key={`${event.min}-${event.type}-${index}`}>
              <line x1={x} y1={pad.top} x2={x} y2={height - pad.bottom} stroke="rgba(15,23,42,0.12)" strokeWidth="1" />
              <circle cx={x} cy={event.side === 'home' ? pad.top + 3 : height - pad.bottom - 3} r="3" fill={markerColor} stroke="rgba(248,250,252,1)" strokeWidth="1.5" />
              <text
                x={x}
                y={event.side === 'home' ? pad.top - 4 : height - pad.bottom + 12}
                textAnchor="middle"
                fill="rgba(15,23,42,0.35)"
                fontSize="7"
                fontFamily="JetBrains Mono, monospace"
              >
                {event.min}'
              </text>
            </g>
          );
        })}

      <text x={pad.left + 4} y={pad.top + 9} fill={homeColor} fontSize="7" fontFamily="JetBrains Mono, monospace" fontWeight="700" opacity="0.6">
        {homeAbbr}
      </text>
      <text x={pad.left + 4} y={height - pad.bottom - 4} fill={awayColor} fontSize="7" fontFamily="JetBrains Mono, monospace" fontWeight="700" opacity="0.6">
        {awayAbbr}
      </text>

      {[0, 15, 30, 60, 75, 90].map((minute) => (
        <g key={minute}>
          <line x1={toX(minute)} y1={height - pad.bottom} x2={toX(minute)} y2={height - pad.bottom + 3} stroke="rgba(15,23,42,0.12)" strokeWidth="1" />
          <text x={toX(minute)} y={height - 6} textAnchor="middle" fill="rgba(15,23,42,0.2)" fontSize="7" fontFamily="JetBrains Mono, monospace">
            {minute}
          </text>
        </g>
      ))}
    </svg>
  );
}

function StatComparisonRow({
  row,
  homeColor,
  awayColor,
}: {
  row: StatRow;
  homeColor: string;
  awayColor: string;
}) {
  const total = row.homeValue + row.awayValue;
  const homePct = total > 0 ? (row.homeValue / total) * 100 : 50;
  const awayPct = Math.max(0, 100 - homePct);

  return (
    <div className="border-b border-slate-100 last:border-b-0 py-2.5 sm:py-3">
      <div className="sm:hidden">
        <div className="flex items-center justify-between gap-2 text-xs font-semibold tabular-nums">
          <span className="text-slate-700">{row.homeDisplay}</span>
          <span className="uppercase tracking-widest text-[10px] text-slate-500">{row.label}</span>
          <span className="text-slate-700">{row.awayDisplay}</span>
        </div>
        <div className="mt-1.5 grid grid-cols-2 gap-2">
          <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${homePct}%`, backgroundColor: homeColor }} />
          </div>
          <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full rounded-full ml-auto" style={{ width: `${awayPct}%`, backgroundColor: awayColor }} />
          </div>
        </div>
      </div>

      <div className="hidden sm:grid sm:grid-cols-[64px_1fr_110px_1fr_64px] items-center gap-3">
        <div className="text-right text-sm font-semibold tabular-nums text-slate-700">{row.homeDisplay}</div>
        <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${homePct}%`, backgroundColor: homeColor }} />
        </div>
        <div className="text-center text-[11px] font-semibold uppercase tracking-widest text-slate-500">{row.label}</div>
        <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
          <div className="h-full rounded-full ml-auto" style={{ width: `${awayPct}%`, backgroundColor: awayColor }} />
        </div>
        <div className="text-left text-sm font-semibold tabular-nums text-slate-700">{row.awayDisplay}</div>
      </div>
    </div>
  );
}

function OddsQuoteCell({
  label,
  odds,
  isWinner,
}: {
  label: string;
  odds: number | null;
  isWinner: boolean;
}) {
  return (
    <div className={`rounded-lg px-2.5 sm:px-3 py-2.5 sm:py-3 text-center ${isWinner ? 'border-emerald-200 bg-emerald-50/80' : MATCH_SURFACES.softShell}`}> 
      <div className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</div>
      <div className={`mt-1 text-lg sm:text-xl font-semibold tabular-nums ${isWinner ? 'text-emerald-700' : 'text-slate-900'}`}>{fmtOdds(odds)}</div>
      <div className="mt-1 text-[10px] sm:text-[11px] text-slate-500">{odds != null ? `${(impliedProb(odds) * 100).toFixed(1)}% implied` : 'No line'}</div>
      {isWinner && <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-700">Result</div>}
    </div>
  );
}

function LineupPlayerRow({ player, accentColor }: { player: LineupPlayer; accentColor: string }) {
  return (
    <div className={`flex items-center gap-2 rounded-md ${MATCH_SURFACES.softShell} px-2 sm:px-2.5 py-1.5 sm:py-2`}>
      <div className="w-5 sm:w-6 text-right text-[10px] sm:text-[11px] font-semibold tabular-nums" style={{ color: accentColor }}>
        {player.jersey || '—'}
      </div>
      <div className="h-4 w-px" style={{ backgroundColor: accentColor, opacity: 0.35 }} />
      <div className="min-w-0 flex-1">
        <div className={`truncate text-[13px] sm:text-sm ${player.redCards > 0 ? 'text-rose-700 line-through' : 'text-slate-800'} font-medium`}>
          {player.name}
        </div>
        <div className="text-[10px] sm:text-[11px] text-slate-500">{player.position || 'Position n/a'}</div>
      </div>
      <div className="flex items-center gap-1 text-[9px] sm:text-[10px] font-semibold tabular-nums">
        {player.goals > 0 && <span className="text-slate-700">G{player.goals}</span>}
        {player.assists > 0 && <span className="text-slate-500">A{player.assists}</span>}
        {player.yellowCards > 0 && <span className="text-amber-600">Y{player.yellowCards}</span>}
        {player.redCards > 0 && <span className="text-rose-700">R{player.redCards}</span>}
      </div>
    </div>
  );
}

export default function MatchPage() {
  const { slug } = useParams<{ slug: string }>();

  const [match, setMatch] = useState<SoccerPostgame | null>(null);
  const [homeMeta, setHomeMeta] = useState<TeamMeta | null>(null);
  const [awayMeta, setAwayMeta] = useState<TeamMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabId>('overview');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 60);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    let alive = true;

    async function init() {
      if (!slug) return;

      const parsed = parseMatchSlug(slug);
      if (!parsed) {
        if (alive) setLoading(false);
        return;
      }

      const nextMatch = await fetchMatchBySlug(parsed.home, parsed.away, parsed.date);
      if (!alive) return;

      setMatch(nextMatch);

      if (nextMatch) {
        const [homeTeamMeta, awayTeamMeta] = await Promise.all([
          fetchTeamMeta(nextMatch.home_team),
          fetchTeamMeta(nextMatch.away_team),
        ]);

        if (!alive) return;

        setHomeMeta((homeTeamMeta as TeamMeta | null) ?? null);
        setAwayMeta((awayTeamMeta as TeamMeta | null) ?? null);

        document.title = `${nextMatch.home_team} ${nextMatch.home_score}–${nextMatch.away_score} ${nextMatch.away_team} | ${LEAGUE_SHORT[nextMatch.league_id] || nextMatch.league_id} | The Drip`;
      }

      if (alive) setLoading(false);
    }

    void init();

    return () => {
      alive = false;
    };
  }, [slug]);

  const homeColor = homeMeta?.color || C.accent;
  const awayColor = awayMeta?.color || C.text2;

  const homeAbbr = homeMeta?.abbreviation || match?.home_team.slice(0, 3).toUpperCase() || 'HOM';
  const awayAbbr = awayMeta?.abbreviation || match?.away_team.slice(0, 3).toUpperCase() || 'AWY';

  const hasOdds = match?.dk_home_ml != null;

  useEffect(() => {
    if (!hasOdds && tab === 'odds') setTab('overview');
  }, [hasOdds, tab]);

  const spreadResult = match ? getSpreadResult(match) : null;
  const totalResult = match ? getTotalResult(match) : null;
  const mlResult = match ? getMLResult(match) : null;

  const matchEvents = useMemo<MatchEvent[]>(() => {
    if (!match) return [];

    const events: MatchEvent[] = [];

    if (Array.isArray(match.goals)) {
      for (const goal of match.goals as Array<Record<string, unknown>>) {
        const side = asString(goal.side).toLowerCase() === 'away' ? 'away' : 'home';

        events.push({
          min: parseMinute(goal.minute),
          raw: asString(goal.minute, `${parseMinute(goal.minute)}'`),
          type: 'goal',
          side,
          player: asString(goal.scorer, 'Scorer'),
          detail: goal.assister ? `Assist: ${asString(goal.assister)}` : asString(goal.description),
        });
      }
    }

    if (Array.isArray(match.cards)) {
      for (const card of match.cards as Array<Record<string, unknown>>) {
        const side = asString(card.side).toLowerCase() === 'away' ? 'away' : 'home';
        const kind = asString(card.card_type).toLowerCase() === 'red' ? 'red' : 'yellow';

        events.push({
          min: parseMinute(card.minute),
          raw: asString(card.minute, `${parseMinute(card.minute)}'`),
          type: kind,
          side,
          player: asString(card.player, 'Card'),
          detail: kind === 'red' ? 'Red card' : 'Yellow card',
        });
      }
    }

    return events.sort((a, b) => a.min - b.min);
  }, [match]);

  const timelineEvents = useMemo(() => {
    return matchEvents.slice().sort((a, b) => b.min - a.min);
  }, [matchEvents]);

  const statRows = useMemo<StatRow[]>(() => {
    if (!match) return [];

    const rows: Array<StatRow | null> = [
      {
        label: 'Possession',
        homeDisplay: match.home_possession != null ? `${match.home_possession.toFixed(1)}%` : '—',
        awayDisplay: match.away_possession != null ? `${match.away_possession.toFixed(1)}%` : '—',
        homeValue: match.home_possession ?? 0,
        awayValue: match.away_possession ?? 0,
      },
      {
        label: 'Shots',
        homeDisplay: String(match.home_shots ?? 0),
        awayDisplay: String(match.away_shots ?? 0),
        homeValue: match.home_shots ?? 0,
        awayValue: match.away_shots ?? 0,
      },
      {
        label: 'On Target',
        homeDisplay: String(match.home_shots_on_target ?? 0),
        awayDisplay: String(match.away_shots_on_target ?? 0),
        homeValue: match.home_shots_on_target ?? 0,
        awayValue: match.away_shots_on_target ?? 0,
      },
      {
        label: 'Passes',
        homeDisplay: String(match.home_passes ?? 0),
        awayDisplay: String(match.away_passes ?? 0),
        homeValue: match.home_passes ?? 0,
        awayValue: match.away_passes ?? 0,
      },
      {
        label: 'Pass %',
        homeDisplay: formatPercent(match.home_pass_pct),
        awayDisplay: formatPercent(match.away_pass_pct),
        homeValue: match.home_pass_pct != null ? match.home_pass_pct * 100 : 0,
        awayValue: match.away_pass_pct != null ? match.away_pass_pct * 100 : 0,
      },
      {
        label: 'Corners',
        homeDisplay: String(match.home_corners ?? 0),
        awayDisplay: String(match.away_corners ?? 0),
        homeValue: match.home_corners ?? 0,
        awayValue: match.away_corners ?? 0,
      },
      {
        label: 'Fouls',
        homeDisplay: String(match.home_fouls ?? 0),
        awayDisplay: String(match.away_fouls ?? 0),
        homeValue: match.home_fouls ?? 0,
        awayValue: match.away_fouls ?? 0,
      },
      {
        label: 'Saves',
        homeDisplay: String(match.home_saves ?? 0),
        awayDisplay: String(match.away_saves ?? 0),
        homeValue: match.home_saves ?? 0,
        awayValue: match.away_saves ?? 0,
      },
      {
        label: 'Interceptions',
        homeDisplay: String(match.home_interceptions ?? 0),
        awayDisplay: String(match.away_interceptions ?? 0),
        homeValue: match.home_interceptions ?? 0,
        awayValue: match.away_interceptions ?? 0,
      },
      {
        label: 'Offsides',
        homeDisplay: String(match.home_offsides ?? 0),
        awayDisplay: String(match.away_offsides ?? 0),
        homeValue: match.home_offsides ?? 0,
        awayValue: match.away_offsides ?? 0,
      },
    ];

    return rows.filter((row): row is StatRow => row !== null);
  }, [match]);

  const homeLineup = useMemo(() => extractLineupPlayers(match?.home_lineup), [match?.home_lineup]);
  const awayLineup = useMemo(() => extractLineupPlayers(match?.away_lineup), [match?.away_lineup]);

  if (loading) {
    return (
      <div className={`h-(--vvh,100vh) ${MATCH_SURFACES.page} text-slate-500 flex items-center justify-center`}>
        <div className="text-xs font-semibold uppercase tracking-[0.16em]">Loading Match Report</div>
      </div>
    );
  }

  if (!match) {
    return (
      <div className={`h-(--vvh,100vh) ${MATCH_SURFACES.page} text-slate-900 flex flex-col items-center justify-center gap-4 px-4 text-center`}>
        <div className="text-2xl font-semibold tracking-tight">Match not found</div>
        <Link
          to="/edge"
          className="rounded-lg border border-slate-200/65 bg-white/75 px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-600 hover:bg-white/90"
        >
          Back to Edge
        </Link>
      </div>
    );
  }

  const leagueLabel = LEAGUE_LABELS[match.league_id] || LEAGUE_SHORT[match.league_id] || match.league_id;
  const formattedDate = new Date(match.start_time).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const homeSpreadText = match.dk_spread != null ? fmtOdds(match.dk_spread) : '—';
  const awaySpreadText = match.dk_spread != null ? fmtOdds(-match.dk_spread) : '—';

  const totalGoals = match.home_score + match.away_score;
  const totalShots = (match.home_shots ?? 0) + (match.away_shots ?? 0);
  const totalOnTarget = (match.home_shots_on_target ?? 0) + (match.away_shots_on_target ?? 0);
  const totalCorners = (match.home_corners ?? 0) + (match.away_corners ?? 0);

  const statusLabel = /final|ft|ended|full/i.test(match.match_status || '') ? 'Final' : match.match_status;

  const venueParts = [
    match.venue || null,
    match.attendance ? `${match.attendance.toLocaleString()} attendance` : null,
    match.referee ? `Ref ${match.referee}` : null,
  ].filter(Boolean) as string[];

  const tabs: Array<{ id: TabId; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'stats', label: 'Stats' },
    ...(hasOdds ? [{ id: 'odds' as TabId, label: 'Odds' }] : []),
    { id: 'lineups', label: 'Lineups' },
  ];

  const summaryText = `${match.home_team} ${match.home_score > match.away_score ? 'beat' : match.home_score < match.away_score ? 'lost to' : 'drew with'} ${match.away_team} ${match.home_score}-${match.away_score}. ${match.home_possession != null && match.away_possession != null ? `${match.home_possession > match.away_possession ? match.home_team : match.away_team} led possession at ${Math.max(match.home_possession, match.away_possession).toFixed(1)}%. ` : ''}${totalShots > 0 ? `The match produced ${totalShots} shots (${totalOnTarget} on target). ` : ''}${match.dk_home_ml != null ? `${match.home_team} closed ${fmtOdds(match.dk_home_ml)} on DraftKings.` : ''}`;

  return (
    <div className={`h-(--vvh,100vh) overflow-y-auto ${MATCH_SURFACES.page} text-slate-900`} style={{ opacity: ready ? 1 : 0, transition: 'opacity 0.45s ease-out' }}>
      <header className="sticky top-0 z-40 border-b border-slate-200/55 bg-white/75 backdrop-blur">
        <div className="mx-auto w-full max-w-6xl px-4 md:px-6 py-2.5 sm:py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            <Link
              to="/edge"
              className="rounded-md border border-slate-200/65 px-2 sm:px-2.5 py-1.5 text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 hover:text-slate-900 bg-white/60 hover:bg-white/85 whitespace-nowrap"
            >
              Edge
            </Link>
            <Link
              to={teamUrl(match.home_team)}
              className="rounded-md border border-slate-200/65 px-2 sm:px-2.5 py-1.5 text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 hover:text-slate-900 bg-white/60 hover:bg-white/85 whitespace-nowrap"
            >
              {homeAbbr}
            </Link>
            <Link
              to={teamUrl(match.away_team)}
              className="rounded-md border border-slate-200/65 px-2 sm:px-2.5 py-1.5 text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 hover:text-slate-900 bg-white/60 hover:bg-white/85 whitespace-nowrap"
            >
              {awayAbbr}
            </Link>
          </div>
          <div className="hidden sm:block text-[11px] font-medium text-slate-500">{leagueLabel} · {formattedDate}</div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 md:px-6 py-5 md:py-8 space-y-4 md:space-y-6">
        <section className={`rounded-2xl ${MATCH_SURFACES.shell} p-4 md:p-6 space-y-4 md:space-y-5`}>
          <div className="flex items-center justify-between gap-3">
            <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: homeColor }} />
              {leagueLabel}
            </div>
            <div className="text-[10px] sm:text-[11px] font-medium text-slate-500">{formattedDate}</div>
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:gap-5">
            <Link to={teamUrl(match.home_team)} className={`flex flex-col items-center gap-1.5 sm:gap-2 text-center rounded-xl ${MATCH_SURFACES.softShell} px-2 py-3 sm:py-4 hover:bg-white/85 transition`}>
              {homeMeta?.logo_url ? (
                <TeamLogo
                  logo={homeMeta.logo_url}
                  name={match.home_team}
                  className="h-10 w-10 sm:h-14 sm:w-14"
                  teamColor={homeColor}
                />
              ) : (
                <div className="h-10 w-10 sm:h-14 sm:w-14 rounded-full flex items-center justify-center text-base sm:text-xl font-bold" style={{ backgroundColor: homeColor, color: C.surface }}>
                  {match.home_team.slice(0, 1)}
                </div>
              )}
              <div className="text-[13px] sm:text-sm font-semibold text-slate-900 leading-tight">{match.home_team}</div>
              <div className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{homeAbbr}</div>
            </Link>

            <div className="text-center px-1 sm:px-2">
              <div className="flex items-end justify-center gap-2 sm:gap-3">
                <span className="text-4xl sm:text-5xl md:text-6xl font-semibold leading-none tabular-nums tracking-tight">{match.home_score}</span>
                <span className="text-2xl sm:text-3xl text-slate-300 leading-none">-</span>
                <span className="text-4xl sm:text-5xl md:text-6xl font-semibold leading-none tabular-nums tracking-tight">{match.away_score}</span>
              </div>
              <div className="mt-1.5 sm:mt-2 inline-flex items-center rounded-full border border-slate-200/65 bg-white/65 px-2.5 sm:px-3 py-0.5 sm:py-1 text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                {statusLabel || 'Final'}
              </div>
            </div>

            <Link to={teamUrl(match.away_team)} className={`flex flex-col items-center gap-1.5 sm:gap-2 text-center rounded-xl ${MATCH_SURFACES.softShell} px-2 py-3 sm:py-4 hover:bg-white/85 transition`}>
              {awayMeta?.logo_url ? (
                <TeamLogo
                  logo={awayMeta.logo_url}
                  name={match.away_team}
                  className="h-10 w-10 sm:h-14 sm:w-14"
                  teamColor={awayColor}
                />
              ) : (
                <div className="h-10 w-10 sm:h-14 sm:w-14 rounded-full flex items-center justify-center text-base sm:text-xl font-bold" style={{ backgroundColor: awayColor, color: C.surface }}>
                  {match.away_team.slice(0, 1)}
                </div>
              )}
              <div className="text-[13px] sm:text-sm font-semibold text-slate-900 leading-tight">{match.away_team}</div>
              <div className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{awayAbbr}</div>
            </Link>
          </div>

          {venueParts.length > 0 && (
            <div className="text-center text-[11px] sm:text-xs text-slate-500">{venueParts.join(' · ')}</div>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <article className={`rounded-lg ${MATCH_SURFACES.softShell} px-2.5 sm:px-3 py-2 sm:py-2.5`}>
              <div className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Total Shots</div>
              <div className="mt-0.5 sm:mt-1 text-lg sm:text-xl font-semibold tabular-nums text-slate-900">{totalShots}</div>
              <div className="mt-0.5 sm:mt-1 text-[10px] sm:text-[11px] text-slate-500">{totalOnTarget} on target</div>
            </article>
            <article className={`rounded-lg ${MATCH_SURFACES.softShell} px-2.5 sm:px-3 py-2 sm:py-2.5`}>
              <div className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Possession</div>
              <div className="mt-0.5 sm:mt-1 text-lg sm:text-xl font-semibold tabular-nums text-slate-900">{match.home_possession ?? '—'}% / {match.away_possession ?? '—'}%</div>
              <div className="mt-0.5 sm:mt-1 text-[10px] sm:text-[11px] text-slate-500">Home vs Away</div>
            </article>
            <article className={`rounded-lg ${MATCH_SURFACES.softShell} px-2.5 sm:px-3 py-2 sm:py-2.5`}>
              <div className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Total Goals</div>
              <div className="mt-0.5 sm:mt-1 text-lg sm:text-xl font-semibold tabular-nums text-slate-900">{totalGoals}</div>
              <div className="mt-0.5 sm:mt-1 text-[10px] sm:text-[11px] text-slate-500">Full-time output</div>
            </article>
            <article className={`rounded-lg ${MATCH_SURFACES.softShell} px-2.5 sm:px-3 py-2 sm:py-2.5`}>
              <div className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Corners</div>
              <div className="mt-0.5 sm:mt-1 text-lg sm:text-xl font-semibold tabular-nums text-slate-900">{totalCorners}</div>
              <div className="mt-0.5 sm:mt-1 text-[10px] sm:text-[11px] text-slate-500">Set-piece volume</div>
            </article>
          </div>
        </section>

        {matchEvents.length > 0 && (
          <section className={`rounded-2xl ${MATCH_SURFACES.shell} p-3 sm:p-4 md:p-5`}>
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Match Momentum</div>
            <div className={`mt-2 sm:mt-3 rounded-lg ${MATCH_SURFACES.softShell} p-1.5 sm:p-2`}>
              <MomentumArc events={matchEvents} homeColor={homeColor} awayColor={awayColor} homeAbbr={homeAbbr} awayAbbr={awayAbbr} />
            </div>
          </section>
        )}

        <section className={`rounded-2xl ${MATCH_SURFACES.shell} p-1.5 sm:p-2`}>
          <div className="flex gap-1 overflow-x-auto no-scrollbar">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`rounded-lg px-3 sm:px-4 py-1.5 sm:py-2 text-[11px] sm:text-xs font-semibold uppercase tracking-[0.12em] whitespace-nowrap transition ${tab === item.id ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-white/85 hover:text-slate-900'}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </section>

        {tab === 'overview' && (
          <section className="grid gap-3 sm:gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <article className={`rounded-2xl ${MATCH_SURFACES.shell} overflow-hidden`}>
                <div className="px-3 sm:px-4 py-2.5 sm:py-3 border-b border-slate-100/70 text-sm font-semibold text-slate-800">Key Moments</div>
              <div className="p-2.5 sm:p-3 md:p-4 space-y-1">
                {timelineEvents.length === 0 ? (
                  <div className="text-sm text-slate-500">No timeline events available.</div>
                ) : (
                  timelineEvents.map((event, index) => {
                    const marker = event.type === 'goal' ? 'Goal' : event.type === 'red' ? 'Red Card' : 'Yellow Card';
                    const markerTone =
                      event.type === 'goal'
                        ? 'text-slate-900'
                        : event.type === 'red'
                          ? 'text-rose-700'
                          : 'text-amber-700';

                    return (
                      <div key={`${event.raw}-${event.type}-${index}`} className={`grid grid-cols-[36px_1fr] sm:grid-cols-[44px_1fr_auto] gap-2 sm:gap-3 rounded-lg ${MATCH_SURFACES.softShell} px-2.5 sm:px-3 py-2 sm:py-2.5`}>
                        <div className="text-[10px] sm:text-[11px] font-semibold tabular-nums text-slate-500 text-right">{event.raw}</div>
                        <div className="min-w-0">
                          <div className={`text-[13px] sm:text-sm font-semibold ${markerTone}`}>{event.player}</div>
                          {event.detail && <div className="text-[10px] sm:text-[11px] text-slate-500 mt-0.5">{event.detail}</div>}
                          <div className="mt-0.5 sm:hidden text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                            {marker} · {event.side === 'home' ? homeAbbr : awayAbbr}
                          </div>
                        </div>
                        <div className="hidden sm:block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 self-center">
                          {marker} · {event.side === 'home' ? homeAbbr : awayAbbr}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </article>

            <div className="space-y-4">
              <article className={`rounded-2xl ${MATCH_SURFACES.shell} p-3 sm:p-4`}>
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Match Summary</div>
                <p className="mt-2.5 sm:mt-3 text-[13px] sm:text-sm leading-6 sm:leading-7 text-slate-700">{summaryText}</p>
              </article>

              <article className={`rounded-2xl ${MATCH_SURFACES.shell} p-3 sm:p-4`}>
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Market Close</div>
                <div className="mt-2.5 sm:mt-3 space-y-2 text-xs sm:text-sm">
                  <div className="flex items-start sm:items-center justify-between gap-3">
                    <span className="text-slate-500">Moneyline winner</span>
                    <span className="font-semibold text-slate-900 text-right">
                      {mlResult === 'home' ? match.home_team : mlResult === 'away' ? match.away_team : 'Draw'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-slate-500">Spread result</span>
                    <span className={`font-semibold ${spreadResult?.result === 'covered' ? 'text-emerald-700' : spreadResult?.result === 'failed' ? 'text-rose-700' : 'text-slate-700'}`}>
                      {spreadResult ? spreadResult.result.toUpperCase() : 'Off board'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-slate-500">Total result</span>
                    <span className={`font-semibold ${totalResult?.result === 'over' || totalResult?.result === 'under' ? 'text-slate-900' : 'text-slate-700'}`}>
                      {totalResult ? `${String(totalResult.result).toUpperCase()} (${totalGoals})` : 'Off board'}
                    </span>
                  </div>
                </div>
              </article>
            </div>
          </section>
        )}

        {tab === 'stats' && (
          <section className={`rounded-2xl ${MATCH_SURFACES.shell} overflow-hidden`}>
            <div className="px-3 sm:px-4 py-2.5 sm:py-3 border-b border-slate-100 flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-slate-800">Stat Comparison</div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{homeAbbr} vs {awayAbbr}</div>
            </div>

            <div className="px-3 sm:px-4 py-2 sm:py-3">
              {statRows.map((row) => (
                <StatComparisonRow key={row.label} row={row} homeColor={homeColor} awayColor={awayColor} />
              ))}
            </div>
          </section>
        )}

        {tab === 'odds' && hasOdds && (
          <section className="grid gap-3 sm:gap-4 lg:grid-cols-2">
            <article className={`rounded-2xl ${MATCH_SURFACES.shell} p-3 sm:p-4 space-y-2.5 sm:space-y-3`}>
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Closing Moneyline</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <OddsQuoteCell label={match.home_team} odds={match.dk_home_ml} isWinner={mlResult === 'home'} />
                <OddsQuoteCell label="Draw" odds={match.dk_draw_ml} isWinner={mlResult === 'draw'} />
                <OddsQuoteCell label={match.away_team} odds={match.dk_away_ml} isWinner={mlResult === 'away'} />
              </div>
            </article>

            <article className={`rounded-2xl ${MATCH_SURFACES.shell} p-3 sm:p-4 space-y-2.5 sm:space-y-3`}>
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Spread + Total</div>
              <div className={`rounded-lg ${MATCH_SURFACES.softShell} px-2.5 sm:px-3 py-2.5 sm:py-3`}>
                <div className="flex items-center justify-between text-xs sm:text-sm">
                  <span className="text-slate-500">{match.home_team}</span>
                  <span className="font-semibold tabular-nums text-slate-900">{homeSpreadText} ({fmtOdds(match.dk_home_spread_price)})</span>
                </div>
                <div className="mt-2 flex items-center justify-between text-xs sm:text-sm">
                  <span className="text-slate-500">{match.away_team}</span>
                  <span className="font-semibold tabular-nums text-slate-900">{awaySpreadText} ({fmtOdds(match.dk_away_spread_price)})</span>
                </div>
                <div className="mt-2.5 sm:mt-3 border-t border-slate-200 pt-2 text-xs sm:text-sm">
                  <span className="text-slate-500">Result: </span>
                  <span className={`font-semibold ${spreadResult?.result === 'covered' ? 'text-emerald-700' : spreadResult?.result === 'failed' ? 'text-rose-700' : 'text-slate-700'}`}>
                    {spreadResult ? spreadResult.result.toUpperCase() : 'OFF'}
                  </span>
                </div>
              </div>

              <div className={`rounded-lg ${MATCH_SURFACES.softShell} px-2.5 sm:px-3 py-2.5 sm:py-3`}>
                <div className="flex items-center justify-between text-xs sm:text-sm">
                  <span className="text-slate-500">Over {match.dk_total ?? '—'}</span>
                  <span className="font-semibold tabular-nums text-slate-900">{fmtOdds(match.dk_over_price)}</span>
                </div>
                <div className="mt-2 flex items-center justify-between text-xs sm:text-sm">
                  <span className="text-slate-500">Under {match.dk_total ?? '—'}</span>
                  <span className="font-semibold tabular-nums text-slate-900">{fmtOdds(match.dk_under_price)}</span>
                </div>
                <div className="mt-2.5 sm:mt-3 border-t border-slate-200 pt-2 text-xs sm:text-sm">
                  <span className="text-slate-500">Result: </span>
                  <span className="font-semibold text-slate-900">{totalResult ? `${String(totalResult.result).toUpperCase()} (${totalGoals})` : 'OFF'}</span>
                </div>
              </div>
            </article>
          </section>
        )}

        {tab === 'lineups' && (
          <section className="grid gap-3 sm:gap-4 lg:grid-cols-2">
            {[
              { label: match.home_team, players: homeLineup, accent: homeColor, logo: homeMeta?.logo_url },
              { label: match.away_team, players: awayLineup, accent: awayColor, logo: awayMeta?.logo_url },
            ].map((sidePanel) => {
              const starters = sidePanel.players.filter((player) => player.starter);
              const bench = sidePanel.players.filter((player) => !player.starter && player.subbedIn);

              return (
                <article key={sidePanel.label} className={`rounded-2xl ${MATCH_SURFACES.shell} overflow-hidden`}>
                  <div className="px-3 sm:px-4 py-2.5 sm:py-3 border-b border-slate-100 flex items-center gap-2">
                    {sidePanel.logo && (
                      <TeamLogo
                        logo={sidePanel.logo}
                        name={sidePanel.label}
                        className="h-5 w-5"
                        teamColor={sidePanel.accent}
                      />
                    )}
                    <div className="text-sm font-semibold text-slate-800">{sidePanel.label}</div>
                    <div className="ml-auto text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{starters.length} starters</div>
                  </div>

                  <div className="p-2.5 sm:p-3 space-y-1.5 sm:space-y-2">
                    {starters.length === 0 && <div className="text-sm text-slate-500">No lineup data available.</div>}
                    {starters.map((player, idx) => (
                      <LineupPlayerRow key={`${sidePanel.label}-starter-${idx}`} player={player} accentColor={sidePanel.accent} />
                    ))}

                    {bench.length > 0 && (
                      <>
                        <div className="pt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Used Substitutes</div>
                        {bench.map((player, idx) => (
                          <LineupPlayerRow key={`${sidePanel.label}-bench-${idx}`} player={player} accentColor={sidePanel.accent} />
                        ))}
                      </>
                    )}
                  </div>
                </article>
              );
            })}
          </section>
        )}
      </main>
    </div>
  );
}
