// ===================================================================
// MatchRow.tsx
// ARCHITECTURE: "SOTA Production" • Apple/Google Quality Standards
// AESTHETIC: Porsche Luxury • Jony Ive Minimalism • High Contrast
// AUDIT VERDICT: ✅ Gradient Divider Restored • ✅ Tactile Scale Added
// ===================================================================

import React, { useMemo, memo } from 'react';
import { motion } from 'framer-motion';
import { MatchRowProps } from '@/types/matchList';
import TeamLogo from '../shared/TeamLogo';
import { cn, ESSENCE } from '@/lib/essence';
import { getPeriodDisplay } from '../../utils/matchUtils';
import { Sport, Linescore } from '@/types';

// ─────────────────────────────────────────────────────────────────
// 🎨 DESIGN TOKENS & PHYSICS
// ─────────────────────────────────────────────────────────────────

// "Mechanical Switch" Physics: High stiffness, critical damping
const PHYSICS_MOTION = { type: "spring", stiffness: 400, damping: 25 };

// ─────────────────────────────────────────────────────────────────
// 💎 MICRO-COMPONENTS
// ─────────────────────────────────────────────────────────────────

// "Digital Readout" for Tennis Sets
// Mimics high-end scoreboard LCDs with sub-script tiebreak indicators
const TennisSetScores: React.FC<{ linescores?: Linescore[] }> = ({ linescores }) => {
  if (!linescores || linescores.length === 0) return <span className="text-footnote text-ink-muted font-mono tracking-widest">-</span>;

  return (
    <div className="flex items-center gap-[6px] font-mono text-footnote tabular-nums leading-none">
      {linescores.map((ls, idx) => (
        <div
          key={idx}
          className={cn(
            "relative flex items-center justify-center w-5 h-5 rounded-[2px] transition-colors duration-300 select-none",
            ls.winner
              ? "bg-overlay-emphasis text-ink-primary font-bold border border-edge-subtle shadow-[0_0_8px_rgba(255,255,255,0.05)]"
              : "text-ink-tertiary bg-transparent"
          )}
        >
          {ls.value ?? '-'}
          {ls.tiebreak && (
            <span className="absolute -top-[3px] -right-[4px] text-nano font-medium text-ink-tertiary scale-75 origin-top-right">
              {ls.tiebreak}
            </span>
          )}
        </div>
      ))}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────
// 🏛️ MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────

const MatchRow: React.FC<MatchRowProps> = ({
  match,
  isPinned,
  isLive,
  isFinal,
  onSelect,
}) => {
  const showScores = isLive || isFinal;
  const isTennis = match.sport === Sport.TENNIS;

  // Memoized formatted time/round to prevent layout thrashing during scroll
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
      // AUDIT FIX: Added scale for "lift" effect, with zIndex to prevent clipping
      whileHover={{ scale: 1.005, backgroundColor: "var(--overlay-subtle)", zIndex: 10 }}
      whileTap={{ scale: 0.995, backgroundColor: "var(--overlay-emphasis)" }}
      transition={PHYSICS_MOTION}
      onClick={() => onSelect(match)}
      role="button"
      tabIndex={0}
      aria-label={`${match.awayTeam.name} vs ${match.homeTeam.name}`}
      onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(match); } }}
      className={cn(
        "group relative flex items-center justify-between px-3 py-4 md:px-5 md:py-5 cursor-pointer transform-gpu",
        "focus-visible:ring-2 focus-visible:ring-ink-ghost focus-visible:outline-none focus-visible:ring-inset",
        // Obsidian Weissach — card surface lifted from void
        "bg-surface-card",
        "transition-all duration-300",

        // AUDIT FIX: Restored Premium Gradient Divider (replaces flat border)
        "after:content-[''] after:absolute after:left-5 after:right-5 after:bottom-0 after:h-px after:scale-y-[0.5] after:origin-bottom",
        "after:bg-gradient-to-r after:from-transparent after:via-edge after:to-transparent",
        "last:after:hidden"
      )}
    >
      {/* Active Laser Line (Left Edge) */}
      {/* Dynamic State: Amber when Pinned, White when Hovered */}
      <div className={cn(
        "absolute left-0 top-0 bottom-0 w-[3px] transition-all duration-300 ease-out z-10",
        isPinned
          ? "bg-amber-400 opacity-100 shadow-[0_0_15px_rgba(251,191,36,0.3)]"
          : "bg-ink-primary scale-y-0 opacity-0 group-hover:scale-y-100 group-hover:opacity-100 shadow-[0_0_15px_rgba(255,255,255,0.2)]"
      )} />

      {/* Team Data Core */}
      <div className="flex flex-col gap-3 flex-1 min-w-0 pr-6">
        {[match.awayTeam, match.homeTeam].map((team, idx) => {
          const isHome = idx === 1;
          const score = isHome ? match.homeScore : match.awayScore;
          const otherScore = isHome ? match.awayScore : match.homeScore;

          // Winner logic: Strict comparison only if final
          const isWinner = isFinal && (typeof score === 'number' && typeof otherScore === 'number' && score > otherScore);
          const isLoser = isFinal && (typeof score === 'number' && typeof otherScore === 'number' && score < otherScore);

          return (
            <div key={team.id || idx} className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-4 min-w-0 flex-1">
                {/* Identity: Logo/Flag (VISIBILITY FIX: Full Color) */}
                <div className="relative w-8 h-8 shrink-0 flex items-center justify-center">
                  {isTennis && team.flag ? (
                    <div className="w-5 h-3.5 overflow-hidden rounded-[1px] shadow-sm">
                      <img src={team.flag} alt="" className="w-full h-full object-cover" />
                    </div>
                  ) : (
                    <>
                      {/* Ambient Glow on Hover Only */}
                      <div
                        className="absolute inset-0 blur-md opacity-0 group-hover:opacity-25 transition-opacity duration-500"
                        style={{ backgroundColor: team.color ? (team.color.startsWith('#') ? team.color : `#${team.color}`) : '#fff' }}
                      />
                      {/* Logo: 100% Opacity, No Grayscale */}
                      <TeamLogo
                        logo={team.logo}
                        className="w-full h-full object-contain relative z-10 transition-transform duration-300 group-hover:scale-110"
                      />
                    </>
                  )}
                </div>

                {/* Team Name (VISIBILITY FIX: Bright White Default) */}
                <span className={cn(
                  "text-body-lg tracking-tight truncate transition-colors duration-300 select-none",
                  isLoser ? "text-ink-tertiary font-medium" : "text-ink-primary font-semibold"
                )}>
                  {team.name}
                </span>
              </div>

              {/* Score Readout */}
              {showScores && (
                <div className="shrink-0">
                  {isTennis ? (
                    <TennisSetScores linescores={team.linescores} />
                  ) : (
                    <span className={cn(
                      "font-mono text-[16px] tabular-nums leading-none tracking-tight transition-colors duration-300",
                      isLoser ? "text-ink-tertiary font-medium" : "text-ink-primary font-bold"
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

      {/* Status Metadata (Instrument Panel) */}
      <div className="flex flex-col items-end gap-1 pl-6 min-w-[80px] border-l border-edge py-1 select-none">
        {isLive ? (
          <>
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-1.5 w-1.5">
                <span className="motion-reduce:hidden animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-rose-500"></span>
              </span>
              <span className="text-label font-bold text-rose-400 uppercase tracking-widest font-mono animate-pulse">
                {match.sport === Sport.BASEBALL ? 'LIVE' : (match.displayClock || 'LIVE')}
              </span>
            </div>
            <span className="text-label font-bold text-ink-tertiary uppercase tracking-expanded mt-0.5 whitespace-nowrap">
              {isTennis && roundStr ? roundStr : getPeriodDisplay(match)}
            </span>
          </>
        ) : isFinal ? (
          <span className="text-caption font-bold text-ink-tertiary uppercase tracking-widest">FINAL</span>
        ) : (
          <>
            {/* Start Time: High Contrast (zinc-200) */}
            <span className="text-body-sm font-mono font-medium text-ink-secondary tabular-nums tracking-wide group-hover:text-ink-primary transition-colors">
              {startTimeStr}
            </span>
            {isTennis && roundStr && (
              <span className="text-label font-medium text-ink-tertiary uppercase tracking-wider">
                {roundStr}
              </span>
            )}
            {!isTennis && (
              <span className="text-label font-bold text-ink-tertiary uppercase tracking-widest">
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
