import React, { useMemo, memo, forwardRef } from 'react';
import { motion } from 'framer-motion';
import { MatchRowProps as BaseMatchRowProps } from '@/types/matchList';
import TeamLogo from '../shared/TeamLogo';
import { OddsLensPill } from '../shared/OddsLens';
import { useAppStore } from '@/store/appStore';
import { cn } from '@/lib/essence';
import { getPeriodDisplay } from '../../utils/matchUtils';
import { Sport, Linescore } from '@/types';
import { formatOddsByMode } from '@/lib/oddsDisplay';

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
}

const PHYSICS_MOTION = { type: "spring" as const, stiffness: 360, damping: 28 };

const LOGO_W = 28;
const TEAM_INDENT = LOGO_W + 16;

const isValidOdd = (val: string | number | null | undefined): boolean => val !== null && val !== undefined && val !== '-' && val !== '';

const ScoreCell = memo(({ score, isWinner, isLoser }: { score: string | number | null | undefined; isWinner: boolean; isLoser: boolean }) => (
  <span
    className={cn(
      "inline-flex items-center justify-center font-mono tabular-nums font-semibold select-none w-[30px] h-[22px] max-[390px]:w-[26px] max-[390px]:h-[20px] rounded-[6px] text-[14px] max-[390px]:text-[13px] shrink-0",
      isLoser ? "text-[#888888]" : "text-[#0A0A0A]",
      isWinner ? "font-bold" : "font-semibold"
    )}
  >
    {score ?? '-'}
  </span>
));
ScoreCell.displayName = 'ScoreCell';

