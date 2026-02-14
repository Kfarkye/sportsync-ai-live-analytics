import React, { useMemo } from 'react';
import { Match, Sport } from '@/types';
import MatchRow from './MatchRow';
import TeamLogo from '../shared/TeamLogo';
import { cn, ESSENCE } from '@/lib/essence';
import { motion } from 'framer-motion';
import { getLeagueDisplayName } from '@/constants';
import { analyzeSpread, analyzeMoneyline } from '../../utils/oddsUtils';

const MotionDiv = motion.div;

/**
 * ────────────────────────────────────────────────────────────────────────────
 * MATCH CARD — Obsidian Weissach
 * All surface colors flow from ESSENCE tokens.
 * ────────────────────────────────────────────────────────────────────────────
 */

const COLORS = {
    white: ESSENCE.colors.text.primary,
    muted: ESSENCE.colors.text.tertiary,
    dim: ESSENCE.colors.text.muted,
    live: '#FF3B30',
    pinned: '#FF9F0A',
    card: ESSENCE.colors.surface.card,
} as const;

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

const MatchCard: React.FC<MatchCardProps> = ({
    match,
    viewMode,
    isPinned,
    isLive,
    isFinal,
    onSelect,
    onTogglePin
}) => {
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

    // Derive winner/loser state (handles ties gracefully)
    const homeWinner = isFinal && match.homeScore > match.awayScore;
    const awayWinner = isFinal && match.awayScore > match.homeScore;
    const isTie = isFinal && match.homeScore === match.awayScore;
    const homeLost = isFinal && !homeWinner && !isTie;
    const awayLost = isFinal && !awayWinner && !isTie;

    const clockDisplay = match.displayClock || match.minute || '';

    // Period label: H for Soccer/NCAAB (halves), P for Hockey (periods), Q for others (quarters)
    const getPeriodLabel = () => {
        if (!match.period) return '';
        if (match.sport === Sport.SOCCER || match.sport === Sport.COLLEGE_BASKETBALL) return `H${match.period}`;
        if (match.sport === Sport.HOCKEY) return `P${match.period}`;
        return `Q${match.period}`;
    };
    const periodLabel = getPeriodLabel();

    const showScores = isLive || isFinal;
    const isScheduled = !isLive && !isFinal;

    // Get proper league display name
    const leagueName = getLeagueDisplayName(match.leagueId);

    // Analyze pregame lines for scheduled games
    const odds = useMemo(() => {
        if (!isScheduled) return null;
        const spread = analyzeSpread(match);
        const ml = analyzeMoneyline(match);
        return { spread, ml };
    }, [match, isScheduled]);

    // Format pregame line display (show spread if available, else ML)
    const getPregameLine = (isHome: boolean) => {
        if (!odds) return null;

        // Try spread first (use display which is already formatted)
        if (odds.spread.line !== null || odds.spread.awayLine !== null) {
            const spreadDisplay = isHome ? odds.spread.display : odds.spread.awayDisplay;
            if (spreadDisplay && spreadDisplay !== '-') {
                return spreadDisplay;
            }
        }

        // Fall back to moneyline
        const mlVal = isHome ? odds.ml.home : odds.ml.away;
        if (mlVal && mlVal !== '-') {
            return mlVal;
        }

        return null;
    };

    const awayLine = getPregameLine(false);
    const homeLine = getPregameLine(true);

    return (
        <MotionDiv
            onClick={onSelect}
            whileTap={{ scale: 0.985 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            className={cn(
                "relative cursor-pointer overflow-hidden",
                ESSENCE.card.radius,
                ESSENCE.card.border,
                isLive && "ring-1 ring-[#FF3B30]/20"
            )}
            style={{
                backgroundColor: COLORS.card,
                boxShadow: ESSENCE.shadows.obsidian,
            }}
        >
            {/* Obsidian Specular Edge Light */}
            <div
                className={cn("absolute top-0 left-0 right-0 h-px z-20", isLive && "animate-[breathe_3.5s_ease-in-out_infinite]")}
                style={{
                    background: `linear-gradient(90deg, transparent, ${ESSENCE.colors.accent.mintEdge} 30%, ${ESSENCE.colors.accent.mintEdge} 70%, transparent)`,
                    opacity: isLive ? undefined : 0.65,
                }}
            />
            <div className="p-5">
                {/* Status Row */}
                <div className="flex items-center justify-between mb-5">
                    {isLive ? (
                        <div className="flex items-center gap-2">
                            <motion.span
                                animate={{ opacity: [1, 0.35, 1] }}
                                transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                                className="w-1.5 h-1.5 rounded-full"
                                style={{ backgroundColor: COLORS.live }}
                            />
                            <span
                                className="text-[11px] font-bold uppercase tracking-wide"
                                style={{ color: COLORS.live }}
                            >
                                {clockDisplay} {periodLabel}
                            </span>
                        </div>
                    ) : (
                        <span
                            className="text-[11px] font-black uppercase tracking-[0.2em] tabular-nums"
                            style={{ color: isFinal ? COLORS.dim : COLORS.muted }}
                        >
                            {isFinal ? 'FINAL' : new Date(match.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M/, '')}
                        </span>
                    )}

                    {!isFinal && (
                        <span
                            className="text-[10px] font-medium uppercase tracking-widest"
                            style={{ color: COLORS.dim }}
                        >
                            {leagueName}
                        </span>
                    )}
                </div>

                {/* Teams */}
                <div className="space-y-3">
                    {/* Away Team */}
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                            <TeamLogo logo={match.awayTeam.logo} name={match.awayTeam.name} className="w-7 h-7 flex-shrink-0" />
                            <div className="min-w-0">
                                <span
                                    className={cn("block text-[15px] truncate", awayWinner ? "font-bold" : awayLost ? "font-normal" : "font-semibold")}
                                    style={{ color: awayWinner ? COLORS.white : awayLost ? COLORS.muted : COLORS.white }}
                                >
                                    {match.awayTeam.name}
                                </span>
                                {match.awayTeam.record && (
                                    <span className="block text-[11px] mt-0.5" style={{ color: COLORS.dim }}>
                                        {match.awayTeam.record}
                                    </span>
                                )}
                            </div>
                        </div>

                        <span
                            className={cn("text-[24px] tabular-nums min-w-[40px] text-right", awayWinner ? "font-bold" : "font-normal")}
                            style={{ color: showScores ? (awayWinner ? COLORS.white : COLORS.muted) : COLORS.dim }}
                        >
                            {showScores ? match.awayScore : (awayLine || '–')}
                        </span>
                    </div>

                    {/* Home Team */}
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                            <TeamLogo logo={match.homeTeam.logo} name={match.homeTeam.name} className="w-7 h-7 flex-shrink-0" />
                            <div className="min-w-0">
                                <span
                                    className={cn("block text-[15px] truncate", homeWinner ? "font-bold" : homeLost ? "font-normal" : "font-semibold")}
                                    style={{ color: homeWinner ? COLORS.white : homeLost ? COLORS.muted : COLORS.white }}
                                >
                                    {match.homeTeam.name}
                                </span>
                                {match.homeTeam.record && (
                                    <span className="block text-[11px] mt-0.5" style={{ color: COLORS.dim }}>
                                        {match.homeTeam.record}
                                    </span>
                                )}
                            </div>
                        </div>

                        <span
                            className={cn("text-[24px] tabular-nums min-w-[40px] text-right", homeWinner ? "font-bold" : "font-normal")}
                            style={{ color: showScores ? (homeWinner ? COLORS.white : COLORS.muted) : COLORS.dim }}
                        >
                            {showScores ? match.homeScore : (homeLine || '–')}
                        </span>
                    </div>
                </div>
            </div>

            {/* Pinned Indicator */}
            {isPinned && (
                <div
                    className="absolute top-3 right-3 w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: COLORS.pinned }}
                />
            )}
        </MotionDiv>
    );
};

export default MatchCard;
