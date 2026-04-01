
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
            <div className="text-center py-8 border border-slate-200 rounded-xl bg-slate-50">
                <div className="text-[11px] text-slate-400 italic">No prior meetings on record. First matchup of the season.</div>
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
            <div className="flex items-center justify-between px-4 py-3 bg-white border border-slate-200 rounded-xl">
                <div className="flex items-center gap-2">
                    <Trophy size={14} className="text-amber-500" />
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Series History</span>
                </div>
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-slate-900">{homeTeam.shortName}</span>
                        <span className="text-sm font-mono font-bold text-emerald-600">{homeWins}</span>
                    </div>
                    <span className="text-slate-300 text-xs">-</span>
                    <div className="flex items-center gap-1.5">
                        <span className="text-sm font-mono font-bold text-emerald-600">{awayWins}</span>
                        <span className="text-xs font-bold text-slate-900">{awayTeam.shortName}</span>
                    </div>
                </div>
            </div>

            {/* Matches List */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                {meetings.map((game, i) => {
                    const date = new Date(game.date);
                    const isHomeGame = game.homeTeamId === homeId;

                    // Determine result for the primary home team
                    let resultLabel = 'D';
                    if (game.winnerId === homeId) resultLabel = 'W';
                    else if (game.winnerId === awayId) resultLabel = 'L';

                    return (
                        <div key={i} className="flex items-center justify-between p-3 border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
                            <div className="flex items-center gap-3">
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs border ${resultLabel === 'W' ? 'bg-emerald-50 text-emerald-600 border-emerald-200' :
                                    resultLabel === 'L' ? 'bg-red-50 text-red-500 border-red-200' :
                                        'bg-slate-100 text-slate-400 border-slate-200'
                                    }`}>
                                    {resultLabel}
                                </div>
                                <div className="flex flex-col">
                                    <div className="flex items-center gap-1.5 text-xs text-slate-600">
                                        <span className="font-bold text-slate-400 w-4">{isHomeGame ? 'vs' : '@'}</span>
                                        <span className="font-medium text-slate-900">
                                            {awayTeam.shortName}
                                        </span>
                                    </div>
                                    <span className="text-[10px] text-slate-400">{date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                                </div>
                            </div>

                            <div className="flex items-center gap-2 font-mono text-sm">
                                <span className={game.homeScore > game.awayScore ? 'text-slate-900 font-bold' : 'text-slate-400'}>
                                    {game.homeScore}
                                </span>
                                <span className="text-slate-300">-</span>
                                <span className={game.awayScore > game.homeScore ? 'text-slate-900 font-bold' : 'text-slate-400'}>
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
