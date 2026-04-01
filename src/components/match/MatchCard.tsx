import React, { useMemo } from 'react';
import { Match, Sport } from '@/types';
import MatchRow from './MatchRow';
import TeamLogo from '../shared/TeamLogo';
import { cn } from '@/lib/essence';
import { getLeagueDisplayName } from '@/constants';
import { getPeriodDisplay } from '@/utils/matchUtils';
import { motion } from 'framer-motion';

const MotionDiv = motion.div;

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

// ─── Helpers ────────────────────────────────────────────────────────────────

const formatML = (value: unknown): string => {
    if (value == null) return '';
    const n = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.+-]/g, ''));
    if (!Number.isFinite(n)) return '';
    if (n === 0) return 'EV';
    return n > 0 ? `+${Math.round(n)}` : `${Math.round(n)}`;
};

// ═════════════════════════════════════════════════════════════════════════════
// MATCH CARD — ESPN-Quality Grid Card
// ═════════════════════════════════════════════════════════════════════════════

const MatchCard: React.FC<MatchCardProps> = ({
    match, viewMode, isPinned, isLive, isFinal, onSelect, onTogglePin,
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

    // ── GRID VIEW ───────────────────────────────────────────────────────────
    const showScores = isLive || isFinal;
    const league = getLeagueDisplayName(match.leagueId);
    const isBaseball = match.sport === Sport.BASEBALL || match.leagueId === 'mlb';
    const clockDisplay = isBaseball ? '' : (match.displayClock || match.minute || '');
    const periodLabel = (() => {
        if (isBaseball) return getPeriodDisplay(match as any) || 'LIVE';
        if (!match.period) return '';
        if (match.sport === Sport.SOCCER) return `H${match.period}`;
        if (match.sport === Sport.HOCKEY) return `P${match.period}`;
        return `Q${match.period}`;
    })();

    const homeML = match.odds?.moneylineHome ?? match.odds?.homeML ?? match.odds?.homeWin ?? match.odds?.home_ml;
    const awayML = match.odds?.moneylineAway ?? match.odds?.awayML ?? match.odds?.awayWin ?? match.odds?.away_ml;

    const startTimeStr = useMemo(() => {
        try {
            return new Date(match.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        } catch { return 'TBD'; }
    }, [match.startTime]);

    const teams = [
        { team: match.awayTeam, score: match.awayScore, ml: awayML, other: match.homeScore },
        { team: match.homeTeam, score: match.homeScore, ml: homeML, other: match.awayScore },
    ];

    return (
        <MotionDiv
            onClick={onSelect}
            whileTap={{ scale: 0.985 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            className={cn(
                'relative cursor-pointer bg-white rounded-lg p-4 select-none',
                'transition-colors duration-150 hover:bg-[#F5F4F0]',
            )}
        >
            {/* Status */}
            <div className="flex items-center justify-between mb-4">
                {isLive ? (
                    <div className="flex items-center gap-1.5">
                        <span className="inline-flex h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                        <span className="text-[11px] font-mono font-bold text-red-600 uppercase tracking-wide">
                            {[periodLabel, clockDisplay].filter(Boolean).join(' ') || 'LIVE'}
                        </span>
                    </div>
                ) : isFinal ? (
                    <span className="text-[11px] font-mono font-semibold text-[#9B9B91] uppercase tracking-wide">Final</span>
                ) : (
                    <span className="text-[11px] font-mono font-semibold text-[#9B9B91] tabular-nums" suppressHydrationWarning>
                        {startTimeStr}
                    </span>
                )}
                <span className="text-[10px] text-[#9B9B91] font-medium">{league}</span>
            </div>

            {/* Teams */}
            <div className="flex flex-col gap-3">
                {teams.map(({ team, score, ml, other }, idx) => {
                    if (!team) return null;
                    const nS = Number(score), nO = Number(other);
                    const valid = score != null && other != null && !isNaN(nS) && !isNaN(nO);
                    const lost = isFinal && valid && nS < nO;

                    return (
                        <div key={team.id || idx} className="flex items-center gap-3">
                            <TeamLogo logo={team.logo} name={team.name} className="w-7 h-7 shrink-0 object-contain" />
                            <div className="flex-1 min-w-0">
                                <span className={cn(
                                    'block text-[14px] truncate',
                                    lost ? 'text-[#9B9B91] font-normal' : 'text-[#1A1A18] font-semibold'
                                )}>
                                    {team.name}
                                </span>
                                {team.record && (
                                    <span className="block text-[11px] font-mono text-[#9B9B91] mt-0.5">
                                        {team.record}
                                    </span>
                                )}
                            </div>
                            <span className={cn(
                                'font-mono tabular-nums shrink-0',
                                showScores
                                    ? cn('text-[20px]', lost ? 'text-[#9B9B91] font-semibold' : 'text-[#1A1A18] font-bold')
                                    : 'text-[14px] font-bold text-[#1A1A18]'
                            )}>
                                {showScores ? (score ?? '-') : formatML(ml)}
                            </span>
                        </div>
                    );
                })}
            </div>

            {/* Pinned indicator */}
            {isPinned && (
                <div className="absolute top-3 right-3 w-1.5 h-1.5 rounded-full bg-[#C85A3A]" />
            )}
        </MotionDiv>
    );
};

export default MatchCard;
