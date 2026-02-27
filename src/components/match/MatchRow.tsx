// ═══════════════════════════════════════════════════════════════════════════════
// MatchRow.tsx — ESSENCE v12 · Editorial Light · Pass 4 (Production)
//
// Pass 4 Fixes (Production Hardening):
//   ✓ forwardRef: Critical for Framer Motion AnimatePresence & virtualization.
//   ✓ SSR Hydration: Added suppressHydrationWarning to localized date/time strings.
//   ✓ Math Safety: Coerced string scores to Numbers to prevent "10" < "9" bugs.
//   ✓ Safe Callbacks: Optional chaining (?.()) prevents crashes in read-only views.
//   ✓ Data Resilience: Pre-render guards for malformed API payloads (TBD teams).
//   ✓ Framer Bubbling: onPointerDown stopPropagation on PinButton.
// ═══════════════════════════════════════════════════════════════════════════════

import React, { useMemo, memo, forwardRef } from 'react';
import { motion } from 'framer-motion';
import { MatchRowProps as BaseMatchRowProps } from '@/types/matchList';
import TeamLogo from '../shared/TeamLogo';
import { cn, ESSENCE } from '@/lib/essence';
import { getPeriodDisplay } from '../../utils/matchUtils';
import { Sport, Linescore } from '@/types';

interface MatchRowProps extends BaseMatchRowProps {
  isSelected?: boolean;
}

const SPRING = { type: 'spring' as const, stiffness: 400, damping: 25 };

// Column widths for tabular alignment across all rows in a feed
const LOGO_W = 20;   // px — team logo
const LOGO_GAP = 12; // px — gap after logo
const SCORE_W = 32;  // px — fixed score cell width
const PROB_W = 46;   // px — fixed probability pill width
const TEAM_INDENT = LOGO_W + LOGO_GAP; // 32px — where team name starts

// ─── Utility ─────────────────────────────────────────────────────────────────

const isValidOdd = (val: string | number | null | undefined): boolean => {
  return val !== null && val !== undefined && val !== '-' && val !== '';
};

// ─── Subcomponents (Memoized for virtualization rendering speed) ─────────────

const ProbPill = memo(function ProbPill({ value, isFavorite }: { value: number | undefined; isFavorite: boolean }) {
  if (value === undefined || value === null || isNaN(value)) return <span className="w-[46px] shrink-0" aria-hidden="true" />;
  const pct = Math.round(value);
  if (pct <= 0 || pct > 100) return <span className="w-[46px] shrink-0" aria-hidden="true" />;

  return (
    <span
      className="inline-flex items-center justify-center tabular-nums font-semibold select-none w-[46px] h-[22px] rounded-[6px] text-[11px] tracking-[-0.01em] shrink-0"
      title={`${pct}% win probability`}
      style={{
        color: isFavorite ? ESSENCE.colors.accent.emerald : ESSENCE.colors.text.tertiary,
        border: `1px solid ${isFavorite ? 'rgba(16,185,129,0.25)' : ESSENCE.colors.border.ghost}`,
        backgroundColor: isFavorite ? ESSENCE.colors.accent.emeraldMuted : 'transparent',
      }}
    >
      {pct}%
    </span>
  );
});

const ScoreCell = memo(function ScoreCell({
  score, isWinner, isLoser,
}: {
  score: string | number | null | undefined; isWinner: boolean; isLoser: boolean;
}) {
  return (
    <span
      className="inline-flex items-center justify-center font-mono tabular-nums font-bold select-none w-[32px] h-[24px] rounded-[6px] text-[15px] tracking-[-0.02em] transition-colors duration-200 shrink-0"
      style={{
        color: isLoser ? ESSENCE.colors.text.muted : ESSENCE.colors.text.primary,
        backgroundColor: isWinner ? ESSENCE.colors.overlay.emphasis : 'transparent',
      }}
    >
      {score ?? '-'}
    </span>
  );
});

