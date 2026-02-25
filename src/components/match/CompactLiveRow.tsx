
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
    // Minimalist color palette (theme-aware)
    const activeColor = isLive ? 'text-rose-500' : 'text-emerald-500';
    const textColor = isLive ? 'text-ink-primary' : 'text-ink-tertiary';

    return (
        <div
            onClick={onClick}
            className="group relative w-full px-4 py-3 bg-surface-card hover:bg-overlay-subtle transition-colors cursor-pointer border-b border-edge-subtle"
        >
            <div className="flex items-center justify-between font-mono text-xs tracking-tight">

                {/* Status Column */}
                <div className="flex items-center w-16 text-caption font-medium opacity-60">
                    <span className={isLive ? 'text-rose-500' : isScheduled ? 'text-ink-tertiary' : 'text-ink-muted'}>
                        {isLive && <span className="mr-1.5 inline-block w-1 h-1 bg-current rounded-full" />}
                        {clockDisplay}
                    </span>
                    {isLive && <span className="ml-1 text-ink-muted">{periodText}</span>}
                </div>

                {/* Matchup */}
                <div className="flex items-center gap-4 flex-1 justify-center">
                    <span className={`font-semibold ${awayAbbr ? 'text-ink-primary' : 'text-ink-tertiary'}`}>{awayAbbr}</span>

                    <div className="flex items-center gap-2 min-w-[60px] justify-center">
                        {isScheduled ? (
                            <span className="text-ink-muted text-caption">vs</span>
                        ) : (
                            <>
                                <span className={`font-medium ${textColor}`}>{match.awayScore}</span>
                                <span className="text-ink-ghost text-caption">:</span>
                                <span className={`font-medium ${textColor}`}>{match.homeScore}</span>
                            </>
                        )}
                    </div>

                    <span className={`font-semibold ${homeAbbr ? 'text-ink-primary' : 'text-ink-tertiary'}`}>{homeAbbr}</span>
                </div>

                {/* Odds / Result */}
                <div className="flex items-center justify-end w-20 text-right opacity-80">
                    {isFinal && spreadData.result ? (
                        <span className={`font-medium ${spreadData.result === 'won' ? 'text-emerald-500' :
                            spreadData.result === 'push' ? 'text-ink-tertiary' : 'text-rose-500'
                            }`}>
                            {spreadData.display}
                        </span>
                    ) : (
                        <div className="flex flex-col items-end gap-0.5">
                            <span className="text-ink-tertiary group-hover:text-ink-primary transition-colors">
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
