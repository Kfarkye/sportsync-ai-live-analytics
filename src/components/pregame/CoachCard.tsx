import React from 'react';
import { useMatchupCoaches } from '../../hooks/useCoach';
import { Sport } from '../../types';

interface CoachCardProps {
    homeTeamId: string;
    awayTeamId: string;
    homeTeamName: string;
    awayTeamName: string;
    sport: Sport;
}

/**
 * CoachCard - Ground Truth Component
 * Displays coach identity for both teams
 * Simple, clean, factual - no interpretation
 */
const CoachCard: React.FC<CoachCardProps> = ({
    homeTeamId,
    awayTeamId,
    homeTeamName,
    awayTeamName,
    sport
}) => {
    const { data, isLoading } = useMatchupCoaches(homeTeamId, awayTeamId, sport);

    if (isLoading) {
        return (
            <div className="animate-pulse py-3 border-b border-white/[0.04]">
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <div className="h-2.5 w-16 bg-white/[0.04] rounded" />
                        <div className="h-4 w-28 bg-white/[0.06] rounded" />
                    </div>
                    <div className="space-y-2 flex flex-col items-end">
                        <div className="h-2.5 w-16 bg-white/[0.04] rounded" />
                        <div className="h-4 w-28 bg-white/[0.06] rounded" />
                    </div>
                </div>
            </div>
        );
    }

    const { homeCoach, awayCoach } = data || {};

    // Don't render if no coach data
    if (!homeCoach?.coach_name && !awayCoach?.coach_name) {
        return null;
    }

    return (
        <div className="relative py-3 border-b border-white/[0.04]">
            <div className="grid grid-cols-2 gap-4">
                {/* Away Coach */}
                <div className="space-y-0.5">
                    <span className="text-[10px] font-semibold text-zinc-600 uppercase tracking-[0.1em]">
                        {awayTeamName}
                    </span>
                    <h4 className="text-[14px] font-semibold text-white tracking-tight">
                        {awayCoach?.coach_name || '—'}
                    </h4>
                </div>

                {/* Home Coach */}
                <div className="space-y-0.5 text-right">
                    <span className="text-[10px] font-semibold text-zinc-600 uppercase tracking-[0.1em]">
                        {homeTeamName}
                    </span>
                    <h4 className="text-[14px] font-semibold text-white tracking-tight">
                        {homeCoach?.coach_name || '—'}
                    </h4>
                </div>
            </div>
        </div>
    );
};

export default CoachCard;