const TennisSetScores = memo(function TennisSetScores({ linescores }: { linescores?: Linescore[] }) {
  if (!linescores?.length) return <span className="text-[11px] font-mono text-slate-400 w-[32px] text-center shrink-0">-</span>;

  return (
    <div className="flex items-center gap-[5px] font-mono text-[11px] tabular-nums leading-none shrink-0">
      {linescores.map((ls, idx) => (
        <div
          key={idx}
          className={cn(
            "relative flex items-center justify-center w-[18px] h-[18px] rounded-[3px] select-none",
            ls.winner
              ? "bg-slate-100 text-slate-900 font-bold border border-slate-200"
              : "text-slate-400"
          )}
        >
          {ls.value ?? '-'}
          {ls.tiebreak && (
            <span className="absolute -top-0.5 -right-1 text-[7px] font-medium text-slate-400">
              {ls.tiebreak}
            </span>
          )}
        </div>
      ))}
    </div>
  );
});

const LiveBadge = memo(function LiveBadge({ clock, period }: { clock: string; period: string }) {
  return (
    <div className="flex flex-col items-end gap-1 shrink-0" aria-live="polite">
      <div className="flex items-center gap-1.5 bg-red-50 px-1.5 py-[3px] rounded-md border border-red-100">
        <span className="relative flex h-[5px] w-[5px]" aria-hidden="true">
          <span
            className="absolute inset-0 rounded-full bg-red-400"
            style={{ animation: 'matchrow-pulse 2.4s cubic-bezier(0.4,0,0.6,1) infinite' }}
          />
          <span className="relative inline-flex rounded-full h-[5px] w-[5px] bg-red-600" />
        </span>
        <span className="text-[10px] font-bold text-red-600 uppercase tracking-[0.06em] font-mono leading-none">
          {clock || 'LIVE'}
        </span>
      </div>
      {period && (
        <span
          className="font-bold uppercase leading-none text-[9px] tracking-[0.1em]"
          style={{ color: ESSENCE.colors.text.tertiary }}
        >
          {period}
        </span>
      )}
    </div>
  );
});

const OddsChip = memo(function OddsChip({ label, value }: { label: string; value: string | number | null | undefined }) {
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
    <span className="inline-flex items-center gap-1 select-none" aria-label={`${label} ${display}`}>
      <span
        className="font-bold uppercase text-[9px] tracking-[0.06em]"
        style={{ color: ESSENCE.colors.text.muted }}
        aria-hidden="true"
      >
        {label}
      </span>
      <span
        className="font-mono font-semibold tabular-nums text-[11px] tracking-[-0.01em]"
        style={{ color: ESSENCE.colors.text.secondary }}
      >
        {display}
      </span>
    </span>
  );
});

