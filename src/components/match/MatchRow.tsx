import React, { useMemo, memo, forwardRef } from 'react';
import { motion } from 'framer-motion';
import { MatchRowProps as BaseMatchRowProps } from '@/types/matchList';
import TeamLogo from '../shared/TeamLogo';
import { OddsLensPill } from '../shared/OddsLens';
import { cn } from '@/lib/essence';
import { getPeriodDisplay } from '../../utils/matchUtils';
import { Sport, Linescore } from '@/types';

// Extend base props with poly data + selection state
interface MatchRowProps extends BaseMatchRowProps {
  isSelected?: boolean;
  /** Polymarket probability for home team (0–100) */
  polyHomeProb?: number;
  /** Polymarket probability for away team (0–100) */
  polyAwayProb?: number;
  /** Edge value for home team (divergence %) */
  homeEdge?: number;
  /** Edge value for away team (divergence %) */
  awayEdge?: number;
  /** Data source: 'poly' if Polymarket data available */
  probSource?: 'poly' | 'espn';
}

const PHYSICS_MOTION = { type: "spring" as const, stiffness: 400, damping: 25 };

const LOGO_W = 24;
const LOGO_GAP = 16;
const SCORE_W = 32;
const PROB_W = 88;
const TEAM_INDENT = LOGO_W + LOGO_GAP;

const isValidOdd = (val: string | number | null | undefined): boolean => val !== null && val !== undefined && val !== '-' && val !== '';

const ProbPill = memo(({ value, isFavorite }: { value: number | undefined; isFavorite: boolean }) => {
  if (value === undefined || value === null || isNaN(value)) return <span className="w-[46px] shrink-0" aria-hidden="true" />;
  const pct = Math.round(value);
  if (pct <= 0 || isNaN(pct)) return <span className="w-[46px] shrink-0" aria-hidden="true" />;

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center tabular-nums font-medium select-none w-[46px] h-[22px] rounded-[6px] text-[11px] shrink-0 border",
        isFavorite ? "bg-slate-50 text-slate-700 border-slate-200" : "bg-transparent text-slate-400 border-slate-100"
      )}
      title={`${pct}% win probability`}
    >
      {pct}%
    </span>
  );
});
ProbPill.displayName = 'ProbPill';
const ScoreCell = memo(({ score, isWinner, isLoser }: { score: string | number | null | undefined; isWinner: boolean; isLoser: boolean }) => (
  <span
    className={cn(
      "inline-flex items-center justify-center font-mono tabular-nums font-bold select-none w-[32px] h-[24px] rounded-[6px] text-[15px] shrink-0",
      isLoser ? "text-slate-400" : "text-slate-900",
      isWinner ? "bg-slate-100" : "bg-transparent"
    )}
  >
    {score ?? '-'}
  </span>
));
ScoreCell.displayName = 'ScoreCell';

const OddsChip = memo(({ label, value }: { label: string; value: string | number | null | undefined }) => {
  if (!isValidOdd(value)) return null;
  let display = String(value);
  if (label === 'SPR') {
    const num = Number(value);
    if (!isNaN(num)) {
      if (num === 0) display = 'PK';
      else if (num > 0 && !display.startsWith('+')) display = `+${display}`;
    }
  }
  return (
    <span className="inline-flex items-center gap-1.5 select-none" aria-label={`${label} ${display}`}>
      <span className="font-semibold uppercase text-[9px] tracking-widest text-slate-300" aria-hidden="true">
        {label}
      </span>
      <span className="font-mono font-medium tabular-nums text-[11px] text-slate-500">
        {display}
      </span>
    </span>
  );
});
OddsChip.displayName = 'OddsChip';


// Interactive Pin Toggle — clickable star with Framer bubbling guard
const PinButton = memo(({ isPinned, onToggle }: { isPinned: boolean; onToggle?: ((e: any) => void) | undefined }) => (
  <button
    type="button"
    onClick={(e) => { e.stopPropagation(); onToggle?.(e); }}
    onPointerDown={(e) => e.stopPropagation()}
    className={cn(
      "shrink-0 p-2 -m-1.5 rounded transition-all duration-200",
      isPinned
        ? "opacity-100"
        : "opacity-0 group-hover:opacity-60 hover:!opacity-100"
    )}
    aria-label={isPinned ? 'Unpin game' : 'Pin game'}
    title={isPinned ? 'Unpin game' : 'Pin game'}
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className={cn("shrink-0 transition-colors", isPinned ? "text-amber-500" : "text-slate-400")}>
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  </button>
));
PinButton.displayName = 'PinButton';

