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
 * MATCH CARD — Editorial Light
 * Clean white cards with crisp slate-200 borders on slate-50 canvas.
 * ────────────────────────────────────────────────────────────────────────────
 */

const COLORS = {
    primary: '#0F172A',    // slate-900 — scores, team names
    secondary: '#64748B',  // slate-500 — records, dates, labels
    muted: '#94A3B8',      // slate-400 — disabled, dim
    live: '#DC2626',       // red-600
    pinned: '#F59E0B',     // amber-500
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

    const homeWinner = isFinal && match.homeScore > match.awayScore;
    const awayWinner = isFinal && match.awayScore > match.homeScore;
    const isTie = isFinal && match.homeScore === match.awayScore;
    const homeLost = isFinal && !homeWinner && !isTie;
    const awayLost = isFinal && !awayWinner && !isTie;

    const clockDisplay = match.displayClock || match.minute || '';

    const getPeriodLabel = () => {
        if (!match.period) return '';
        if (match.sport === Sport.SOCCER || match.sport === Sport.COLLEGE_BASKETBALL) return `H${match.period}`;
        if (match.sport === Sport.HOCKEY) return `P${match.period}`;
        return `Q${match.period}`;
    };
    const periodLabel = getPeriodLabel();

    const showScores = isLive || isFinal;
    const isScheduled = !isLive && !isFinal;

    const leagueName = getLeagueDisplayName(match.leagueId);

    const odds = useMemo(() => {
        if (!isScheduled) return null;
        const spread = analyzeSpread(match);
        const ml = analyzeMoneyline(match);
        return { spread, ml };
    }, [match, isScheduled]);

    const getPregameLine = (isHome: boolean) => {
        if (!odds) return null;

        if (odds.spread.line !== null || odds.spread.awayLine !== null) {
            const spreadDisplay = isHome ? odds.spread.display : odds.spread.awayDisplay;
            if (spreadDisplay && spreadDisplay !== '-') {
                return spreadDisplay;
            }
        }

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
                "relative cursor-pointer overflow-hidden bg-white rounded-2xl border border-slate-200",
                isLive && "ring-1 ring-red-200"
            )}
        >
            <div className="p-5">
                {/* Status Row */}
                <div className="flex items-center justify-between mb-5">
                    {isLive ? (
                        <div className="flex items-center gap-2">
                            <motion.span
                                animate={{ opacity: [1, 0.35, 1] }}
                                transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                                className="w-1.5 h-1.5 rounded-full bg-red-600"
                            />
                            <span className="text-[11px] font-bold uppercase tracking-wide text-red-600">
                                {clockDisplay} {periodLabel}
                            </span>
                        </div>
                    ) : (
                        <span
                            className="text-[11px] font-black uppercase tracking-[0.2em] tabular-nums"
                            style={{ color: isFinal ? COLORS.muted : COLORS.secondary }}
                        >
                            {isFinal ? 'FINAL' : new Date(match.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M/, '')}
                        </span>
                    )}

                    {!isFinal && (
                        <span className="text-[10px] font-medium uppercase tracking-widest text-slate-400">
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
                                    style={{ color: awayWinner ? COLORS.primary : awayLost ? COLORS.muted : COLORS.primary }}
                                >
                                    {match.awayTeam.name}
                                </span>
                                {match.awayTeam.record && (
                                    <span className="block text-[11px] mt-0.5 text-slate-500 font-medium">
                                        {match.awayTeam.record}
                                    </span>
                                )}
                            </div>
                        </div>

                        <span
                            className={cn("text-[24px] tabular-nums min-w-[40px] text-right", awayWinner ? "font-bold" : "font-normal")}
                            style={{ color: showScores ? (awayWinner ? COLORS.primary : COLORS.muted) : COLORS.secondary }}
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
                                    style={{ color: homeWinner ? COLORS.primary : homeLost ? COLORS.muted : COLORS.primary }}
                                >
                                    {match.homeTeam.name}
                                </span>
                                {match.homeTeam.record && (
                                    <span className="block text-[11px] mt-0.5 text-slate-500 font-medium">
                                        {match.homeTeam.record}
                                    </span>
                                )}
                            </div>
                        </div>

                        <span
                            className={cn("text-[24px] tabular-nums min-w-[40px] text-right", homeWinner ? "font-bold" : "font-normal")}
                            style={{ color: showScores ? (homeWinner ? COLORS.primary : COLORS.muted) : COLORS.secondary }}
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