const PinButton = memo(function PinButton({ isPinned, onToggle }: { isPinned: boolean; onToggle: (e: React.MouseEvent) => void }) {
  return (
    <button
      type="button"
      onPointerDown={(e) => e.stopPropagation()} // Prevents Framer Motion from scaling the row when clicking the pin
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggle(e); }}
      className={cn(
        "flex items-center justify-center w-6 h-6 p-1 rounded-md transition-all duration-200 shrink-0 outline-none",
        "focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:opacity-100",
        isPinned
          ? "text-amber-400 hover:text-amber-500"
          : "text-slate-300 opacity-0 group-hover:opacity-100 hover:text-slate-500"
      )}
      aria-label={isPinned ? "Remove from watchlist" : "Add to watchlist"}
      aria-pressed={isPinned}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill={isPinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    </button>
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

// Wrapped in forwardRef for List Virtualization and AnimatePresence support
const MatchRow = forwardRef<HTMLDivElement, MatchRowProps>(({
  match,
  isPinned = false,
  isLive = false,
  isFinal = false,
  isSelected = false,
  onSelect,
  onTogglePin,
}, ref) => {
  // Defensive early return if the core payload is completely broken
  if (!match) return null;

  const showScores = isLive || isFinal;
  const isTennis = match.sport === Sport.TENNIS;

  // ── Derived display data (Robust Parsing & SSR Hydration Guard) ─────
  const { startTimeStr, dateStr, roundStr } = useMemo(() => {
    if (!match.startTime) {
      return { startTimeStr: '--:--', dateStr: 'TBD', roundStr: match.round || null };
    }

    try {
      const d = new Date(match.startTime);
      if (isNaN(d.getTime())) throw new Error("Invalid date");

      return {
        // Enforcing 'en-US' locale prevents server/client string formatting mismatches
        startTimeStr: d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(' ', ''),
        dateStr: d.toLocaleDateString('en-US', { weekday: 'short' }),
        roundStr: match.round
          ? match.round.replace(/Qualifying\s/i, 'Q').replace(/Round\s(?:of\s)?/i, 'R')
          : null,
      };
    } catch {
      return { startTimeStr: '--:--', dateStr: 'TBD', roundStr: match.round || null };
    }
  }, [match.startTime, match.round]);

  // Win probability cascade
  const homeProb = match.predictor?.homeTeamChance ?? match.win_probability?.home;
  const awayProb = match.predictor?.awayTeamChance ?? match.win_probability?.away;
  const hasProb = homeProb !== undefined && awayProb !== undefined && (homeProb > 0 || awayProb > 0);

  // If exactly tied, default home as "favorite" so at least one pill is emerald
  const homeFav = hasProb && (homeProb ?? 0) >= (awayProb ?? 0);

  // Odds cascade
  const spread = match.odds?.spread ?? match.current_odds?.spread;
  const total = match.odds?.overUnder ?? match.odds?.total ?? match.current_odds?.overUnder;
  const hasOdds = !isFinal && (isValidOdd(spread) || isValidOdd(total));

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      whileTap={{ scale: 0.998 }}
      transition={SPRING}
      onClick={() => onSelect?.(match)}
      role="button"
      tabIndex={0}
      aria-selected={isSelected}
      aria-label={`${match.awayTeam?.name || 'Away Team'} vs ${match.homeTeam?.name || 'Home Team'}${isFinal ? ', Final Score' : ''}`}
      onKeyDown={(e: React.KeyboardEvent) => {
        // Event target checking prevents inner buttons (like PinButton) 
        // from accidentally firing the full row selection when Enter is pressed.
        if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
          e.preventDefault();
          onSelect?.(match);
        }
      }}
      className={cn(
        "group relative flex items-stretch cursor-pointer transform-gpu antialiased",
        "focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:outline-none focus-visible:ring-inset",
        "transition-colors duration-150",
        "border-b last:border-b-0",
        isSelected ? "bg-slate-50 border-slate-200" : "bg-white border-slate-200/60",
        "hover:bg-[#F8FAFC]"
      )}
      style={{ minHeight: hasOdds ? 76 : 68 }}
    >
      {/* ── Left accent bar ───────────────────────────────────── */}
      <div
        aria-hidden="true"
        className={cn(
          "absolute left-0 top-0 bottom-0 z-10 rounded-r-[2px] transition-all duration-300 ease-out origin-left",
          isPinned
            ? "bg-amber-400 w-[3px] opacity-100"
            : isSelected
              ? "bg-slate-900 w-[3px] opacity-100"
              : isLive
                ? "bg-red-500 w-[2px] opacity-100"
                : "bg-slate-300 w-[2px] scale-y-0 opacity-0 group-hover:scale-y-75 group-hover:opacity-40"
        )}
      />

      {/* ── Main content ──────────────────────────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col justify-center gap-[5px] py-2.5 pl-3 pr-2 md:pl-5 md:pr-3">
        {/* Team rows */}
        {[match.awayTeam, match.homeTeam].map((team, idx) => {
          // Guard against malformed match API payloads where one team is unexpectedly null
          if (!team) return null;

          const isHome = idx === 1;
          const score = isHome ? match.homeScore : match.awayScore;
          const otherScore = isHome ? match.awayScore : match.homeScore;

          // Math-safe score comparison handles string scores ("10" vs "9") properly
          const numScore = Number(score);
          const numOther = Number(otherScore);
          const hasScores = score != null && otherScore != null && score !== '' && otherScore !== '' && !isNaN(numScore) && !isNaN(numOther);

          const isWinner = isFinal && hasScores && numScore > numOther;
          const isLoser = isFinal && hasScores && numScore < numOther;

          const prob = isHome ? homeProb : awayProb;
          const isFav = isHome ? homeFav : !homeFav;

          return (
            <div key={team.id || `team-${idx}`} className="flex items-center gap-3">
              {/* Logo */}
              <div className="shrink-0 flex items-center justify-center" style={{ width: LOGO_W, height: LOGO_W }} aria-hidden="true">
                {isTennis && team.flag ? (
                  <div className="w-[18px] h-[13px] overflow-hidden rounded-[1px]">
                    <img src={team.flag} alt="" className="w-full h-full object-cover" />
                  </div>
                ) : (
                  <TeamLogo
                    logo={team.logo}
                    className="w-full h-full object-contain transition-transform duration-300 group-hover:scale-110"
                  />
                )}
              </div>

              {/* Name + Record */}
              <div className="flex-1 min-w-0 flex items-baseline gap-2">
                <span
                  title={team.name}
                  className={cn(
                    "text-[14px] tracking-[-0.01em] truncate select-none transition-colors duration-200",
                    isLoser ? "text-slate-400 font-medium" : "text-slate-900 font-semibold"
                  )}
                >
                  {team.name}
                </span>
                {team.record && !isLive && (
                  <span
                    className="text-[10px] font-medium tabular-nums shrink-0 hidden sm:inline"
                    style={{ color: ESSENCE.colors.text.muted }}
                  >
                    {team.record}
                  </span>
                )}
              </div>

              {/* Score (fixed-width) */}
              {showScores && (
                <div className="shrink-0" style={{ width: isTennis ? 'auto' : SCORE_W }}>
                  {isTennis
                    ? <TennisSetScores linescores={team.linescores} />
                    : <ScoreCell score={score} isWinner={isWinner} isLoser={isLoser} />
                  }
                </div>
              )}

              {/* Probability pill (fixed-width for alignment) */}
              {hasProb && !isFinal && (
                <div className="shrink-0" style={{ width: PROB_W }}>
                  <ProbPill value={prob} isFavorite={isFav} />
                </div>
              )}
            </div>
          );
        })}

        {/* Odds row — aligned to start of team name column */}
        {hasOdds && (
          <div
            className="flex items-center gap-3"
            style={{ paddingLeft: TEAM_INDENT }}
          >
            <OddsChip label="SPR" value={spread} />
            <OddsChip label="O/U" value={total} />
          </div>
        )}
      </div>

      {/* ── Right column: Status + Pin ────────────────────────── */}
      <div
        className="flex items-center gap-1 shrink-0 pl-2 pr-2 md:pr-4 select-none"
        style={{ borderLeft: `1px solid ${ESSENCE.colors.border.ghost}` }}
      >
        <div className="flex flex-col items-end justify-center gap-1" style={{ minWidth: 64 }}>
          {isLive ? (
            <LiveBadge
              clock={match.displayClock || ''}
              period={isTennis && roundStr ? roundStr : getPeriodDisplay(match)}
            />
          ) : isFinal ? (
            <span
              className="text-[10px] font-bold uppercase tracking-[0.08em] px-2 py-[2px] rounded-[5px]"
              style={{
                color: ESSENCE.colors.text.secondary,
                backgroundColor: ESSENCE.colors.surface.subtle,
                border: `1px solid ${ESSENCE.colors.border.default}`,
              }}
            >
              Final
            </span>
          ) : (
            <>
              {/* suppressHydrationWarning added to prevent SSR timezone format mismatches */}
              <time
                dateTime={match.startTime}
                suppressHydrationWarning
                className="font-mono font-semibold tabular-nums text-[13px] tracking-[-0.01em]"
                style={{ color: ESSENCE.colors.text.primary }}
              >
                {startTimeStr}
              </time>
              <span
                suppressHydrationWarning
                className="font-medium text-[9px]"
                style={{
                  color: ESSENCE.colors.text.tertiary,
                  letterSpacing: isTennis ? '0.08em' : '0.04em',
                  textTransform: isTennis ? 'uppercase' : undefined,
                }}
              >
                {isTennis && roundStr ? roundStr : dateStr}
              </span>
            </>
          )}
        </div>

        {/* Pin/Star — visible on hover, always visible when pinned */}
        {onTogglePin && (
          <PinButton isPinned={isPinned} onToggle={onTogglePin} />
        )}
      </div>
    </motion.div>
  );
});

// React DevTools naming convention when using memo + forwardRef
MatchRow.displayName = 'MatchRow';

export default memo(MatchRow);
