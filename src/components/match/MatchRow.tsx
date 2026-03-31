import React, { useMemo, memo, forwardRef } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { MatchRowProps as BaseMatchRowProps } from '@/types/matchList';
import TeamLogo from '../shared/TeamLogo';
import { cn } from '@/lib/essence';
import { getPeriodDisplay } from '../../utils/matchUtils';
import { getLeagueDisplayName } from '@/constants';
import { Sport, Linescore } from '@/types';

// ─── Types ──────────────────────────────────────────────────────────────────

interface MatchRowProps extends BaseMatchRowProps {
  isSelected?: boolean;
  polyHomeProb?: number;
  polyAwayProb?: number;
  homeEdge?: number;
  awayEdge?: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const SPRING = { type: 'spring' as const, stiffness: 420, damping: 30 };

// ─── Helpers ────────────────────────────────────────────────────────────────

const formatML = (value: unknown): string => {
  if (value == null) return '';
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.+-]/g, ''));
  if (!Number.isFinite(n)) return '';
  if (n === 0) return 'EV';
  return n > 0 ? `+${Math.round(n)}` : `${Math.round(n)}`;
};

const teamAbbr = (team: any): string =>
  team?.abbreviation || team?.shortName || (team?.name || '???').slice(0, 3).toUpperCase();

const formatSpread = (spread: unknown, homeTeam: any, awayTeam: any): string => {
  if (spread == null || spread === '') return '';
  const n = typeof spread === 'number' ? spread : Number(String(spread).replace(/[^0-9.+-]/g, ''));
  if (!Number.isFinite(n)) return '';
  if (n === 0) return 'PK';
  return n < 0 ? `${teamAbbr(homeTeam)} ${n}` : `${teamAbbr(awayTeam)} ${-n}`;
};

// ─── Sub-Components ─────────────────────────────────────────────────────────

const PinButton = memo(({ isPinned, onToggle }: { isPinned: boolean; onToggle?: (e: any) => void }) => (
  <button
    type="button"
    onClick={(e) => { e.stopPropagation(); onToggle?.(e); }}
    onPointerDown={(e) => e.stopPropagation()}
    className={cn(
      'shrink-0 p-1.5 -m-1 rounded transition-all duration-200',
      isPinned ? 'opacity-100' : 'opacity-0 group-hover:opacity-40'
    )}
    aria-label={isPinned ? 'Unpin game' : 'Pin game'}
  >
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"
      className={isPinned ? 'text-[#C85A3A]' : 'text-[#9B9B91]'}>
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  </button>
));
PinButton.displayName = 'PinButton';

const TennisSetScores = memo(({ linescores }: { linescores?: Linescore[] }) => {
  if (!linescores?.length) return <span className="text-[11px] text-[#9B9B91] font-mono">-</span>;
  return (
    <div className="flex items-center gap-1.5 font-mono text-[11px] tabular-nums">
      {linescores.map((ls, i) => (
        <span key={i} className={ls.winner ? 'text-[#1A1A18] font-bold' : 'text-[#9B9B91]'}>
          {ls.value ?? '-'}
        </span>
      ))}
    </div>
  );
});
TennisSetScores.displayName = 'TennisSetScores';

// ═════════════════════════════════════════════════════════════════════════════
// MATCH ROW — ESPN-Quality Scoreboard Card
// ═════════════════════════════════════════════════════════════════════════════

