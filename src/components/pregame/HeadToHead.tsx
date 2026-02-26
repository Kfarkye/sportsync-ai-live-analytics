
import React from 'react';
import { Team } from '@/types';
import { Trophy } from 'lucide-react';

interface Meeting {
    date: string;
    homeScore: number;
    awayScore: number;
    homeTeamId: string;
    awayTeamId: string;
    winnerId: string;
}

interface HeadToHeadProps {
    meetings: Meeting[];
    homeId: string;
    awayId: string;
    homeTeam: Team;
    awayTeam: Team;
}

const HeadToHead: React.FC<HeadToHeadProps> = ({ meetings, homeId, awayId, homeTeam, awayTeam }) => {
    if (!meetings || meetings.length === 0) {
        return (
            <div className="text-center py-8 border border-white/5 rounded-xl bg-white/[0.02]">
                <div className="text-[11px] text-white/40 italic">No prior meetings on record. First matchup of the season.</div>
            </div>
        );
    }

    // Calculate Head to Head Record
    let homeWins = 0;
    let awayWins = 0;

    meetings.forEach(m => {
        if (m.winnerId === homeId) homeWins++;
        if (m.winnerId === awayId) awayWins++;
    });

    return (
        <div className="space-y-4">
            {/* Record Summary */}
            <div className="flex items-center justify-between px-4 py-3 bg-[#111113] border border-white/10 rounded-xl">
                <div className="flex items-center gap-2">
                    <Trophy size={14} className="text-amber-400" />
                    <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Series History</span>
                </div>
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-white">{homeTeam.shortName}</span>
                        <span className="text-sm font-mono font-bold text-emerald-400">{homeWins}</span>
                    </div>
                    <span className="text-zinc-600 text-xs">-</span>
                    <div className="flex items-center gap-1.5">
                        <span className="text-sm font-mono font-bold text-emerald-400">{awayWins}</span>
                        <span className="text-xs font-bold text-white">{awayTeam.shortName}</span>
                    </div>
                </div>
            </div>

            {/* Matches List */}
            <div className="bg-[#09090B] border border-white/[0.08] rounded-xl overflow-hidden">
                {meetings.map((game, i) => {
                    const date = new Date(game.date);
                    const isHomeGame = game.homeTeamId === homeId;

                    // Determine result for the primary home team
                    let resultLabel = 'D';
                    if (game.winnerId === homeId) resultLabel = 'W';
                    else if (game.winnerId === awayId) resultLabel = 'L';

                    return (
                        <div key={i} className="flex items-center justify-between p-3 border-b border-white/[0.06] last:border-0 hover:bg-white/[0.02] transition-colors">
                            <div className="flex items-center gap-3">
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs border ${resultLabel === 'W' ? 'bg-[#53D337]/10 text-[#53D337] border-[#53D337]/20' :
                                        resultLabel === 'L' ? 'bg-red-500/10 text-red-500 border-red-500/20' :
                                            'bg-zinc-800 text-zinc-400 border-zinc-700'
                                    }`}>
                                    {resultLabel}
                                </div>
                                <div className="flex flex-col">
                                    <div className="flex items-center gap-1.5 text-xs text-zinc-300">
                                        <span className="font-bold text-zinc-500 w-4">{isHomeGame ? 'vs' : '@'}</span>
                                        <span className="font-medium text-white">
                                            {awayTeam.shortName}
                                        </span>
                                    </div>
                                    <span className="text-[10px] text-zinc-500">{date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                                </div>
                            </div>

                            <div className="flex items-center gap-2 font-mono text-sm">
                                <span className={game.homeScore > game.awayScore ? 'text-white font-bold' : 'text-zinc-500'}>
                                    {game.homeScore}
                                </span>
                                <span className="text-zinc-600">-</span>
                                <span className={game.awayScore > game.homeScore ? 'text-white font-bold' : 'text-zinc-500'}>
                                    {game.awayScore}
                                </span>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default HeadToHead;
