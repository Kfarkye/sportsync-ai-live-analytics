// ===================================================================
// MatchRow.tsx — Editorial Light
// ===================================================================

import React, { useMemo, memo } from 'react';
import { motion } from 'framer-motion';
import { MatchRowProps } from '@/types/matchList';
import TeamLogo from '../shared/TeamLogo';
import { cn, ESSENCE } from '@/lib/essence';
import { getPeriodDisplay } from '../../utils/matchUtils';
import { Sport, Linescore } from '@/types';

const PHYSICS_MOTION = { type: "spring", stiffness: 400, damping: 25 };

// Tennis Set Scores
const TennisSetScores: React.FC<{ linescores?: Linescore[] }> = ({ linescores }) => {
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
};

const MatchRow: React.FC<MatchRowProps> = ({
  match,
  isPinned,
  isLive,
  isFinal,
  onSelect,
}) => {
  const showScores = isLive || isFinal;
  const isTennis = match.sport === Sport.TENNIS;

  const { startTimeStr, roundStr } = useMemo(() => ({
    startTimeStr: new Date(match.startTime)
      .toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      .replace(' ', ''),
    roundStr: match.round
      ? match.round.replace('Qualifying ', 'Q').replace('Round of ', 'R').replace('Round ', 'R')
      : null
  }), [match.startTime, match.round]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      whileHover={{ scale: 1.002, backgroundColor: "#F8FAFC", zIndex: 10 }}
      whileTap={{ scale: 0.998 }}
      transition={PHYSICS_MOTION}
      onClick={() => onSelect(match)}
      role="button"
      tabIndex={0}
      aria-label={`${match.awayTeam.name} vs ${match.homeTeam.name}`}
      onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(match); } }}
      className={cn(
        "group relative flex items-center justify-between px-3 py-4 md:px-5 md:py-5 cursor-pointer transform-gpu",
        "focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:outline-none focus-visible:ring-inset",
        "bg-white",
        "transition-all duration-300",
        // Crisp border divider
        "border-b border-slate-200/60",
        "last:border-b-0"
      )}
    >
      {/* Left Edge Indicator */}
      <div className={cn(
        "absolute left-0 top-0 bottom-0 w-[3px] transition-all duration-300 ease-out z-10 rounded-r-full",
        isPinned
          ? "bg-amber-500 opacity-100"
          : "bg-slate-900 scale-y-0 opacity-0 group-hover:scale-y-100 group-hover:opacity-100"
      )} />

      {/* Team Data */}
      <div className="flex flex-col gap-3 flex-1 min-w-0 pr-6">
        {[match.awayTeam, match.homeTeam].map((team, idx) => {
          const isHome = idx === 1;
          const score = isHome ? match.homeScore : match.awayScore;
          const otherScore = isHome ? match.awayScore : match.homeScore;
          const isWinner = isFinal && (typeof score === 'number' && typeof otherScore === 'number' && score > otherScore);
          const isLoser = isFinal && (typeof score === 'number' && typeof otherScore === 'number' && score < otherScore);

          return (
            <div key={team.id || idx} className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-4 min-w-0 flex-1">
                <div className="relative w-8 h-8 shrink-0 flex items-center justify-center">
                  {isTennis && team.flag ? (
                    <div className="w-5 h-3.5 overflow-hidden rounded-[1px]">
                      <img src={team.flag} alt="" className="w-full h-full object-cover" />
                    </div>
                  ) : (
                    <TeamLogo
                      logo={team.logo}
                      className="w-full h-full object-contain relative z-10 transition-transform duration-300 group-hover:scale-110"
                    />
                  )}
                </div>

                <span className={cn(
                  "text-[15px] tracking-tight truncate transition-colors duration-300 select-none",
                  isLoser ? "text-slate-400 font-medium" : "text-slate-900 font-semibold"
                )}>
                  {team.name}
                </span>
              </div>

              {showScores && (
                <div className="shrink-0">
                  {isTennis ? (
                    <TennisSetScores linescores={team.linescores} />
                  ) : (
                    <span className={cn(
                      "font-mono text-[16px] tabular-nums leading-none tracking-tight transition-colors duration-300",
                      isLoser ? "text-slate-400 font-medium" : "text-slate-900 font-bold"
                    )}>
                      {score ?? '-'}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Status Metadata */}
      <div className="flex flex-col items-end gap-1 pl-6 min-w-[80px] border-l border-slate-200 py-1 select-none">
        {isLive ? (
          <>
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-1.5 w-1.5">
                <span className="motion-reduce:hidden animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-600"></span>
              </span>
              <span className="text-[9px] font-bold text-red-600 uppercase tracking-[0.2em] font-mono">
                {match.displayClock || 'LIVE'}
              </span>
            </div>
            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-[0.1em] mt-0.5">
              {isTennis && roundStr ? roundStr : getPeriodDisplay(match)}
            </span>
          </>
        ) : isFinal ? (
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">FINAL</span>
        ) : (
          <>
            <span className="text-[13px] font-mono font-medium text-slate-700 tabular-nums tracking-wide group-hover:text-slate-900 transition-colors">
              {startTimeStr}
            </span>
            {isTennis && roundStr && (
              <span className="text-[9px] font-medium text-slate-500 uppercase tracking-wider">
                {roundStr}
              </span>
            )}
            {!isTennis && (
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-[0.2em]">
                START
              </span>
            )}
          </>
        )}
      </div>
    </motion.div>
  );
};

export default memo(MatchRow);
