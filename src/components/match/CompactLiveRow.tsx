
import React, { useMemo } from 'react';
import { Match, MatchStatus } from '@/types';
import { analyzeSpread, analyzeTotal } from '../../utils/oddsUtils';

interface CompactLiveRowProps {
    match: Match;
    onClick: () => void;
}

const CompactLiveRow: React.FC<CompactLiveRowProps> = ({ match, onClick }) => {
    // --- STATUS LOGIC ---
    const isFinal = match.status === MatchStatus.FINISHED ||
        (match.status as string) === 'STATUS_FINAL' ||
        (match.status as string) === 'FINAL' ||
        (match.status as string) === 'STATUS_FINAL_OT';

    const isScheduled = match.status === MatchStatus.SCHEDULED ||
        (match.status as string) === 'STATUS_SCHEDULED' ||
        (match.status as string) === 'SCHEDULED';

    const isLive = !isFinal && !isScheduled;

    // --- ODDS ANALYSIS ---
    const spreadData = useMemo(() => analyzeSpread(match), [match]);
    const totalData = useMemo(() => analyzeTotal(match), [match]);

    // Total logic
    const totalDisplay = totalData.line !== null ? totalData.displayLine : '-';

    // --- CLOCK / TIME LOGIC ---
    let clockDisplay = match.displayClock || match.minute || '00:00';
    let periodText = '';

    if (isScheduled) {
        clockDisplay = new Date(match.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } else if (isFinal) {
        clockDisplay = 'Final';
    } else {
        const period = match.period || 0;
        const isOvertime = period > 4;
        periodText = isOvertime
            ? (period === 5 ? 'OT' : `${period - 4}OT`)
            : `Q${period}`;
    }

    // --- TEAMS ---
    const awayAbbr = (match.awayTeam.abbreviation || match.awayTeam.shortName || match.awayTeam.name || "").slice(0, 3).toUpperCase();
    const homeAbbr = (match.homeTeam.abbreviation || match.homeTeam.shortName || match.homeTeam.name || "").slice(0, 3).toUpperCase();

    // --- STYLES ---
    // Minimalist color palette
    const activeColor = isLive ? 'text-rose-500' : 'text-emerald-500';
    const textColor = isLive ? 'text-slate-900' : 'text-slate-500';

    return (
        <div
            onClick={onClick}
            className="group relative w-full px-4 py-3 bg-white/40 hover:bg-slate-50 transition-colors cursor-pointer border-b border-slate-200"
        >
            <div className="flex items-center justify-between font-mono text-xs tracking-tight">

                {/* Status Column */}
                <div className="flex items-center w-16 text-[10px] font-medium opacity-60">
                    <span className={isLive ? 'text-rose-500' : isScheduled ? 'text-slate-500' : 'text-slate-500'}>
                        {isLive && <span className="mr-1.5 inline-block w-1 h-1 bg-current rounded-full" />}
                        {clockDisplay}
                    </span>
                    {isLive && <span className="ml-1 text-slate-500">{periodText}</span>}
                </div>

                {/* Matchup */}
                <div className="flex items-center gap-4 flex-1 justify-center">
                    <span className={`font-semibold ${awayAbbr ? 'text-slate-600' : 'text-slate-500'}`}>{awayAbbr}</span>

                    <div className="flex items-center gap-2 min-w-[60px] justify-center">
                        {isScheduled ? (
                            <span className="text-slate-400 text-[10px]">vs</span>
                        ) : (
                            <>
                                <span className={`font-medium ${textColor}`}>{match.awayScore}</span>
                                <span className="text-slate-300 text-[10px]">:</span>
                                <span className={`font-medium ${textColor}`}>{match.homeScore}</span>
                            </>
                        )}
                    </div>

                    <span className={`font-semibold ${homeAbbr ? 'text-slate-600' : 'text-slate-500'}`}>{homeAbbr}</span>
                </div>

                {/* Odds / Result */}
                <div className="flex items-center justify-end w-20 text-right opacity-80">
                    {isFinal && spreadData.result ? (
                        <span className={`font-medium ${spreadData.result === 'won' ? 'text-emerald-500' :
                            spreadData.result === 'push' ? 'text-slate-500' : 'text-rose-500'
                            }`}>
                            {spreadData.display}
                        </span>
                    ) : (
                        <div className="flex flex-col items-end gap-0.5">
                            <span className="text-slate-400 group-hover:text-slate-700 transition-colors">
                                {spreadData.display}
                            </span>
                        </div>
                    )}
                </div>

            </div>
        </div>
    );
};

export default CompactLiveRow;
