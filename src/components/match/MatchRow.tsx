import React from 'react';
import { MatchRowProps } from '../../types/matchList';
import TeamLogo from '../shared/TeamLogo';
import { motion } from 'framer-motion';
import { cn } from '../../lib/essence';
import { getPeriodDisplay } from '../../utils/matchUtils';
import { Sport, Linescore } from '../../types';

// Format a single set score with optional tiebreak
const formatSetScore = (value?: number, tiebreak?: number) => {
  if (value === undefined || value === null) return '-';
  if (tiebreak !== undefined && tiebreak !== null) {
    return `${value}(${tiebreak})`;
  }
  return `${value}`;
};

// Render Tennis set scores horizontally
const TennisSetScores: React.FC<{ linescores?: Linescore[] }> = ({ linescores }) => {
  if (!linescores || linescores.length === 0) return <span className="text-zinc-500">-</span>;

  return (
    <div className="flex gap-2 font-mono text-[13px] tabular-nums">
      {linescores.map((ls, idx) => (
        <span
          key={idx}
          className={cn(
            "font-bold",
            ls.winner ? "text-white" : "text-zinc-500"
          )}
        >
          {formatSetScore(ls.value, ls.tiebreak)}
        </span>
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

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileTap={{ scale: 0.985 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      onClick={() => onSelect(match)}
      className="relative flex items-center justify-between px-5 py-4 cursor-pointer border-b border-white/[0.04] bg-[#000000] hover:bg-white/[0.02] transition-colors duration-300 active:bg-white/[0.04] group tap-feedback"
    >
      {/* Active Selection Indicator */}
      {isPinned && (
        <motion.div
          layoutId={`pin-${match.id}`}
          className="absolute left-0 w-[3px] h-8 bg-amber-400 rounded-r-full shadow-[0_0_12px_rgba(251,191,36,0.4)]"
        />
      )}

      {/* Team Block */}
      <div className="flex flex-col gap-3 flex-1 min-w-0">
        {[match.awayTeam, match.homeTeam].map((team, idx) => {
          const isHome = idx === 1;
          const score = isHome ? match.homeScore : match.awayScore;
          const otherScore = isHome ? match.awayScore : match.homeScore;
          const isWinner = score > otherScore;
          const isLoser = score < otherScore;

          return (
            <div key={team.id} className="flex items-center gap-4">
              <motion.div
                layoutId={`logo-${match.id}-${team.id}`}
                className="relative"
              >
                {isTennis && team.flag ? (
                  // Tennis: Show country flag
                  <img
                    src={team.flag}
                    alt=""
                    className="w-5 h-4 object-cover rounded-[2px]"
                  />
                ) : (
                  // Other sports: Show team logo
                  <>
                    <div className="absolute inset-0 blur-md opacity-20" style={{ backgroundColor: team.color ? (team.color.startsWith('#') ? team.color : `#${team.color}`) : '#333' }} />
                    <TeamLogo logo={team.logo} className="w-5 h-5 relative z-10 grayscale-[0.3] group-hover:grayscale-0 transition-all duration-300" />
                  </>
                )}
              </motion.div>
              <span className={cn(
                "text-[15px] font-semibold tracking-tight truncate transition-colors flex-1",
                isLoser && isFinal ? "text-zinc-500" : "text-white"
              )}>
                {team.name}
              </span>
              {showScores && (
                isTennis ? (
                  // Tennis: Show set-by-set scores
                  <TennisSetScores linescores={team.linescores} />
                ) : (
                  // Other sports: Single score
                  <span className="ml-auto font-mono text-[15px] font-bold tabular-nums text-zinc-100 tracking-tight">
                    {score}
                  </span>
                )
              )}
            </div>
          );
        })}
      </div>

      {/* Status Metadata */}
      <div className="flex flex-col items-end gap-1.5 pl-8 min-w-[90px]">
        {isLive ? (
          <div className="flex flex-col items-end leading-none">
            <span className="text-[10px] font-black text-rose-400 uppercase tracking-widest animate-pulse">
              {match.displayClock || 'LIVE'}
            </span>
            <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mt-1">
              {isTennis && match.round ? match.round.replace('Qualifying ', 'Q').replace('Round of ', 'R').replace('Round ', 'R') : getPeriodDisplay(match)}
            </span>
          </div>
        ) : isFinal ? (
          <span className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">Final</span>
        ) : (
          <span className="text-[13px] font-mono-ledger font-bold text-zinc-400 tabular-nums">
            {new Date(match.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(' ', '')}
          </span>
        )}
        {/* Tennis: Show round for scheduled matches */}
        {isTennis && !isLive && !isFinal && match.round && (
          <span className="text-[9px] text-zinc-600 uppercase tracking-wider">
            {match.round.replace('Qualifying ', 'Q').replace('Round of ', 'R').replace('Round ', 'R')}
          </span>
        )}
      </div>
    </motion.div>
  );
};

export default React.memo(MatchRow);
