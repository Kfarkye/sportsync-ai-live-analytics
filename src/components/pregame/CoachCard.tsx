import React from 'react';
import { useMatchupCoaches } from '../../hooks/useCoach';
import { Sport } from '@/types';

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
            <div className="animate-pulse py-3 border-b border-edge-subtle">
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <div className="h-2.5 w-16 bg-overlay-muted rounded" />
                        <div className="h-4 w-28 bg-overlay-emphasis rounded" />
                    </div>
                    <div className="space-y-2 flex flex-col items-end">
                        <div className="h-2.5 w-16 bg-overlay-muted rounded" />
                        <div className="h-4 w-28 bg-overlay-emphasis rounded" />
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
        <div className="relative py-3 border-b border-edge-subtle">
            <div className="grid grid-cols-2 gap-4">
                {/* Away Coach */}
                <div className="space-y-0.5">
                    <span className="text-caption font-semibold text-zinc-600 uppercase tracking-expanded">
                        {awayTeamName}
                    </span>
                    <h4 className="text-body font-semibold text-white tracking-tight">
                        {awayCoach?.coach_name || '—'}
                    </h4>
                </div>

                {/* Home Coach */}
                <div className="space-y-0.5 text-right">
                    <span className="text-caption font-semibold text-zinc-600 uppercase tracking-expanded">
                        {homeTeamName}
                    </span>
                    <h4 className="text-body font-semibold text-white tracking-tight">
                        {homeCoach?.coach_name || '—'}
                    </h4>
                </div>
            </div>
        </div>
    );
};

export default CoachCard;
