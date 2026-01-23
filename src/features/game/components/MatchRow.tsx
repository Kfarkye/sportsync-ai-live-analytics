
import React from 'react';
import { Match } from '../../../types';
import { analyzeSpread } from '../../betting/logic/odds';
import { cn } from '../../../lib/essence';
import TeamLogo from '../../../components/shared/TeamLogo';

export const MatchRowFeature = ({ match }: { match: Match }) => {
    const spread = analyzeSpread(match);
    return (
        <div className="flex items-center justify-between p-3 border-b border-white/5 hover:bg-white/[0.02]">
            <div className="flex items-center gap-4">
                <span className="text-xs text-zinc-500 font-mono w-12">{match.displayClock || '00:00'}</span>
                <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                        <TeamLogo logo={match.awayTeam.logo} className="w-5 h-5" />
                        <span className="text-sm font-medium text-zinc-200">{match.awayTeam.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <TeamLogo logo={match.homeTeam.logo} className="w-5 h-5" />
                        <span className="text-sm font-medium text-zinc-200">{match.homeTeam.name}</span>
                    </div>
                </div>
            </div>
            <div className="text-right">
                <span className={cn("text-xs font-mono font-bold", spread.isHomeFav ? "text-white" : "text-zinc-500")}>
                    {spread.display}
                </span>
            </div>
        </div>
    );
};
