import React, { type FC, useMemo } from 'react';
import { formatMatchDateLabel, formatPct, formatSignedNumber } from '@/lib/postgamePages';
import { useMatchBySlug } from '@/hooks/usePostgame';
import { cn } from '@/lib/essence';
import { getTeamLogo } from '@/lib/teamColors';
import { CalendarClock, Flag, House, Info, MapPin, Shield, UserRound } from 'lucide-react';
import TeamLogo from '@/components/shared/TeamLogo';
import {
  Card,
  CardBody,
  CardHeader,
  DataPill,
  EmptyBlock,
  LoadingBlock,
  PageShell,
  SectionLabel,
  TopNav,
  ValueText,
} from './PostgamePrimitives';

interface MatchPageProps {
  slug: string;
}

type TimelineEvent = {
  type: string;
  minute: number | null;
  minuteLabel: string;
  teamSide: 'home' | 'away' | 'neutral';
  playerName: string | null;
  detail: string | null;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const minuteToPercent = (minute: number | null): number => {
  if (minute === null) return 0;
  return clamp((minute / 95) * 100, 0, 100);
};

const boolLabel = (value: boolean | null): string => {
  if (value === null) return '—';
  return value ? 'Yes' : 'No';
};

const sideLabel = (
  side: 'home' | 'away' | 'neutral',
  homeTeam: string,
  awayTeam: string,
): string => {
  if (side === 'home') return homeTeam;
  if (side === 'away') return awayTeam;
  return 'Neutral';
};

const eventTypeLabel = (type: string): string => {
  if (type === 'goal') return 'Goal';
  if (type === 'card') return 'Card';
  if (type === 'substitution') return 'Sub';
  return 'Event';
};

const poolLabel = (pool: string): string => {
  if (pool === 'anytime') return 'Anytime';
  if (pool === 'first') return 'First Goal';
  if (pool === 'last') return 'Last Goal';
  if (pool === 'live_anytime') return 'Live Anytime';
  return pool;
};

const impliedProb = (moneyline: number | null): number | null => {
  if (moneyline === null) return null;
  if (moneyline > 0) return (100 / (moneyline + 100)) * 100;
  return (Math.abs(moneyline) / (Math.abs(moneyline) + 100)) * 100;
};

const formatUnits = (value: number | null): string => {
  if (value === null) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}u`;
};

const compactEventDetail = (detail: string | null): string | null => {
  if (!detail) return null;
  const cleaned = detail.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= 140) return cleaned;
  return `${cleaned.slice(0, 137)}…`;
};

const parseNumeric = (value: string | number): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  const cleaned = String(value)
    .replace('%', '')
    .replace(/,/g, '')
    .trim();

  if (cleaned.length === 0 || cleaned === '—') return null;

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};

const scoreTone = (home: number | null, away: number | null): string => {
  if (home === null || away === null) return 'border-slate-200 bg-slate-50 text-slate-400';
  const total = home + away;
  if (total === 0) return 'border-slate-200 bg-slate-100 text-slate-600';
  if (total >= 4) return 'border-rose-200 bg-rose-50 text-rose-700';
  if (home === away) return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-emerald-200 bg-emerald-50 text-emerald-700';
};

const teamInitials = (teamName: string): string => {
  const normalized = teamName.trim();
  if (!normalized) return 'TM';
  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
};

const toRecord = (value: unknown): Record<string, unknown> | null => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
};

const readStringFromRaw = (
  raw: Record<string, unknown> | undefined,
  keys: string[],
): string | null => {
  if (!raw) return null;
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
};

const readTeamIdFromRaw = (
  raw: Record<string, unknown> | undefined,
  keys: string[],
): number | null => {
  if (!raw) return null;
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.trunc(value);
    }
    if (typeof value === 'string') {
      const parsed = Number.parseInt(value.trim(), 10);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
};

const maybeSoccerLogoByTeamId = (teamId: number | null): string | null => {
  if (!teamId || teamId <= 0) return null;
  return `https://a.espncdn.com/i/teamlogos/soccer/500/${teamId}.png`;
};

const resolveMatchTeamLogo = (
  detail: Record<string, unknown> | undefined,
  side: 'home' | 'away',
  teamName: string,
): string | undefined => {
  const sideKey = side === 'home' ? 'home' : 'away';

  const directLogo = readStringFromRaw(detail, [
    `${sideKey}_team_logo`,
    `${sideKey}_logo`,
    `${sideKey}TeamLogo`,
    `${sideKey}Logo`,
    `${sideKey}_badge`,
    `${sideKey}_badge_url`,
  ]);
  if (directLogo) return directLogo;

  const root = toRecord(detail);
  const sideObj = root ? toRecord(root[sideKey]) : null;
  const sideObjLogo = readStringFromRaw(sideObj ?? undefined, ['logo', 'logo_url', 'badge', 'badge_url']);
  if (sideObjLogo) return sideObjLogo;

  const teamId = readTeamIdFromRaw(detail, [
    `${sideKey}_team_id`,
    `${sideKey}TeamId`,
    `${sideKey}_id`,
    `${sideKey}_competitor_id`,
    `${sideKey}CompetitorId`,
    `${sideKey}_espn_team_id`,
  ]);
  const logoById = maybeSoccerLogoByTeamId(teamId);
  if (logoById) return logoById;

  return getTeamLogo(teamName);
};

const badgeTone = (
  tone: 'neutral' | 'success' | 'danger' | 'warning' | 'info',
): string => {
  if (tone === 'success') return 'border-emerald-200 bg-emerald-100 text-emerald-700';
  if (tone === 'danger') return 'border-rose-200 bg-rose-100 text-rose-700';
  if (tone === 'warning') return 'border-amber-200 bg-amber-100 text-amber-700';
  if (tone === 'info') return 'border-sky-200 bg-sky-100 text-sky-700';
  return 'border-slate-200 bg-slate-100 text-slate-600';
};

const ScorePill: FC<{ home: number | null; away: number | null; large?: boolean }> = ({
  home,
  away,
  large = false,
}) => {
  const size = large ? 'px-5 py-2 text-3xl tracking-tight' : 'px-2 py-0.5 text-sm';

  return (
    <span className={`inline-flex items-center rounded-xl border font-semibold tabular-nums ${size} ${scoreTone(home, away)}`}>
      {home ?? '—'}
      <span className="mx-2 font-normal text-slate-300">-</span>
      {away ?? '—'}
    </span>
  );
};