// Tennis Set Scores
const TennisSetScores: React.FC<{ linescores?: Linescore[] | undefined }> = memo(({ linescores }) => {
  if (!linescores || linescores.length === 0) return <span className="text-[11px] text-slate-400 font-mono tracking-widest">-</span>;

  return (
    <div className="flex items-center gap-[6px] font-mono text-[11px] tabular-nums leading-none">
      {linescores.map((ls, idx) => (
        <div
          key={idx}
          className={cn(
            "relative flex items-center justify-center w-5 h-5 rounded-[2px] transition-colors duration-300 select-none",
            ls.winner
              ? "bg-slate-100 text-slate-900 font-bold border border-slate-200"
              : "text-slate-400 bg-transparent"
          )}
        >
          {ls.value ?? '-'}
          {ls.tiebreak && (
            <span className="absolute -top-[3px] -right-[4px] text-[8px] font-medium text-slate-400 scale-75 origin-top-right">
              {ls.tiebreak}
            </span>
          )}
        </div>
      ))}
    </div>
  );
});
TennisSetScores.displayName = 'TennisSetScores';

const MatchRow = forwardRef<HTMLDivElement, MatchRowProps>(({
  match,
  isPinned = false,
  isLive = false,
  isFinal = false,
  isSelected = false,
  polyHomeProb,
  polyAwayProb,
  homeEdge,
  awayEdge,
  probSource = 'espn',
  onSelect,
  onTogglePin,
}, ref) => {
  const showScores = isLive || isFinal;
  const isTennis = match.sport === Sport.TENNIS;

  // Priority: Polymarket (real money) > ESPN (model estimate)
  const homeProb = polyHomeProb ?? match.win_probability?.home;
  const awayProb = polyAwayProb ?? match.win_probability?.away;
  const homeFav = typeof homeProb === 'number' && typeof awayProb === 'number' ? homeProb > awayProb : false;
  const source = polyHomeProb !== undefined ? 'poly' : 'espn';

  const spread = match.odds?.homeSpread ?? match.odds?.spread;
  const total = match.odds?.overUnder ?? match.odds?.total;
  const hasOdds = isValidOdd(spread) || isValidOdd(total);
  const hasProb = homeProb !== undefined || awayProb !== undefined;

  const { startTimeStr, dateStr, roundStr } = useMemo(() => {
    const d = new Date(match.startTime);
    return {
      startTimeStr: d
        .toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        .replace(' ', ''),
      dateStr: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
      roundStr: match.round
        ? match.round.replace('Qualifying ', 'Q').replace('Round of ', 'R').replace('Round ', 'R')
        : null
    };
  }, [match.startTime, match.round]);

  return (
    <motion.div
      ref={ref}
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      whileHover={{ scale: 1.002, backgroundColor: "#F8FAFC", zIndex: 10 }}
      whileTap={{ scale: 0.998 }}
      transition={PHYSICS_MOTION}
      onClick={() => onSelect?.(match)}
      role="button"
      tabIndex={0}
      aria-label={`${match.awayTeam?.name || 'Away Team'} vs ${match.homeTeam?.name || 'Home Team'}`}
      onKeyDown={(e: React.KeyboardEvent) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); onSelect?.(match); } }}
      className={cn(
        "group relative flex items-center justify-between px-3 py-2.5 md:px-5 md:py-3 cursor-pointer transform-gpu min-h-[44px]",
        "focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:outline-none focus-visible:ring-inset",
        "transition-colors duration-200",
        "border-b border-slate-200/60",
        "last:border-b-0",
        isSelected ? "bg-slate-50" : "bg-white hover:bg-slate-50/50"
      )}
    >
      <div className={cn(
        "absolute left-0 top-0 bottom-0 transition-all duration-300 ease-out z-10 rounded-r-[2px]",
        isPinned
          ? "bg-amber-500 w-[3px] opacity-100"
          : isSelected
            ? "bg-slate-900 w-1 opacity-100"
            : "bg-slate-300 w-1 scale-y-0 opacity-0 group-hover:scale-y-100 group-hover:opacity-100"
      )} />

      {/* Team Data */}
      <div className="flex flex-col flex-1 min-w-0 pr-6 pl-1.5 md:pl-0 pt-0.5 pb-1 gap-1.5">
        {[match.awayTeam, match.homeTeam].map((team, idx) => {
          // Guard against malformed API payloads where one team is null
          if (!team) return null;

          const isHome = idx === 1;
          const score = isHome ? match.homeScore : match.awayScore;
          const otherScore = isHome ? match.awayScore : match.homeScore;

          // Math-safe: coerce to Number to prevent string comparison bugs ("10" < "9")
          const numScore = Number(score);
          const numOther = Number(otherScore);
          const hasScores = score != null && otherScore != null && !isNaN(numScore) && !isNaN(numOther);
          const isWinner = isFinal && hasScores && numScore > numOther;
          const isLoser = isFinal && hasScores && numScore < numOther;

          const prob = isHome ? homeProb : awayProb;
          const isFav = isHome ? homeFav : !homeFav;

          return (
            <div key={team.id || idx} className="flex items-center gap-3">
              <div className="shrink-0 flex items-center justify-center" style={{ width: LOGO_W, height: LOGO_W }} aria-hidden="true">
                {isTennis && team.flag ? (
                  <div className="w-[18px] h-[13px] overflow-hidden rounded-[1px]">
                    <img src={team.flag} alt="" className="w-full h-full object-cover" />
                  </div>
                ) : (
                  <TeamLogo
                    logo={team.logo}
                    name={team.name}
                    className="w-full h-full object-contain relative z-10 transition-transform duration-300 group-hover:scale-110"
                  />
                )}
              </div>

              <div className="flex-1 min-w-0 flex items-baseline gap-2">
                <span className={cn(
                  "text-[15px] tracking-tight truncate transition-colors duration-300 select-none",
                  isLoser ? "text-slate-400 font-medium" : "text-slate-900 font-semibold"
                )}>
                  {team.name}
                </span>
                {team.record && !isLive && (
                  <span className="text-[10px] font-medium text-slate-300 tabular-nums shrink-0 hidden sm:inline">
                    {team.record}
                  </span>
                )}
              </div>

              {showScores && (
                <div className="shrink-0 flex items-center justify-end" style={{ width: isTennis ? 'auto' : SCORE_W }}>
                  {isTennis ? (
                    <TennisSetScores linescores={team.linescores} />
                  ) : (
                    <ScoreCell score={score} isWinner={isWinner} isLoser={isLoser} />
                  )}
                </div>
              )}

              {hasProb && !isFinal && (
                <div className="shrink-0" style={{ width: PROB_W }}>
                  <OddsLensPill
                    value={prob}
                    isFavorite={isFav}
                    edge={isHome ? homeEdge : awayEdge}
                    source={source}
                  />
                </div>
              )}
            </div>
          );
        })}

        {hasOdds && !isFinal && !isLive && (
          <div className="flex items-center gap-4 mt-1" style={{ paddingLeft: TEAM_INDENT }}>
            <OddsChip label="SPR" value={spread} />
            <OddsChip label="O/U" value={total} />
          </div>
        )}
      </div>

      {/* Status Metadata */}
      <div className="flex flex-col items-end gap-1 pl-6 min-w-[80px] border-l border-slate-200 py-1 select-none">
        {isLive ? (
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-1.5">
              <PinButton isPinned={isPinned} onToggle={onTogglePin} />
              <div className="flex items-center gap-1.5 bg-zinc-50 px-1.5 py-0.5 rounded border border-zinc-200">
                <span className="text-[10px] font-bold text-zinc-900 uppercase tracking-widest font-mono mt-[1px]">
                  {match.displayClock || 'LIVE'}
                </span>
              </div>
            </div>
            <span className="text-[9px] font-semibold text-slate-500 uppercase tracking-widest pr-0.5">
              {isTennis && roundStr ? roundStr : getPeriodDisplay(match)}
            </span>
          </div>
        ) : isFinal ? (
          <div className="flex items-center gap-1.5">
            <PinButton isPinned={isPinned} onToggle={onTogglePin} />
            <span className="text-[10px] font-semibold text-slate-400 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded uppercase tracking-widest">FINAL</span>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-1.5">
              <PinButton isPinned={isPinned} onToggle={onTogglePin} />
              <span className="text-[13px] font-mono font-medium text-slate-600 tabular-nums tracking-wide group-hover:text-slate-800 transition-colors" suppressHydrationWarning>
                {startTimeStr}
              </span>
            </div>
            {isTennis && roundStr && (
              <span className="text-[9px] font-medium text-slate-500 uppercase tracking-wider">
                {roundStr}
              </span>
            )}
            {!isTennis && (
              <span className="text-[9px] font-medium text-slate-400 tracking-wide" suppressHydrationWarning>
                {dateStr}
              </span>
            )}
          </>
        )}
      </div>
    </motion.div>
  );
});

MatchRow.displayName = 'MatchRow';

export default MatchRow;
