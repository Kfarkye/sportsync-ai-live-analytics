
import React from 'react';
import { motion } from 'framer-motion';
import { Match } from '@/types';
import { cn, ESSENCE } from '@/lib/essence';
import { CardHeader } from '../ui/SectionHeader';

/**
 * Win Probability Widget
 * Displays ESPN-style win probability predictions
 * 
 * UNIFIED with ESSENCE v10 design tokens
 */
export const PredictorWidget: React.FC<{ match: Match }> = React.memo(({ match }) => {
    const predictor = match.predictor;
    if (!predictor) return null;

    const finishedStatuses = ['STATUS_FINAL', 'STATUS_FINAL_OT', 'STATUS_FINAL_SO', 'STATUS_FULL_TIME', 'FINAL', 'FINISHED', 'FT', 'AET', 'PK'];
    const isFinal = finishedStatuses.includes(match.status as string);
    let homeChance = typeof predictor.homeTeamChance === 'number' ? predictor.homeTeamChance : 0;
    let awayChance = typeof predictor.awayTeamChance === 'number' ? predictor.awayTeamChance : 0;

    if (isFinal && (match.homeScore !== undefined && match.awayScore !== undefined)) {
        homeChance = match.homeScore > match.awayScore ? 100 : (match.awayScore > match.homeScore ? 0 : 50);
        awayChance = 100 - homeChance;
    }

    const homeName = match.homeTeam?.abbreviation || match.homeTeam?.shortName || 'HOME';
    const awayName = match.awayTeam?.abbreviation || match.awayTeam?.shortName || 'AWAY';

    return (
        <div className={ESSENCE.card.base}>
            <CardHeader title="Win Projection" />

            <div className="flex items-end justify-between mb-5">
                <div className="flex flex-col">
                    <span className={ESSENCE.tier.t3Meta + " mb-1"}>{awayName}</span>
                    <span className={ESSENCE.tier.t1Project}>{awayChance.toFixed(1)}%</span>
                </div>
                <div className="flex flex-col items-end">
                    <span className={ESSENCE.tier.t3Meta + " mb-1"}>{homeName}</span>
                    <span className={ESSENCE.tier.t1Project}>{homeChance.toFixed(1)}%</span>
                </div>
            </div>

            {/* Probability Bar */}
            <div className="h-2 w-full bg-overlay-dim rounded-full overflow-hidden flex">
                <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${awayChance}%` }}
                    transition={{ duration: 0.8, ease: [0.32, 0.72, 0, 1] }}
                    className="h-full"
                    style={{ backgroundColor: match.awayTeam?.color || '#EF4444' }}
                />
                <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${homeChance}%` }}
                    transition={{ duration: 0.8, ease: [0.32, 0.72, 0, 1] }}
                    className="h-full"
                    style={{ backgroundColor: match.homeTeam?.color || '#3B82F6' }}
                />
            </div>

            {/* Spread */}
            {(predictor.awayTeamLine || predictor.homeTeamLine) && (
                <div className="mt-5 pt-4 border-t border-edge-subtle grid grid-cols-2 gap-3">
                    <div className="p-3 rounded-xl bg-overlay-subtle">
                        <span className={cn(ESSENCE.tier.t2Header, "block mb-1")}>Spread</span>
                        <span className={ESSENCE.tier.t1Value}>{predictor.awayTeamLine || '—'}</span>
                    </div>
                    <div className="p-3 rounded-xl bg-overlay-subtle">
                        <span className={cn(ESSENCE.tier.t2Header, "block mb-1")}>Spread</span>
                        <span className={ESSENCE.tier.t1Value}>{predictor.homeTeamLine || '—'}</span>
                    </div>
                </div>
            )}
        </div>
    );
});

PredictorWidget.displayName = 'PredictorWidget';

