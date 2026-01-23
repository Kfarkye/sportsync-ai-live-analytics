
import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Match, MatchStatus } from '../../../types';
import TeamLogo from '../../../components/shared/TeamLogo';
import { Star, Clock } from 'lucide-react';
import { cn, ESSENCE } from '../../../lib/essence';
import { analyzeSpread, analyzeTotal } from '../../betting/logic/odds';
import { OddsCell } from '../../betting/components/OddsCell';

const MotionDiv = motion.div as any;

interface MatchCardProps {
    match: Match;
    isPinned: boolean;
    onSelect: () => void;
    onTogglePin: (e: React.MouseEvent) => void;
}

export const MatchCard = ({ match, isPinned, onSelect, onTogglePin }: MatchCardProps) => {
    const isLive = [MatchStatus.LIVE, 'LIVE', 'IN_PROGRESS'].includes(match.status as any);
    const isFinal = [MatchStatus.FINISHED, 'FINAL', 'STATUS_FINAL'].includes(match.status as any);

    const spread = useMemo(() => analyzeSpread(match), [match]);
    const total = useMemo(() => analyzeTotal(match), [match]);

    return (
        <MotionDiv
            onClick={onSelect}
            whileHover={{ y: -4, boxShadow: ESSENCE.shadows.lg }}
            transition={ESSENCE.transition.spring}
            className="group relative bg-[#09090B] rounded-[20px] overflow-hidden cursor-pointer border border-white/[0.06]"
        >
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.04] bg-[#0C0C0E]">
                <div className="flex items-center gap-2">
                    {isLive ? (
                        <span className="flex items-center gap-1.5 text-[10px] font-bold text-rose-500 uppercase tracking-widest">
                            <span className="relative flex h-1.5 w-1.5">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-rose-500"></span>
                            </span>
                            {match.displayClock}
                        </span>
                    ) : (
                        <span className="text-[10px] font-medium text-zinc-500 flex items-center gap-1">
                            <Clock size={10} />
                            {isFinal ? 'FINAL' : new Date(match.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                        </span>
                    )}
                </div>
                <button onClick={(e) => { e.stopPropagation(); onTogglePin(e); }} className="text-zinc-600 hover:text-amber-400 transition-colors">
                    <Star size={14} fill={isPinned ? "currentColor" : "none"} />
                </button>
            </div>

            <div className="p-4 space-y-4">
                <div className="space-y-3">
                    <div className="flex justify-between items-center">
                        <div className="flex items-center gap-3">
                            <TeamLogo logo={match.awayTeam.logo} className="w-8 h-8" />
                            <span className={cn("text-sm font-semibold", match.awayScore > match.homeScore ? "text-white" : "text-zinc-400")}>
                                {match.awayTeam.name}
                            </span>
                        </div>
                        <span className="text-xl font-mono font-bold text-white">{match.awayScore}</span>
                    </div>
                    <div className="flex justify-between items-center">
                        <div className="flex items-center gap-3">
                            <TeamLogo logo={match.homeTeam.logo} className="w-8 h-8" />
                            <span className={cn("text-sm font-semibold", match.homeScore > match.awayScore ? "text-white" : "text-zinc-400")}>
                                {match.homeTeam.name}
                            </span>
                        </div>
                        <span className="text-xl font-mono font-bold text-white">{match.homeScore}</span>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2">
                    <OddsCell
                        label="Spread"
                        value={spread.display}
                        result={spread.result}
                        isLive={isLive}
                    />
                    <OddsCell
                        label="Total"
                        value={`O/U ${total.display}`}
                        result={total.result === 'OVER' || total.result === 'UNDER' ? 'won' : null}
                        isLive={isLive}
                    />
                </div>
            </div>
        </MotionDiv>
    );
};