const MatchRow = forwardRef<HTMLDivElement, MatchRowProps>(({
  match,
  isPinned = false,
  isLive = false,
  isFinal = false,
  isSelected = false,
  onSelect,
  onTogglePin,
}, ref) => {
  const showScores = isLive || isFinal;
  const isTennis = match.sport === Sport.TENNIS;
  const reduced = useReducedMotion();
  const league = useMemo(() => getLeagueDisplayName(match.leagueId || ''), [match.leagueId]);

  // Odds
  const homeML = match.odds?.moneylineHome ?? match.odds?.homeML ?? match.odds?.homeWin ?? match.odds?.home_ml;
  const awayML = match.odds?.moneylineAway ?? match.odds?.awayML ?? match.odds?.awayWin ?? match.odds?.away_ml;
  const spread = match.odds?.homeSpread ?? match.odds?.spread ?? match.odds?.spread_home;
  const total = match.odds?.overUnder ?? match.odds?.total;

  // Time / Clock
  const { startTime, clock, period } = useMemo(() => {
    const d = new Date(match.startTime);
    return {
      startTime: d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
      clock: match.displayClock || match.minute || 'LIVE',
      period: isTennis
        ? (match.round?.replace(/Qualifying |Round (of )?/g, 'R') ?? '')
        : (getPeriodDisplay(match) || ''),
    };
  }, [match, isTennis]);

  // Footer: "ORL -1.5 · 224.5"
  const footer = useMemo(() => {
    const parts: string[] = [];
    const s = formatSpread(spread, match.homeTeam, match.awayTeam);
    if (s) parts.push(s);
    if (total != null && total !== '') parts.push(String(total));
    return parts.join(' · ');
  }, [spread, total, match.homeTeam, match.awayTeam]);

  const handleSelect = () => onSelect?.(match);

  const teams = [
    { team: match.awayTeam, score: match.awayScore, ml: awayML, other: match.homeScore },
    { team: match.homeTeam, score: match.homeScore, ml: homeML, other: match.awayScore },
  ];

  return (
    <motion.div
      ref={ref}
      layout
      initial={false}
      transition={reduced ? { duration: 0 } : SPRING}
      whileHover={reduced ? undefined : { y: -1 }}
      whileTap={reduced ? undefined : { scale: 0.998 }}
      onClick={handleSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e: React.KeyboardEvent) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
          e.preventDefault();
          handleSelect();
        }
      }}
      aria-label={`${match.awayTeam?.name || 'Away'} at ${match.homeTeam?.name || 'Home'}`}
      className={cn(
        'group relative bg-white rounded-lg p-4 cursor-pointer select-none',
        'transition-colors duration-150 hover:bg-[#F5F4F0]',
        'focus-visible:ring-2 focus-visible:ring-[#C85A3A]/25 focus-visible:outline-none',
      )}
    >
      {/* ── Header: Status · League ─────────────────────────────── */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5 text-[11px] text-[#9B9B91]">
          {isLive ? (
            <>
              <span className="inline-flex h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse shrink-0" />
              <span className="font-mono font-bold text-red-600 uppercase tracking-wide">
                {period ? `${period} ${clock}` : clock}
              </span>
              <span>·</span>
            </>
          ) : isFinal ? (
            <>
              <span className="font-mono font-semibold uppercase tracking-wide">Final</span>
              <span>·</span>
            </>
          ) : (
            <>
              <span className="font-mono font-semibold tabular-nums" suppressHydrationWarning>{startTime}</span>
              <span>·</span>
            </>
          )}
          <span className="font-medium truncate">{league}</span>
        </div>
        <PinButton isPinned={isPinned} onToggle={onTogglePin} />
      </div>

      {/* ── Team Rows ───────────────────────────────────────────── */}
      <div className="flex flex-col gap-2.5">
        {teams.map(({ team, score, ml, other }, idx) => {
          if (!team) return null;
          const nS = Number(score), nO = Number(other);
          const valid = score != null && other != null && !isNaN(nS) && !isNaN(nO);
          const won = isFinal && valid && nS > nO;
          const lost = isFinal && valid && nS < nO;

          return (
            <div key={team.id || idx} className="flex items-center gap-3">
              {/* Logo */}
              <div className="w-10 h-10 shrink-0 flex items-center justify-center">
                <TeamLogo
                  logo={team.logo}
                  name={team.name}
                  teamColor={team.color}
                  className="w-8 h-8 object-contain"
                />
              </div>

              {/* Name + Record */}
              <div className="flex-1 min-w-0 flex items-baseline gap-2">
                <span className={cn(
                  'text-[14px] tracking-[-0.01em] truncate',
                  lost ? 'text-[#9B9B91] font-medium' : 'text-[#1A1A18] font-semibold'
                )}>
                  {team.name}
                </span>
                {team.record && (
                  <span className="hidden sm:inline text-[12px] font-mono text-[#9B9B91] tabular-nums shrink-0">
                    {team.record}
                  </span>
                )}
              </div>

              {/* Score or ML */}
              <div className="shrink-0 text-right min-w-[36px]">
                {showScores ? (
                  isTennis ? (
                    <TennisSetScores linescores={team.linescores} />
                  ) : (
                    <span className={cn(
                      'font-mono text-[18px] tabular-nums',
                      lost ? 'text-[#9B9B91] font-semibold' : 'text-[#1A1A18] font-bold'
                    )}>
                      {score ?? '-'}
                    </span>
                  )
                ) : (
                  <span className="font-mono text-[14px] tabular-nums font-bold text-[#1A1A18]">
                    {formatML(ml)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Footer: Odds Line ───────────────────────────────────── */}
      {footer && !showScores && (
        <div className="mt-3 pt-1">
          <span className="font-mono text-[12px] text-[#9B9B91] tabular-nums">{footer}</span>
        </div>
      )}
    </motion.div>
  );
});

MatchRow.displayName = 'MatchRow';

export default MatchRow;