const OddsChip = memo(({ label, value, mode }: {
  label: string;
  value: string | number | null | undefined;
  mode: ReturnType<typeof useAppStore.getState>['oddsLens'];
}) => {
  if (!isValidOdd(value)) return null;
  let display = String(value);
  if (label === 'SPR') {
    const num = Number(value);
    if (!isNaN(num)) {
      if (num === 0) display = 'PK';
      else if (num > 0 && !display.startsWith('+')) display = `+${display}`;
    }
  } else if (label === 'ML') {
    const converted = formatOddsByMode(value, mode, 'moneyline');
    if (!converted) return null;
    display = converted;
  }
  return (
    <span className="inline-flex items-center gap-1.5 select-none" aria-label={`${label} ${display}`}>
      <span className="font-semibold uppercase text-[8.5px] tracking-widest text-slate-400" aria-hidden="true">
        {label}
      </span>
      <span className="font-mono font-medium tabular-nums text-[10px] text-slate-600">
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
        : "opacity-0 group-hover:opacity-60 hover:opacity-100! max-[390px]:opacity-40"
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
  onSelect,
  onTogglePin,
}, ref) => {
  const showScores = isLive || isFinal;
  const isTennis = match.sport === Sport.TENNIS;
  const oddsLens = useAppStore((state) => state.oddsLens);

  // Priority: Polymarket (real money) > ESPN (model estimate)
  const homeProb = polyHomeProb ?? match.win_probability?.home;
  const awayProb = polyAwayProb ?? match.win_probability?.away;
  const homeFav = typeof homeProb === 'number' && typeof awayProb === 'number' ? homeProb > awayProb : false;
  const spread = match.odds?.homeSpread ?? match.odds?.spread ?? match.odds?.spread_home;
  const total = match.odds?.overUnder ?? match.odds?.total;
  const homeML = match.odds?.moneylineHome ?? match.odds?.homeML ?? match.odds?.homeWin ?? match.odds?.home_ml;
  const hasOdds = isValidOdd(spread) || isValidOdd(total) || isValidOdd(homeML);

  const { startTimeStr, dateStr, roundStr } = useMemo(() => {
    const d = new Date(match.startTime);
    return {
      startTimeStr: d
        .toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
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
      whileHover={{ backgroundColor: "rgba(255,255,255,0.42)", zIndex: 10, boxShadow: "0 12px 28px -20px rgba(15,23,42,0.45)" }}
      whileTap={{ scale: 0.998 }}
      transition={PHYSICS_MOTION}
      onClick={() => onSelect?.(match)}
      role="button"
      tabIndex={0}
      aria-label={`${match.awayTeam?.name || 'Away Team'} vs ${match.homeTeam?.name || 'Home Team'}`}
      onKeyDown={(e: React.KeyboardEvent) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); onSelect?.(match); } }}
      className={cn(
        "group relative flex items-center justify-between px-4 py-4 sm:px-4 sm:py-4 max-[390px]:px-3 max-[390px]:py-3 cursor-pointer transform-gpu min-h-[64px] max-[390px]:min-h-[58px] [-webkit-tap-highlight-color:transparent]",
        "focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none focus-visible:ring-inset",
        "transition-colors duration-200",
        "border border-white/35 bg-white/55 backdrop-blur-md shadow-[0_8px_20px_-18px_rgba(15,23,42,0.4)]",
        isSelected ? "bg-emerald-100/30" : "hover:bg-white/55"
      )}
    >
      <div className={cn(
        "absolute left-0 top-0 bottom-0 transition-all duration-300 ease-out z-10 rounded-r-[2px]",
        isPinned
          ? "bg-amber-500 w-[3px] opacity-100"
          : isSelected
            ? "bg-[#0B63F6] w-1 opacity-100"
            : "bg-white/60 w-[3px] scale-y-0 opacity-0 group-hover:scale-y-100 group-hover:opacity-100"
      )} />

      {/* Team Data */}
      <div className="flex flex-col flex-1 min-w-0 pr-2.5 sm:pr-5 max-[390px]:pr-1.5 pl-1 sm:pl-0 pt-0.5 pb-0.5 sm:pb-1.5 gap-1 sm:gap-1.5 max-[390px]:gap-0.5">
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
            <div key={team.id || idx} className="flex items-center gap-3 max-[390px]:gap-2">
              <div className="shrink-0 flex items-center justify-center" style={{ width: LOGO_W, height: LOGO_W }} aria-hidden="true">
                {isTennis && team.flag ? (
                  <div className="w-[18px] h-[13px] overflow-hidden rounded-[1px]">
                    <img src={team.flag} alt="" className="w-full h-full object-cover" />
                  </div>
                ) : (
                  <TeamLogo
                    logo={team.logo}
                    name={team.name}
                    teamColor={team.color}
                    className="w-full h-full object-contain relative z-10 transition-transform duration-300 group-hover:scale-110"
                  />
                )}
              </div>

              <div className="flex-1 min-w-0 flex items-baseline gap-2">
                <span className={cn(
                  "text-[14px] max-[390px]:text-[13px] leading-[1.15] tracking-tight truncate transition-colors duration-300 select-none",
                  isLoser ? "text-[#888888] font-medium" : "text-[#0A0A0A] font-medium"
                )}>
                  {team.name}
                </span>
                {team.record && !isLive && (
                  <span className="text-[10px] font-medium text-slate-400 tabular-nums shrink-0 hidden sm:inline">
                    {team.record}
                  </span>
                )}
              </div>

              {showScores && (
                <div className={cn("shrink-0 flex items-center justify-end", isTennis ? "w-auto" : "w-[32px] max-[390px]:w-[26px]")}>
                  {isTennis ? (
                    <TennisSetScores linescores={team.linescores} />
                  ) : (
                    <ScoreCell score={score} isWinner={isWinner} isLoser={isLoser} />
                  )}
                </div>
              )}

              {!isLive && (homeProb !== undefined || awayProb !== undefined) && (
                <div className="shrink-0 w-[96px] max-[390px]:w-[82px]">
                  <OddsLensPill
                    value={prob}
                    isFavorite={isFav}
                  />
                </div>
              )}
            </div>
          );
        })}

        {hasOdds && !isFinal && !isLive && (
          <div className="flex items-center flex-wrap gap-x-4 gap-y-1 max-[390px]:gap-x-3 mt-1 max-[390px]:mt-0.5" style={{ paddingLeft: TEAM_INDENT }}>
            <OddsChip label="SPR" value={spread} mode={oddsLens} />
            <OddsChip label="O/U" value={total} mode={oddsLens} />
            <OddsChip label="ML" value={homeML} mode={oddsLens} />
          </div>
        )}
      </div>

      {/* Status Metadata */}
      <div className="flex flex-col items-end gap-1 max-[390px]:gap-0.5 pl-3 sm:pl-5 max-[390px]:pl-2 min-w-[74px] sm:min-w-[82px] max-[390px]:min-w-[66px] border-l border-white/35 py-1 select-none">
        {isLive ? (
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-1.5">
              <PinButton isPinned={isPinned} onToggle={onTogglePin} />
              <div className="flex items-center gap-1.5 rounded-md px-2 py-0.5 border border-emerald-200/70 bg-emerald-100/55 backdrop-blur-sm">
                <span className="relative inline-flex h-2.5 w-2.5 items-center justify-center">
                  <span className="absolute inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500/30 animate-ping [animation-duration:2s]" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                </span>
                <span className="text-[10px] font-semibold text-[#0A0A0A] font-mono tabular-nums tracking-[0.06em]">
                  {match.displayClock || 'LIVE'}
                </span>
              </div>
            </div>
            <span className="text-[9px] font-medium text-[#888888] uppercase tracking-[0.12em] pr-0.5">
              {isTennis && roundStr ? roundStr : getPeriodDisplay(match)}
            </span>
          </div>
        ) : isFinal ? (
          <div className="flex items-center gap-1.5">
            <PinButton isPinned={isPinned} onToggle={onTogglePin} />
            <span className="text-[9px] font-semibold text-[#555555] bg-white/55 border border-white/45 px-2 py-0.5 rounded-md uppercase tracking-[0.12em] font-mono backdrop-blur-sm">FINAL</span>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-1.5">
              <PinButton isPinned={isPinned} onToggle={onTogglePin} />
              <span className="text-[12px] max-[390px]:text-[11px] font-mono font-semibold text-[#0A0A0A] tabular-nums tracking-wide group-hover:text-slate-900 transition-colors" suppressHydrationWarning>
                {startTimeStr}
              </span>
            </div>
            {isTennis && roundStr && (
              <span className="text-[8.5px] font-medium text-slate-500 uppercase tracking-wider">
                {roundStr}
              </span>
            )}
            {!isTennis && (
              <span className="text-[8.5px] font-medium text-[#888888] tracking-wide" suppressHydrationWarning>
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
