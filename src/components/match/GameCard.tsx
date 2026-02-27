// ═══════════════════════════════════════════════════════════════════════════════
// GameCard.tsx — ESSENCE v13.1 · Premium Kalshi x Jony Ive (Production)
//
// Grid view card for LiveDashboard. Delegates to MatchRow for LIST mode.
// ═══════════════════════════════════════════════════════════════════════════════

import React, { memo } from 'react';
import { Match } from '@/types';
import MatchRow from './MatchRow';
import TeamLogo from '../shared/TeamLogo';
import { ESSENCE } from '@/lib/essence';

interface MatchCardProps {
    match: Match;
    viewMode: 'GRID' | 'LIST';
    isPinned: boolean;
    isLive: boolean;
    isFinal: boolean;
    hasAction: boolean;
    onSelect: () => void;
    onTogglePin: (id: string, e: React.MouseEvent | React.KeyboardEvent) => void;
}

// ─── Probability Pill (Memoized) ─────────────────────────────────────────────

const ProbPill = memo(({ value, isFav }: { value: number | undefined; isFav: boolean }) => {
    if (value === undefined || value === null || value <= 0 || value > 100) return null;

    return (
        <div
            className="inline-flex items-center justify-center font-mono font-medium tabular-nums transition-colors duration-300"
            style={{
                fontSize: 12,
                minWidth: 44,
                height: 26,
                padding: '0 8px',
                borderRadius: 999, // Perfect pill shape
                letterSpacing: '-0.02em',
                color: isFav ? ESSENCE.colors.accent.emerald : ESSENCE.colors.text.tertiary,
                backgroundColor: isFav ? 'rgba(16, 185, 129, 0.08)' : ESSENCE.colors.surface.subtle,
                // Ultra-delicate hairline inset border with a subtle top highlight to mimic physical milling
                boxShadow: isFav
                    ? 'inset 0 0 0 1px rgba(16, 185, 129, 0.12), inset 0 1px 1px rgba(255,255,255,0.6)'
                    : 'inset 0 0 0 1px rgba(0,0,0,0.04), inset 0 1px 1px rgba(255,255,255,0.6)',
            }}
        >
            {Math.round(value)}%
        </div>
    );
});
ProbPill.displayName = 'ProbPill';

// ─── Odds Chip (Memoized) ────────────────────────────────────────────────────

const OddsChip = memo(({ label, value }: { label: string; value: string | number | null | undefined }) => {
    if (value === null || value === undefined || value === '-' || value === '') return null;

    // Safely evaluate numbers (preventing NaN issues with string payloads like "O 42.5")
    const numValue = Number(value);
    const display = label === 'Spread' && !isNaN(numValue) && numValue === 0
        ? 'PK'
        : String(value).replace(/[OU]/g, '').trim();

    return (
        <div
            className="flex flex-col items-start px-3 py-1.5 rounded-[10px]"
            style={{
                backgroundColor: ESSENCE.colors.surface.subtle,
                boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.03), inset 0 1px 1px rgba(255,255,255,0.5)',
                minWidth: 60,
            }}
        >
            <span
                className="font-semibold uppercase leading-none"
                style={{ fontSize: 9, color: ESSENCE.colors.text.muted, letterSpacing: '0.08em', marginBottom: 4 }}
            >
                {label}
            </span>
            <span
                className="font-mono font-medium tabular-nums leading-none"
                style={{ fontSize: 13, color: ESSENCE.colors.text.primary, letterSpacing: '-0.02em' }}
            >
                {display}
            </span>
        </div>
    );
});
OddsChip.displayName = 'OddsChip';

// ═══════════════════════════════════════════════════════════════════════════════