const Badge: FC<{ children: React.ReactNode; tone?: 'neutral' | 'success' | 'danger' | 'warning' | 'info' }> = ({
  children,
  tone = 'neutral',
}) => (
  <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${badgeTone(tone)}`}>
    {children}
  </span>
);

const TeamIdentityBadge: FC<{ teamName: string; side: 'home' | 'away'; logoUrl?: string }> = ({
  teamName,
  side,
  logoUrl,
}) => {
  const isHome = side === 'home';
  const iconClass = isHome ? 'text-slate-600' : 'text-rose-600';

  return (
    <div className="flex items-center gap-1.5">
      <TeamLogo
        logo={logoUrl}
        name={teamName}
        abbreviation={teamInitials(teamName)}
        className="h-8 w-8"
      />
      {isHome ? (
        <House size={12} className={iconClass} aria-hidden="true" />
      ) : (
        <Flag size={12} className={iconClass} aria-hidden="true" />
      )}
    </div>
  );
};

const MatchTagLegend: FC = () => (
  <span className="relative inline-flex items-center group/legend">
    <button
      type="button"
      className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 transition-colors hover:text-slate-600"
      aria-label="Show badge legend"
    >
      <Info size={12} aria-hidden="true" />
    </button>
    <span className="pointer-events-none absolute right-0 top-6 z-20 w-56 rounded-md border border-slate-200 bg-white p-2 text-[10px] leading-4 text-slate-500 opacity-0 shadow-lg transition-opacity group-hover/legend:opacity-100 group-focus-within/legend:opacity-100">
      <span className="block"><strong className="font-semibold text-slate-700">BTTS</strong>: Both teams scored.</span>
      <span className="block"><strong className="font-semibold text-slate-700">Under/Over</strong>: Total goals vs closing line.</span>
      <span className="block"><strong className="font-semibold text-slate-700">Penalty</strong>: Penalty awarded in match.</span>
    </span>
  </span>
);

const SplitBar: FC<{ home: number; away: number }> = ({ home, away }) => {
  const total = home + away || 1;
  const homePct = (home / total) * 100;

  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
      <div className="h-full bg-slate-700" style={{ width: `${homePct}%` }} />
      <div className="h-full bg-rose-500" style={{ width: `${100 - homePct}%` }} />
    </div>
  );
};

const MiniBar: FC<{ value: number; max: number; tone?: 'neutral' | 'warm' | 'cool' }> = ({
  value,
  max,
  tone = 'neutral',
}) => {
  const pct = Math.min((value / Math.max(max, 1)) * 100, 100);
  const fill = tone === 'warm' ? 'bg-rose-500' : tone === 'cool' ? 'bg-sky-500' : 'bg-slate-700';

  return (
    <div className="h-1.5 w-8 overflow-hidden rounded-full bg-slate-200">
      <div className={`h-full ${fill}`} style={{ width: `${pct}%` }} />
    </div>
  );
};

const Subsection: FC<{ title: string; right?: React.ReactNode }> = ({ title, right }) => (
  <div className="mb-2 mt-5 flex items-center justify-between first:mt-0">
    <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{title}</h3>
    {right ? <span className="text-xs tabular-nums text-slate-400">{right}</span> : null}
  </div>
);

const TimelineStrip: FC<{ events: TimelineEvent[]; homeTeam: string; awayTeam: string }> = ({
  events,
  homeTeam,
  awayTeam,
}) => {
  const goals = useMemo(() => events.filter((event) => event.type === 'goal'), [events]);
  const cards = useMemo(() => events.filter((event) => event.type === 'card'), [events]);

  const running = useMemo(() => {
    let home = 0;
    let away = 0;

    return goals.map((goal) => {
      if (goal.teamSide === 'home') home += 1;
      if (goal.teamSide === 'away') away += 1;
      return {
        ...goal,
        score: `${home}-${away}`,
      };
    });
  }, [goals]);

  return (
    <div>
      <div className="relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50" style={{ height: 56 }}>
        <div className="absolute inset-y-0 left-[47.4%] w-px bg-slate-200" />
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-slate-200" />

        {[15, 30, 60, 75].map((minute) => (
          <div key={minute} className="absolute inset-y-0 w-px bg-slate-100" style={{ left: `${minuteToPercent(minute)}%` }} />
        ))}

        {goals.map((event, index) => {
          const isHome = event.teamSide === 'home';
          return (
            <div
              key={`goal-${index}`}
              className="absolute flex -translate-x-1/2 flex-col items-center"
              style={{
                left: `${minuteToPercent(event.minute)}%`,
                top: isHome ? 4 : undefined,
                bottom: isHome ? undefined : 4,
              }}
              title={`${event.minuteLabel} ${sideLabel(event.teamSide, homeTeam, awayTeam)} ${event.playerName ?? ''}`}
            >
              <div className={`h-2 w-2 rounded-full ${isHome ? 'bg-slate-800' : 'bg-rose-500'}`} />
              <span className={`mt-0.5 text-[8px] font-semibold ${isHome ? 'text-slate-700' : 'text-rose-700'}`}>
                {event.minuteLabel}
              </span>
            </div>
          );
        })}

        {cards.map((event, index) => (
          <div
            key={`card-${index}`}
            className="absolute -translate-x-1/2"
            style={{ left: `${minuteToPercent(event.minute)}%`, top: event.teamSide === 'home' ? 3 : undefined, bottom: event.teamSide === 'home' ? undefined : 3 }}
          >
            <div className="h-1.5 w-1 rounded-sm bg-amber-500/80" />
          </div>
        ))}

        <span className="absolute left-2 top-1 text-[9px] text-slate-400">0'</span>
        <span className="absolute left-[47.4%] top-1 -translate-x-1/2 text-[9px] text-slate-400">HT</span>
        <span className="absolute right-2 top-1 text-[9px] text-slate-400">90'</span>
      </div>

      <div className="mt-2 flex items-center gap-4 text-[10px] text-slate-500">
        <div className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-slate-800" />
          <span>{homeTeam}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
          <span>{awayTeam}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="h-1.5 w-1 rounded-sm bg-amber-500" />
          <span>Card</span>
        </div>
      </div>

      {running.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-xs tabular-nums text-slate-400">0-0</span>
          {running.map((goal, index) => (
            <React.Fragment key={`seq-${index}`}>
              <span className="text-[10px] text-slate-300">→</span>
              <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 ${goal.teamSide === 'home' ? 'border-slate-200 bg-slate-100' : 'border-rose-200 bg-rose-100'}`}>
                <span className={`text-xs font-semibold tabular-nums ${goal.teamSide === 'home' ? 'text-slate-700' : 'text-rose-700'}`}>
                  {goal.score}
                </span>
                <span className="text-[9px] text-slate-400">{goal.minuteLabel}</span>
              </span>
            </React.Fragment>
          ))}
        </div>
      ) : null}

      {goals.length > 0 ? (
        <div className="mt-3 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {running.map((goal, index) => {
            const isHome = goal.teamSide === 'home';
            return (
              <div key={`goal-detail-${index}`} className={`rounded-md border px-3 py-2 ${isHome ? 'border-slate-200 bg-slate-50' : 'border-rose-200 bg-rose-50/60'}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-xs font-semibold ${isHome ? 'text-slate-700' : 'text-rose-700'}`}>{goal.minuteLabel}</span>
                  <span className="text-xs tabular-nums text-slate-500">{goal.score}</span>
                </div>
                <div className="mt-1 truncate text-xs font-medium text-slate-800">{goal.playerName ?? 'Goal'}</div>
                <div className="text-[10px] text-slate-500">{sideLabel(goal.teamSide, homeTeam, awayTeam)}</div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};

const BoxScoreTable: FC<{
  rows: Array<{ key: string; label: string; home: string | number; away: string | number }>;
  homeTeam: string;
  awayTeam: string;
}> = ({ rows, homeTeam, awayTeam }) => (
  <div className="overflow-x-auto">
    <table className="min-w-full border-collapse text-sm">
      <thead className="border-b-2 border-slate-200">
        <tr className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          <th className="py-2.5 pl-4 pr-3 text-left">Stat</th>
          <th className="w-20 px-2 py-2.5 text-right">{homeTeam}</th>
          <th className="w-24 px-2 py-2.5 text-center" />
          <th className="w-20 px-2 py-2.5 text-left">{awayTeam}</th>
          <th className="w-20 px-2 py-2.5 text-right">Δ</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => {
          const home = parseNumeric(row.home);
          const away = parseNumeric(row.away);
          const homeWins = home !== null && away !== null && home > away;
          const awayWins = home !== null && away !== null && away > home;

          let deltaText = '—';
          let deltaClass = 'text-slate-400';

          if (home !== null && away !== null) {
            const total = home + away;
            if (total > 0) {
              const delta = (home / total) * 100 - 50;
              deltaText = `${delta > 0 ? '+' : ''}${delta.toFixed(0)}%`;
              deltaClass = delta > 10 ? 'text-slate-700' : delta < -10 ? 'text-rose-700' : 'text-slate-500';
            } else {
              deltaText = '0%';
              deltaClass = 'text-slate-500';
            }
          }

          return (
            <tr key={row.key} className={index < rows.length - 1 ? 'border-b border-slate-100' : ''}>
              <td className="py-2.5 pl-4 pr-3 text-xs text-slate-600">{row.label}</td>
              <td className={`px-2 py-2.5 text-right text-xs tabular-nums ${homeWins ? 'font-semibold text-slate-800' : 'text-slate-500'}`}>
                {row.home}
              </td>
              <td className="px-2 py-2.5">{home !== null && away !== null ? <SplitBar home={home} away={away} /> : null}</td>
              <td className={`px-2 py-2.5 text-left text-xs tabular-nums ${awayWins ? 'font-semibold text-rose-700' : 'text-slate-500'}`}>
                {row.away}
              </td>
              <td className={`px-2 py-2.5 text-right text-[11px] tabular-nums ${deltaClass}`}>{deltaText}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);

const OddsSection: FC<{
  data: {
    homeTeam: string;
    awayTeam: string;
    homeScore: number | null;
    awayScore: number | null;
    odds: {
      homeMoneyline: number | null;
      drawMoneyline: number | null;
      awayMoneyline: number | null;
      spread: number | null;
      homeSpreadPrice: number | null;
      awaySpreadPrice: number | null;
      total: number | null;
      overPrice: number | null;
      underPrice: number | null;
    };
  };
}> = ({ data }) => {
  const totalGoals =
    data.homeScore !== null && data.awayScore !== null ? data.homeScore + data.awayScore : null;
  const margin =
    data.homeScore !== null && data.awayScore !== null ? data.homeScore - data.awayScore : null;

  const spreadCover =
    data.odds.spread !== null && margin !== null ? margin + data.odds.spread > 0 : null;

  const overHit =
    data.odds.total !== null && totalGoals !== null ? totalGoals > data.odds.total : null;
  const push =
    data.odds.total !== null && totalGoals !== null ? totalGoals === data.odds.total : false;

  const legs = [
    {
      label: data.homeTeam,
      line: data.odds.homeMoneyline,
      won:
        data.homeScore !== null && data.awayScore !== null
          ? data.homeScore > data.awayScore
          : false,
    },
    {
      label: 'Draw',
      line: data.odds.drawMoneyline,
      won:
        data.homeScore !== null && data.awayScore !== null
          ? data.homeScore === data.awayScore
          : false,
    },
    {
      label: data.awayTeam,
      line: data.odds.awayMoneyline,
      won:
        data.homeScore !== null && data.awayScore !== null
          ? data.homeScore < data.awayScore
          : false,
    },
  ];

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse text-sm">
          <thead className="border-b-2 border-slate-200">
            <tr className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              <th className="py-2.5 pl-4 pr-3 text-left">Outcome</th>
              <th className="px-3 py-2.5 text-right">Line</th>
              <th className="px-3 py-2.5 text-right">Impl %</th>
              <th className="px-3 py-2.5 text-right">Result</th>
            </tr>
          </thead>
          <tbody>
            {legs.map((leg, index) => {
              const ip = impliedProb(leg.line);
              return (
                <tr key={leg.label} className={`${index < legs.length - 1 ? 'border-b border-slate-100' : ''} ${leg.won ? 'bg-emerald-50/70' : ''}`}>
                  <td className={`py-2.5 pl-4 pr-3 text-xs ${leg.won ? 'font-semibold text-emerald-700' : 'text-slate-700'}`}>
                    {leg.label}
                  </td>
                  <td className="px-3 py-2.5 text-right text-xs tabular-nums text-slate-600">
                    {leg.line !== null ? formatSignedNumber(leg.line, 0) : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {ip !== null ? (
                      <div className="inline-flex items-center justify-end gap-1.5">
                        <MiniBar value={ip} max={100} tone={leg.won ? 'neutral' : 'cool'} />
                        <span className="text-[11px] tabular-nums text-slate-500">{ip.toFixed(1)}%</span>
                      </div>
                    ) : (
                      <span className="text-[11px] text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {leg.won ? <Badge tone="success">Winner</Badge> : <span className="text-[11px] text-slate-400">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Subsection title="Lines & Coverage" />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Spread</span>
            {spreadCover !== null ? <Badge tone={spreadCover ? 'success' : 'danger'}>{spreadCover ? 'Covered' : 'Missed'}</Badge> : null}
          </div>
          <div className="flex items-end gap-3">
            <span className="text-2xl font-semibold tabular-nums text-slate-800">
              {data.odds.spread !== null ? formatSignedNumber(data.odds.spread, 1) : '—'}
            </span>
            <div className="pb-0.5 text-xs text-slate-500">
              H {data.odds.homeSpreadPrice !== null ? formatSignedNumber(data.odds.homeSpreadPrice, 0) : '—'} · A{' '}
              {data.odds.awaySpreadPrice !== null ? formatSignedNumber(data.odds.awaySpreadPrice, 0) : '—'}
            </div>
          </div>
          {margin !== null && data.odds.spread !== null ? (
            <div className="mt-1.5 text-xs text-slate-500">
              Margin {margin > 0 ? '+' : ''}
              {margin} · Adj {(margin + data.odds.spread) > 0 ? '+' : ''}
              {(margin + data.odds.spread).toFixed(1)}
            </div>
          ) : null}
        </div>

        <div className="rounded-lg border border-slate-200 px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Total</span>
            {overHit !== null ? (
              push ? (
                <Badge tone="warning">Push</Badge>
              ) : overHit ? (
                <Badge tone="danger">Over</Badge>
              ) : (
                <Badge tone="info">Under</Badge>
              )
            ) : null}
          </div>
          <div className="flex items-end gap-3">
            <span className="text-2xl font-semibold tabular-nums text-slate-800">{data.odds.total ?? '—'}</span>
            <div className="pb-0.5 text-xs text-slate-500">
              O {data.odds.overPrice !== null ? formatSignedNumber(data.odds.overPrice, 0) : '—'} · U{' '}
              {data.odds.underPrice !== null ? formatSignedNumber(data.odds.underPrice, 0) : '—'}
            </div>
          </div>
          {totalGoals !== null && data.odds.total !== null ? (
            <div className="mt-1.5 text-xs text-slate-500">
              Actual {totalGoals} · {totalGoals > data.odds.total ? '+' : ''}
              {(totalGoals - data.odds.total).toFixed(1)} vs line
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

const GameFlowGrouped: FC<{
  gameFlow: {
    htFtResult: string | null;
    firstGoalInterval: string | null;
    firstGoalTeam: string | null;
    lastGoalMinute: number | null;
    goals1HPct: number | null;
    btts: boolean | null;
    homeGoals1H: number | null;
    awayGoals1H: number | null;
    homeGoals2H: number | null;
    awayGoals2H: number | null;
    lateGoals: number | null;
    stoppageTimeGoals: number | null;
    penaltyAwarded: boolean | null;
    totalPenalties: number | null;
  };
  homeTeam: string;
}> = ({ gameFlow, homeTeam }) => {
  const sections = [
    {
      title: 'Timing',
      rows: [
        { label: 'HT / FT Pattern', value: gameFlow.htFtResult ?? '—' },
        { label: 'First Goal Window', value: gameFlow.firstGoalInterval ?? '—' },
        {
          label: 'First Goal Team',
          value: gameFlow.firstGoalTeam ?? '—',
          badge:
            gameFlow.firstGoalTeam === homeTeam
              ? { text: 'Home', tone: 'neutral' as const }
              : gameFlow.firstGoalTeam
                ? { text: 'Away', tone: 'danger' as const }
                : null,
        },
        {
          label: 'Last Goal Minute',
          value: gameFlow.lastGoalMinute !== null ? `${gameFlow.lastGoalMinute}'` : '—',
        },
        {
          label: 'Goals in 1H',
          value: formatPct(gameFlow.goals1HPct),
          bar:
            typeof gameFlow.goals1HPct === 'number'
              ? { value: gameFlow.goals1HPct, max: 100, tone: 'neutral' as const }
              : null,
        },
      ],
    },
    {
      title: 'Structure',
      rows: [
        {
          label: 'BTTS',
          value: boolLabel(gameFlow.btts),
          badge: gameFlow.btts === true ? { text: 'Yes', tone: 'success' as const } : null,
        },
        {
          label: 'Half Splits',
          value: `${gameFlow.homeGoals1H ?? '—'}-${gameFlow.awayGoals1H ?? '—'} / ${gameFlow.homeGoals2H ?? '—'}-${gameFlow.awayGoals2H ?? '—'}`,
        },
        {
          label: 'Late Goals (85+)',
          value: String(gameFlow.lateGoals ?? '—'),
          badge:
            typeof gameFlow.lateGoals === 'number' && gameFlow.lateGoals > 0
              ? { text: String(gameFlow.lateGoals), tone: 'danger' as const }
              : null,
        },
        {
          label: 'Stoppage Goals',
          value: String(gameFlow.stoppageTimeGoals ?? '—'),
          badge:
            typeof gameFlow.stoppageTimeGoals === 'number' && gameFlow.stoppageTimeGoals > 0
              ? { text: String(gameFlow.stoppageTimeGoals), tone: 'warning' as const }
              : null,
        },
      ],
    },
    {
      title: 'Discipline',
      rows: [
        {
          label: 'Penalty Awarded',
          value: boolLabel(gameFlow.penaltyAwarded),
          badge: gameFlow.penaltyAwarded ? { text: 'Yes', tone: 'warning' as const } : null,
        },
        {
          label: 'Total Penalties',
          value: String(gameFlow.totalPenalties ?? '—'),
        },
      ],
    },
  ];

  return (
    <div>
      {sections.map((section, sectionIndex) => (
        <div key={section.title} className={sectionIndex > 0 ? 'mt-4 border-t border-slate-200 pt-4' : ''}>
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{section.title}</div>
          <div className="divide-y divide-slate-100">
            {section.rows.map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-3 py-2">
                <span className="text-sm text-slate-600">{row.label}</span>
                <div className="flex items-center gap-2">
                  {'bar' in row && row.bar ? <MiniBar value={row.bar.value} max={row.bar.max} tone={row.bar.tone} /> : null}
                  {'badge' in row && row.badge ? <Badge tone={row.badge.tone}>{row.badge.text}</Badge> : null}
                  <span className="text-xs font-semibold tabular-nums text-slate-800">{row.value}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

const ScorerTable: FC<{
  rows: Array<{
    id: string;
    playerName: string;
    teamName: string | null;
    oddsFractional: string | null;
    impliedProb: number | null;
    goalsScored: number | null;
    goalMinutes: string[];
    firstGoal: boolean | null;
    lastGoal: boolean | null;
    last5Results: Array<'W' | 'L' | 'P'>;
    currentStreak: string | null;
    profitDecimal: number | null;
    result: string | null;
  }>;
}> = ({ rows }) => (
  <div className="overflow-x-auto">
    <table className="min-w-full border-collapse text-sm">
      <thead className="border-b-2 border-slate-200">
        <tr className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          <th className="py-2 pl-4 pr-3 text-left">Player</th>
          <th className="px-3 py-2 text-right">Flags</th>
          <th className="px-3 py-2 text-right">Odds</th>
          <th className="px-3 py-2 text-right">Impl %</th>
          <th className="px-3 py-2 text-right">Goals</th>
          <th className="px-3 py-2 text-right">L5</th>
          <th className="px-3 py-2 text-right">Streak</th>
          <th className="px-3 py-2 text-right">P/L</th>
          <th className="px-3 py-2 text-right">Result</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => {
          const goalMinutes = Array.isArray(row.goalMinutes) ? row.goalMinutes : [];
          const last5Results = Array.isArray(row.last5Results) ? row.last5Results : [];
          const isWin = row.result === 'win';
          const isLoss = row.result === 'loss';
          const minutes =
            goalMinutes.length > 0 ? goalMinutes.join(', ') : null;
          const hasFlags = row.firstGoal || row.lastGoal;
          const last5 = last5Results.slice(0, 5);
          const paddedLast5 = [...last5, ...Array(Math.max(0, 5 - last5.length)).fill('—')];
          return (
            <tr key={row.id} className={`${index < rows.length - 1 ? 'border-b border-slate-100' : ''} ${isWin ? 'bg-emerald-50/70' : ''}`}>
              <td className="py-2 pl-4 pr-3">
                <div className={`text-xs ${isWin ? 'font-semibold text-emerald-700' : 'text-slate-700'}`}>
                  {row.playerName}
                </div>
                {row.teamName ? <div className="mt-0.5 text-[10px] text-slate-500">{row.teamName}</div> : null}
              </td>
              <td className="px-3 py-2 text-right">
                {hasFlags ? (
                  <div className="inline-flex gap-1">
                    {row.firstGoal ? <Badge tone="warning">First</Badge> : null}
                    {row.lastGoal ? <Badge tone="info">Last</Badge> : null}
                  </div>
                ) : (
                  <span className="text-[11px] text-slate-400">—</span>
                )}
              </td>
              <td className="px-3 py-2 text-right text-xs tabular-nums text-slate-600">{row.oddsFractional ?? '—'}</td>
              <td className="px-3 py-2 text-right">
                {row.impliedProb !== null ? (
                  <div className="inline-flex items-center justify-end gap-1.5">
                    <MiniBar value={row.impliedProb} max={80} tone={row.impliedProb > 40 ? 'warm' : 'neutral'} />
                    <span className="text-[11px] tabular-nums text-slate-500">{row.impliedProb.toFixed(1)}%</span>
                  </div>
                ) : (
                  <span className="text-[11px] text-slate-400">—</span>
                )}
              </td>
              <td className="px-3 py-2 text-right">
                {typeof row.goalsScored === 'number' ? (
                  <div className="text-right">
                    <div className={`text-xs tabular-nums ${row.goalsScored > 0 ? 'font-semibold text-emerald-700' : 'text-slate-500'}`}>{row.goalsScored}</div>
                    <div className="text-[10px] text-slate-400">{minutes ?? '—'}</div>
                  </div>
                ) : (
                  <span className="text-[11px] text-slate-400">—</span>
                )}
              </td>
              <td className="px-3 py-2 text-right">
                <div className="inline-flex items-center gap-1">
                  {paddedLast5.map((value, valueIndex) => (
                    <span
                      key={`${row.id}-l5-${valueIndex}`}
                      className={`inline-flex h-5 min-w-[20px] items-center justify-center rounded border px-1 text-[10px] font-semibold ${
                        value === 'W'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : value === 'L'
                            ? 'border-rose-200 bg-rose-50 text-rose-700'
                            : value === 'P'
                              ? 'border-amber-200 bg-amber-50 text-amber-700'
                              : 'border-slate-200 bg-slate-50 text-slate-400'
                      }`}
                    >
                      {value}
                    </span>
                  ))}
                </div>
              </td>
              <td className="px-3 py-2 text-right">
                <span className={`text-xs tabular-nums ${row.currentStreak?.startsWith('W') ? 'font-semibold text-emerald-700' : row.currentStreak?.startsWith('L') ? 'font-semibold text-rose-700' : row.currentStreak?.startsWith('P') ? 'font-semibold text-amber-700' : 'text-slate-400'}`}>
                  {typeof row.currentStreak === 'string' ? row.currentStreak : '—'}
                </span>
              </td>
              <td className="px-3 py-2 text-right text-xs tabular-nums">
                {row.profitDecimal !== null ? (
                  <span className={row.profitDecimal > 0 ? 'font-semibold text-emerald-700' : row.profitDecimal < 0 ? 'font-semibold text-rose-700' : 'text-slate-500'}>
                    {formatUnits(row.profitDecimal)}
                  </span>
                ) : (
                  <span className="text-[11px] text-slate-400">—</span>
                )}
              </td>
              <td className="px-3 py-2 text-right">
                {row.result ? <Badge tone={isWin ? 'success' : isLoss ? 'danger' : 'neutral'}>{row.result}</Badge> : <span className="text-[11px] text-slate-400">—</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);

const MatchSignals: FC<{
  homeScore: number | null;
  awayScore: number | null;
  gameFlow: {
    btts: boolean | null;
    lateGoals: number | null;
    lastGoalMinute: number | null;
    stoppageTimeGoals: number | null;
    penaltyAwarded: boolean | null;
  };
  odds: { total: number | null };
  className?: string;
}> = ({ homeScore, awayScore, gameFlow, odds, className }) => {
  if (homeScore === null || awayScore === null) return null;

  const total = homeScore + awayScore;
  const margin = homeScore - awayScore;

  const signals: Array<{ label: string; tone: 'neutral' | 'success' | 'danger' | 'warning' | 'info' }> = [];

  if (total === 0) signals.push({ label: 'Scoreless', tone: 'info' });
  if (total >= 4) signals.push({ label: `${total} Goals`, tone: 'danger' });
  if (gameFlow.btts) signals.push({ label: 'BTTS', tone: 'success' });
  if ((gameFlow.lateGoals ?? 0) > 0) signals.push({ label: `Late Goal ${gameFlow.lastGoalMinute ?? ''}`.trim(), tone: 'danger' });
  if ((gameFlow.stoppageTimeGoals ?? 0) > 0) signals.push({ label: 'Stoppage Goal', tone: 'warning' });
  if (gameFlow.penaltyAwarded) signals.push({ label: 'Penalty', tone: 'warning' });
  if (odds.total !== null && total > odds.total) signals.push({ label: `Over ${odds.total}`, tone: 'danger' });
  if (odds.total !== null && total < odds.total) signals.push({ label: `Under ${odds.total}`, tone: 'info' });
  if (Math.abs(margin) >= 3) signals.push({ label: `${Math.abs(margin)}-Goal Margin`, tone: 'success' });

  if (signals.length === 0) return null;

  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {signals.map((signal) => (
        <Badge key={signal.label} tone={signal.tone}>{signal.label}</Badge>
      ))}
    </div>
  );
};

export const MatchPage: FC<MatchPageProps> = ({ slug }) => {
  const { data, isLoading, error } = useMatchBySlug(slug);

  const timelineEvents = useMemo(() => (Array.isArray(data?.timeline) ? data.timeline : []), [data]);
  const boxScoreRows = useMemo(() => (Array.isArray(data?.boxScore) ? data.boxScore : []), [data]);
  const lineupRows = useMemo(() => (Array.isArray(data?.lineups) ? data.lineups : []), [data]);
  const playerScorerOddsRows = useMemo(
    () => (Array.isArray(data?.playerScorerOdds) ? data.playerScorerOdds : []),
    [data],
  );

  const scorerOddsByPool = useMemo(() => {
    const rows = playerScorerOddsRows;
    const buckets = new Map<string, typeof rows>();

    for (const row of rows) {
      const key = row.pool || 'unknown';
      const list = buckets.get(key) ?? [];
      list.push(row);
      buckets.set(key, list);
    }

    return Array.from(buckets.entries()).map(([pool, poolRows]) => {
      const normalizedRows = poolRows.map((row) => ({
        ...row,
        goalMinutes: Array.isArray(row.goalMinutes) ? row.goalMinutes : [],
        last5Results: Array.isArray(row.last5Results) ? row.last5Results : [],
        currentStreak:
          typeof row.currentStreak === 'string' ? row.currentStreak : null,
      }));

      const sortedRows = normalizedRows
        .slice()
        .sort(
          (a, b) =>
            (a.oddsDecimal ?? Number.MAX_SAFE_INTEGER) -
            (b.oddsDecimal ?? Number.MAX_SAFE_INTEGER),
        );

      const settled = sortedRows.filter((row) => row.result === 'win' || row.result === 'loss');
      const wins = settled.filter((row) => row.result === 'win').length;
      const losses = settled.filter((row) => row.result === 'loss').length;
      const unitSum = settled.reduce((sum, row) => sum + (row.profitDecimal ?? 0), 0);

      return {
        pool,
        rows: sortedRows.slice(0, 14),
        summary: {
          total: sortedRows.length,
          settled: settled.length,
          wins,
          losses,
          hitRate: settled.length > 0 ? (wins / settled.length) * 100 : null,
          roi: settled.length > 0 ? (unitSum / settled.length) * 100 : null,
          unitSum,
        },
      };
    });
  }, [playerScorerOddsRows]);

  const propsSummary = useMemo(() => {
    const rows = playerScorerOddsRows;
    if (rows.length === 0) {
      return {
        total: 0,
        settled: 0,
        wins: 0,
        losses: 0,
        hitRate: null as number | null,
        roi: null as number | null,
        unitSum: null as number | null,
      };
    }

    const settled = rows.filter((row) => row.result === 'win' || row.result === 'loss');
    const wins = settled.filter((row) => row.result === 'win').length;
    const losses = settled.filter((row) => row.result === 'loss').length;
    const unitSum = settled.reduce((sum, row) => sum + (row.profitDecimal ?? 0), 0);

    return {
      total: rows.length,
      settled: settled.length,
      wins,
      losses,
      hitRate: settled.length > 0 ? (wins / settled.length) * 100 : null,
      roi: settled.length > 0 ? (unitSum / settled.length) * 100 : null,
      unitSum,
    };
  }, [playerScorerOddsRows]);

  const eventsWithScore = useMemo(() => {
    let home = 0;
    let away = 0;

    return (data?.events ?? []).map((event) => {
      const isGoal = event.type === 'goal';
      if (isGoal && event.teamSide === 'home') home += 1;
      if (isGoal && event.teamSide === 'away') away += 1;

      return {
        ...event,
        scoreAfter: isGoal ? `${home}-${away}` : null,
      };
    });
  }, [data]);

  const homeTeamLogo = useMemo(
    () => resolveMatchTeamLogo(data?.raw, 'home', data?.homeTeam ?? 'Home'),
    [data?.raw, data?.homeTeam],
  );

  const awayTeamLogo = useMemo(
    () => resolveMatchTeamLogo(data?.raw, 'away', data?.awayTeam ?? 'Away'),
    [data?.raw, data?.awayTeam],
  );

  return (
    <PageShell>
      <TopNav />

      {isLoading ? <LoadingBlock label="Loading match page…" /> : null}
      {error ? <EmptyBlock message={`Failed to load match: ${error.message}`} /> : null}
      {!isLoading && !error && !data ? (
        <EmptyBlock message={`Match not found: ${slug}. Try /match/{league}-{home}-vs-{away}-{date} or /match/{home}-vs-{away}-{date}.`} />
      ) : null}

      {data ? (
        <div className="space-y-6 sm:space-y-7">
          <Card>
            <CardBody>
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:p-5">
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{data.leagueName}</span>
                  {data.matchday ? <DataPill className="text-[10px]">MD {data.matchday}</DataPill> : null}
                  {data.homeScore !== null && data.awayScore !== null ? (
                    data.homeScore > data.awayScore ? (
                      <Badge tone="success">{data.homeTeam} Win</Badge>
                    ) : data.homeScore < data.awayScore ? (
                      <Badge tone="danger">{data.awayTeam} Win</Badge>
                    ) : (
                      <Badge tone="warning">Draw</Badge>
                    )
                  ) : null}
                </div>

                <div className="grid items-center gap-3 sm:grid-cols-[1fr_auto_1fr] sm:gap-6">
                  <div className="min-w-0">
                    <div className="flex items-center justify-end gap-2.5">
                      <div className="min-w-0 text-right">
                        <div className="truncate text-lg font-semibold tracking-tight text-slate-900">{data.homeTeam}</div>
                        <div className="mt-0.5 inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.1em] text-slate-400">
                          <House size={11} aria-hidden="true" />
                          Home
                        </div>
                      </div>
                      <TeamIdentityBadge teamName={data.homeTeam} side="home" logoUrl={homeTeamLogo} />
                    </div>
                  </div>

                  <div className="flex justify-center">
                    <ScorePill home={data.homeScore} away={data.awayScore} large />
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2.5">
                      <TeamIdentityBadge teamName={data.awayTeam} side="away" logoUrl={awayTeamLogo} />
                      <div className="min-w-0 text-left">
                        <div className="truncate text-lg font-semibold tracking-tight text-slate-900">{data.awayTeam}</div>
                        <div className="mt-0.5 inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.1em] text-slate-400">
                          <Flag size={11} aria-hidden="true" />
                          Away
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {data.gameFlow.homeGoals1H !== null || data.gameFlow.awayGoals1H !== null ? (
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">1st Half</div>
                      <div className="mt-0.5 text-sm font-semibold tabular-nums text-slate-700">
                        {data.gameFlow.homeGoals1H ?? 0}-{data.gameFlow.awayGoals1H ?? 0}
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">2nd Half</div>
                      <div className="mt-0.5 text-sm font-semibold tabular-nums text-slate-700">
                        {data.gameFlow.homeGoals2H ?? 0}-{data.gameFlow.awayGoals2H ?? 0}
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="mt-4 grid gap-2">
                  <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarClock size={12} aria-hidden="true" />
                      {formatMatchDateLabel(data.startTime)}
                    </span>
                    {data.venue ? (
                      <span className="inline-flex items-center gap-1.5">
                        <MapPin size={12} aria-hidden="true" />
                        {data.venue}
                      </span>
                    ) : null}
                    {data.referee ? (
                      <span className="inline-flex items-center gap-1.5">
                        <UserRound size={12} aria-hidden="true" />
                        {data.referee}
                      </span>
                    ) : null}
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        <Shield size={12} aria-hidden="true" />
                        Match Tags
                      </div>
                      <MatchTagLegend />
                    </div>
                    <MatchSignals
                      homeScore={data.homeScore}
                      awayScore={data.awayScore}
                      gameFlow={data.gameFlow}
                      odds={data.odds}
                      className="justify-start"
                    />
                  </div>
                </div>
              </div>
            </CardBody>
          </Card>

          {timelineEvents.length > 0 ? (
            <Card>
              <CardHeader>
                <SectionLabel>Match Timeline</SectionLabel>
              </CardHeader>
              <CardBody>
                <TimelineStrip events={timelineEvents} homeTeam={data.homeTeam} awayTeam={data.awayTeam} />
              </CardBody>
            </Card>
          ) : null}

          {boxScoreRows.length > 0 ? (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <SectionLabel>Box Score</SectionLabel>
                  <span className="text-xs text-slate-500">with delta</span>
                </div>
              </CardHeader>
              <CardBody className="p-0">
                <BoxScoreTable rows={boxScoreRows} homeTeam={data.homeTeam} awayTeam={data.awayTeam} />
              </CardBody>
            </Card>
          ) : null}

          {data.odds.homeMoneyline !== null || data.odds.total !== null || data.odds.spread !== null ? (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <SectionLabel>DraftKings Closing Odds</SectionLabel>
                  <span className="text-xs text-slate-500">implied prob + coverage</span>
                </div>
              </CardHeader>
              <CardBody>
                <OddsSection data={data} />
              </CardBody>
            </Card>
          ) : null}

          {data.bet365TeamOdds ? (
            <Card>
              <CardHeader>
                <SectionLabel>Bet365 Team Markets</SectionLabel>
              </CardHeader>
              <CardBody>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border border-slate-200 px-4 py-3">
                    <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">3-Way</div>
                    <div className="space-y-1.5 text-xs">
                      <div className="flex items-center justify-between"><span className="text-slate-600">{data.homeTeam}</span><span className="font-semibold tabular-nums text-slate-700">{data.bet365TeamOdds.homeFractional ?? '—'}</span></div>
                      <div className="flex items-center justify-between"><span className="text-slate-600">Draw</span><span className="font-semibold tabular-nums text-slate-700">{data.bet365TeamOdds.drawFractional ?? '—'}</span></div>
                      <div className="flex items-center justify-between"><span className="text-slate-600">{data.awayTeam}</span><span className="font-semibold tabular-nums text-slate-700">{data.bet365TeamOdds.awayFractional ?? '—'}</span></div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-200 px-4 py-3">
                    <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Double Chance</div>
                    <div className="space-y-1.5 text-xs">
                      <div className="flex items-center justify-between"><span className="text-slate-600">1X</span><span className="font-semibold tabular-nums text-slate-700">{data.bet365TeamOdds.dcHomeDrawFractional ?? '—'}</span></div>
                      <div className="flex items-center justify-between"><span className="text-slate-600">X2</span><span className="font-semibold tabular-nums text-slate-700">{data.bet365TeamOdds.dcDrawAwayFractional ?? '—'}</span></div>
                      <div className="flex items-center justify-between"><span className="text-slate-600">12</span><span className="font-semibold tabular-nums text-slate-700">{data.bet365TeamOdds.dcHomeAwayFractional ?? '—'}</span></div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-200 px-4 py-3">
                    <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Goal Line</div>
                    <div className="text-2xl font-semibold tabular-nums text-slate-800">{data.bet365TeamOdds.ouHandicap ?? '—'}</div>
                    <div className="mt-1.5 text-xs text-slate-500">
                      O {data.bet365TeamOdds.overFractional ?? '—'} · U {data.bet365TeamOdds.underFractional ?? '—'}
                    </div>
                  </div>
                </div>
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <SectionLabel>v5 Game Flow</SectionLabel>
                <span className="text-xs text-slate-500">{data.gameFlow.drainVersion ?? 'v5'}</span>
              </div>
            </CardHeader>
            <CardBody>
              <GameFlowGrouped gameFlow={data.gameFlow} homeTeam={data.homeTeam} />
            </CardBody>
          </Card>

          {lineupRows.length > 0 ? (
            <Card>
              <CardHeader>
                <SectionLabel>Lineups</SectionLabel>
              </CardHeader>
              <CardBody>
                <div className="grid gap-4 lg:grid-cols-2">
                  {lineupRows.map((lineup) => {
                    const isHome = lineup.side === 'home';
                    return (
                      <div key={`${lineup.side}-${lineup.teamName}`} className="rounded-xl border border-slate-200 px-4 py-3">
                        <div className="mb-3 flex items-center justify-between gap-2">
                          <div>
                            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                              {isHome ? 'Home' : 'Away'}
                            </div>
                            <div className="mt-0.5 text-sm font-semibold text-slate-800">{lineup.teamName}</div>
                          </div>
                          {lineup.formation ? <DataPill>{lineup.formation}</DataPill> : null}
                        </div>

                        {lineup.starters.length > 0 ? (
                          <div>
                            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Starting XI</div>
                            <div className="flex flex-wrap gap-1">
                              {lineup.starters.map((player) => (
                                <span key={`${lineup.side}-starter-${player}`} className="rounded border border-slate-200 px-1.5 py-0.5 text-xs text-slate-700">
                                  {player}
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        {lineup.substitutes.length > 0 ? (
                          <div className="mt-2.5">
                            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Substitutes</div>
                            <div className="flex flex-wrap gap-1">
                              {lineup.substitutes.map((player) => (
                                <span key={`${lineup.side}-sub-${player}`} className="rounded border border-slate-200 px-1.5 py-0.5 text-xs text-slate-500">
                                  {player}
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </CardBody>
            </Card>
          ) : null}

          {eventsWithScore.length > 0 ? (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <SectionLabel>Events</SectionLabel>
                  <span className="text-xs tabular-nums text-slate-500">{eventsWithScore.length} events</span>
                </div>
              </CardHeader>
              <CardBody className="p-0">
                <div className="max-h-[620px] overflow-y-auto">
                  {eventsWithScore.map((event, index) => {
                    const isGoal = event.type === 'goal';
                    const isHome = event.teamSide === 'home';
                    const compactDetail = compactEventDetail(event.detail);
                    return (
                      <div
                        key={`event-${index}-${event.minuteLabel}`}
                        className={cn(
                          "grid grid-cols-[60px_minmax(0,1fr)_56px] items-start gap-3 px-4 py-3 sm:grid-cols-[68px_minmax(0,1fr)_72px]",
                          index < eventsWithScore.length - 1 ? "border-b border-slate-100" : "",
                          isGoal ? (isHome ? "bg-slate-50" : "bg-rose-50/50") : "",
                        )}
                      >
                        <div className="space-y-1 text-left">
                          <div className={`text-xs font-semibold tabular-nums ${isGoal ? (isHome ? 'text-slate-700' : 'text-rose-700') : 'text-slate-500'}`}>
                            {event.minuteLabel}
                          </div>
                          <Badge tone={isGoal ? (isHome ? 'neutral' : 'danger') : event.type === 'card' ? 'warning' : 'neutral'}>
                            {eventTypeLabel(event.type)}
                          </Badge>
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-slate-700">
                            {sideLabel(event.teamSide, data.homeTeam, data.awayTeam)}
                            {event.playerName ? <span className="text-slate-500"> · {event.playerName}</span> : null}
                          </div>
                          {compactDetail ? <div className="mt-0.5 text-xs leading-relaxed text-slate-500">{compactDetail}</div> : null}
                        </div>
                        <div className="text-right">
                          {event.scoreAfter ? (
                            <span className="inline-flex rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-slate-600">
                              {event.scoreAfter}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-300">—</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardBody>
            </Card>
          ) : null}

          {scorerOddsByPool.length > 0 ? (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <SectionLabel>Bet365 Player Scorer Odds</SectionLabel>
                  <span className="text-xs tabular-nums text-slate-500">{propsSummary.total} props</span>
                </div>
              </CardHeader>
              <CardBody className="space-y-4 p-0">
                <div className="grid gap-2 px-4 pt-3 sm:grid-cols-4">
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-slate-500">Settled</div>
                    <div className="text-sm font-semibold tabular-nums text-slate-800">{propsSummary.settled}</div>
                  </div>
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-slate-500">Win / Loss</div>
                    <div className="text-sm font-semibold tabular-nums text-slate-800">{propsSummary.wins}-{propsSummary.losses}</div>
                  </div>
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-slate-500">Hit Rate</div>
                    <div className="text-sm font-semibold tabular-nums text-slate-800">{formatPct(propsSummary.hitRate)}</div>
                  </div>
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-slate-500">Units</div>
                    <div className={`text-sm font-semibold tabular-nums ${propsSummary.unitSum !== null && propsSummary.unitSum > 0 ? 'text-emerald-700' : propsSummary.unitSum !== null && propsSummary.unitSum < 0 ? 'text-rose-700' : 'text-slate-800'}`}>
                      {formatUnits(propsSummary.unitSum)}
                    </div>
                  </div>
                </div>
                {scorerOddsByPool.map((bucket) => (
                  <div key={bucket.pool}>
                    <div className="flex items-center justify-between px-4 pb-1 pt-3">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{poolLabel(bucket.pool)}</div>
                      <div className="text-[11px] tabular-nums text-slate-500">
                        {bucket.summary.wins}-{bucket.summary.losses}
                        <span className="text-slate-400"> · </span>
                        {formatPct(bucket.summary.hitRate)}
                        <span className="text-slate-400"> · </span>
                        {bucket.summary.roi !== null ? `${bucket.summary.roi > 0 ? '+' : ''}${bucket.summary.roi.toFixed(1)}% ROI` : '— ROI'}
                      </div>
                    </div>
                    <ScorerTable rows={bucket.rows} />
                  </div>
                ))}
              </CardBody>
            </Card>
          ) : null}

          <div className="flex items-center justify-between border-t border-slate-200 pb-4 pt-3">
            <span className="text-xs text-slate-500">thedrip.to</span>
            <span className="text-xs tabular-nums text-slate-500">soccer_postgame · {data.leagueName} · {formatMatchDateLabel(data.startTime)}</span>
          </div>
        </div>
      ) : null}
    </PageShell>
  );
};

export default MatchPage;
