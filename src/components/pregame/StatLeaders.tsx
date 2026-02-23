
import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/essence';

interface Athlete {
    id: string;
    fullName: string;
    displayName: string;
    shortName: string;
    headshot?: string;
    position?: { abbreviation: string };
}

interface Leader {
    displayValue: string;
    value: number;
    athlete: Athlete;
    team: { id: string };
}

interface MatchLeader {
    name: string;
    displayName: string;
    leaders: Leader[];
}

interface StatLeadersProps {
    leaders: MatchLeader[];
    homeTeamId: string;
    awayTeamId: string;
}

/**
 * JONY IVE REDUCTION PASS - STAT LEADERS
 * 
 * - Ghost-light backgrounds.
 * - Uniform typography.
 * - Removing the "group shadow" and heavy borders.
 * - Pure data visualization.
 */

const StatLeaders: React.FC<StatLeadersProps> = ({ leaders, homeTeamId, awayTeamId }) => {
    if (!leaders || leaders.length === 0) return null;

    const displayCategories = leaders.slice(0, 3);

    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
            {displayCategories.map((category, idx) => {
                const homeLeader = category.leaders?.find(l => l.team?.id === homeTeamId);
                const awayLeader = category.leaders?.find(l => l.team?.id === awayTeamId);

                return (
                    <div key={idx} className="space-y-8">
                        <div className="flex flex-col items-center">
                            <span className="text-label font-black uppercase tracking-[0.5em] text-white/10 mb-2 truncate max-w-full">{category.displayName}</span>
                        </div>

                        <div className="space-y-8">
                            {/* Away Leader */}
                            {awayLeader && (
                                <div className="flex items-center gap-4 group">
                                    <div className="relative w-10 h-10 rounded-full overflow-hidden bg-black/40 border border-edge-subtle">
                                        {awayLeader.athlete.headshot ? (
                                            <img src={awayLeader.athlete.headshot} alt={awayLeader.athlete.fullName} className="w-full h-full object-cover grayscale transition-opacity duration-700 opacity-40 group-hover:opacity-100" />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center text-caption text-zinc-800 font-bold uppercase">
                                                {(awayLeader.athlete.shortName || awayLeader.athlete.displayName || '').substring(0, 2)}
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-small font-medium text-white/50 truncate group-hover:text-white transition-colors tracking-tight italic uppercase">{awayLeader.athlete.displayName}</div>
                                        <div className="text-[18px] font-medium text-white tabular-nums tracking-tighter mt-1">{awayLeader.displayValue}</div>
                                    </div>
                                </div>
                            )}

                            {/* Home Leader */}
                            {homeLeader && (
                                <div className="flex items-center gap-4 group flex-row-reverse text-right">
                                    <div className="relative w-10 h-10 rounded-full overflow-hidden bg-black/40 border border-edge-subtle">
                                        {homeLeader.athlete.headshot ? (
                                            <img src={homeLeader.athlete.headshot} alt={homeLeader.athlete.fullName} className="w-full h-full object-cover grayscale transition-opacity duration-700 opacity-40 group-hover:opacity-100" />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center text-caption text-zinc-800 font-bold uppercase">
                                                {(homeLeader.athlete.shortName || homeLeader.athlete.displayName || '').substring(0, 2)}
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-small font-medium text-white/50 truncate group-hover:text-white transition-colors tracking-tight italic uppercase">{homeLeader.athlete.displayName}</div>
                                        <div className="text-[18px] font-medium text-white tabular-nums tracking-tighter mt-1">{homeLeader.displayValue}</div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

export default StatLeaders;