const GameCard: React.FC<MatchCardProps> = memo(({
    match, viewMode, isPinned, isLive, isFinal, hasAction, onSelect, onTogglePin,
}) => {
    if (!match) return null; // Defensive render

    if (viewMode === 'LIST') {
        return (
            <MatchRow
                match={match}
                isPinned={isPinned}
                isLive={isLive}
                isFinal={isFinal}
                onSelect={onSelect}
                onTogglePin={(e) => onTogglePin(match.id, e)}
            />
        );
    }

    // ── GRID VIEW ──────────────────────────────────────────────
    const homeScore = match.homeScore ?? 0;
    const awayScore = match.awayScore ?? 0;
    const homeWinner = isFinal && homeScore > awayScore;
    const awayWinner = isFinal && awayScore > homeScore;

    // Probability safely falling back to different schema variations
    const homeProb = match.predictor?.homeTeamChance ?? match.win_probability?.home;
    const awayProb = match.predictor?.awayTeamChance ?? match.win_probability?.away;
    const hasProb = homeProb !== undefined && awayProb !== undefined && (homeProb > 0 || awayProb > 0);
    const homeFav = hasProb && (homeProb ?? 0) >= (awayProb ?? 0);

    // Clock Formatting safely handling malformed dates
    let clockDisplay = match.displayClock || match.minute || '';
    let periodDisplay = match.period ? (match.sport === 'SOCCER' ? '' : `Q${match.period}`) : '';

    if (!isLive && !isFinal && match.startTime) {
        try {
            const dateObj = new Date(match.startTime);
            // Validates it is a real date before localized string execution
            if (!isNaN(dateObj.getTime())) {
                clockDisplay = dateObj.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                periodDisplay = dateObj.toLocaleDateString([], { weekday: 'short' });
            }
        } catch (e) {
            // Fallback silently if date parsing fails entirely
            clockDisplay = 'TBA';
        }
    }

    // A11y Keydown handler
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect();
        }
    };

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={onSelect}
            onKeyDown={handleKeyDown}
            // Pure CSS Spring Physics via Tailwind (Hardware Accelerated)
            className={`
        group relative overflow-hidden flex flex-col h-full bg-white select-none cursor-pointer outline-none transform-gpu
        transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]
        hover:-translate-y-1 hover:shadow-[0_0_0_1px_rgba(0,0,0,0.04),0_16px_32px_-8px_rgba(0,0,0,0.08),0_4px_12px_-2px_rgba(0,0,0,0.04)]
        active:scale-[0.99] active:duration-150 focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:ring-offset-2
      `}
            style={{
                borderRadius: 24, // Continuous curve
                boxShadow: '0 0 0 1px rgba(0,0,0,0.04), 0 4px 20px -4px rgba(0,0,0,0.03), 0 2px 8px -2px rgba(0,0,0,0.02)',
            }}
        >
            {/* Refined Live accent bar — 1.5px gradient glowing hairline */}
            {isLive && (
                <div
                    className="absolute top-0 inset-x-0 z-10 opacity-85"
                    style={{
                        height: '1.5px',
                        background: `linear-gradient(90deg, transparent, ${ESSENCE.colors.accent.rose} 20%, ${ESSENCE.colors.accent.rose} 80%, transparent)`,
                        // Safe static box-shadow fallback to prevent breaking if 'rose' is an RGB constant instead of HEX
                        boxShadow: `0 1px 6px rgba(225, 29, 72, 0.4)`,
                    }}
                />
            )}

            {/* ── Status Header (Whisper Quiet) ─────────────────────────────────── */}
            <div className="flex items-center justify-between px-5 pt-4 pb-2 relative z-10">
                <div className="flex items-center gap-2.5">
                    {isLive ? (
                        <div className="flex items-center gap-2.5">
                            {/* Hardware LED Indicator using native Tailwind to prevent custom keyframe dropouts */}
                            <div className="relative flex items-center justify-center w-2 h-2" aria-hidden="true">
                                <span className="absolute inset-0 rounded-full bg-red-500 blur-[2px] animate-pulse opacity-80" />
                                <span className="relative rounded-full h-1.5 w-1.5 bg-red-500 shadow-[inset_0_1px_1px_rgba(255,255,255,0.4)]" />
                            </div>
                            <div className="flex items-baseline gap-1.5">
                                <span className="text-[10px] font-bold text-red-500 uppercase tracking-[0.08em]">Live</span>
                                <span className="text-[11px] font-medium font-mono tabular-nums opacity-60">
                                    {clockDisplay}
                                </span>
                            </div>
                        </div>
                    ) : isFinal ? (
                        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] opacity-50 bg-black/5 px-2 py-0.5 rounded-[5px]">
                            Final
                        </span>
                    ) : (
                        <div className="flex items-baseline gap-1.5">
                            <span className="text-[12px] font-medium font-mono tabular-nums opacity-80 tracking-[-0.01em]">
                                {clockDisplay}
                            </span>
                            <span className="text-[10px] font-medium uppercase tracking-[0.05em] opacity-50">
                                {periodDisplay}
                            </span>
                        </div>
                    )}
                </div>

                {/* Pin (Refined micro-interaction with A11y) */}
                <button
                    type="button"
                    aria-label={isPinned ? "Unpin match" : "Pin match"}
                    onClick={(e) => {
                        e.stopPropagation();
                        onTogglePin(match.id, e);
                    }}
                    className="p-1.5 -mr-1.5 rounded-full transition-colors hover:bg-black/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-black/20"
                    style={{
                        color: isPinned ? ESSENCE.colors.accent.amber : 'rgba(0,0,0,0.15)',
                    }}
                >
                    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill={isPinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                </button>
            </div>

            {/* ── Teams & Scores (Precise Hierarchy) ────────────────────────────── */}
            <div className="px-5 py-3 flex-1 flex flex-col justify-center gap-4 relative z-10">
                {[
                    { team: match.awayTeam, score: awayScore, isWinner: awayWinner, isLoser: homeWinner, prob: awayProb, isFav: !homeFav },
                    { team: match.homeTeam, score: homeScore, isWinner: homeWinner, isLoser: awayWinner, prob: homeProb, isFav: homeFav },
                ].map(({ team, score, isWinner, isLoser, prob, isFav }, idx) => (
                    <div key={team?.id || idx} className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3.5 min-w-0 flex-1">
                            {/* App-icon style bezel around team logos */}
                            <div className="relative shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.04),_inset_0_0_0_1px_rgba(0,0,0,0.03)]">
                                <TeamLogo
                                    logo={team?.logo}
                                    name={team?.name || 'TBA'}
                                    className="w-5 h-5 object-contain"
                                />
                            </div>
                            <div className="min-w-0 flex flex-col pt-0.5">
                                <span
                                    className="text-[15px] tracking-[-0.015em] truncate"
                                    style={{
                                        fontWeight: isLoser ? 500 : 600,
                                        color: ESSENCE.colors.text.primary,
                                        opacity: isLoser ? 0.6 : 1, // Hierarchy via opacity
                                    }}
                                    title={team?.name}
                                >
                                    {team?.name || 'TBA'}
                                </span>
                                {team?.record && (
                                    <span className="text-[11px] font-mono font-medium opacity-40 mt-[1px]">
                                        {team.record}
                                    </span>
                                )}
                            </div>
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                            {hasProb && !isFinal && (
                                <ProbPill value={prob} isFav={isFav} />
                            )}
                            {(isLive || isFinal) && (
                                <span
                                    className="font-mono text-[19px] tabular-nums text-right min-w-[28px]"
                                    style={{
                                        fontWeight: isLoser ? 500 : 600,
                                        letterSpacing: '-0.04em',
                                        color: ESSENCE.colors.text.primary,
                                        opacity: isLoser ? 0.4 : 1,
                                    }}
                                >
                                    {score ?? '-'}
                                </span>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {/* ── Footer: Odds (Whitespace & Subtlety) ──────────────────────────── */}
            {(match.odds?.spread || match.odds?.overUnder) && (
                <div
                    className="px-5 py-3.5 flex items-center justify-between relative z-10 mt-auto"
                    style={{
                        // Invisible hairline divider replacing solid borders
                        boxShadow: 'inset 0 1px 0 0 rgba(0,0,0,0.03)',
                        backgroundColor: 'rgba(0,0,0,0.01)',
                    }}
                >
                    <div className="flex items-center gap-2">
                        <OddsChip label="Spread" value={match.odds?.spread} />
                        <OddsChip label="Total" value={match.odds?.overUnder} />
                    </div>

                    {hasAction && (
                        <div
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-[0.08em]"
                            style={{
                                color: ESSENCE.colors.accent.emerald,
                                backgroundColor: 'rgba(16,185,129,0.08)',
                                boxShadow: 'inset 0 0 0 1px rgba(16,185,129,0.15), inset 0 1px 1px rgba(255,255,255,0.5)',
                            }}
                        >
                            {/* Tiny inner LED dot for the Action badge. Nested div inside div is valid HTML */}
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.5)]" aria-hidden="true" />
                            <span>Action</span>
                        </div>
                    )}
                </div>
            )}

        </div>
    );
});

GameCard.displayName = 'GameCard';

export default GameCard;
