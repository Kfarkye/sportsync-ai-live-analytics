import React, { memo } from 'react';
import { Team, Sport } from '@/types';
import TeamLogo from '../shared/TeamLogo';

interface MatchupHeaderProps {
    matchId: string;
    homeTeam: Team;
    awayTeam: Team;
    homeRecord?: string;
    awayRecord?: string;
    broadcast?: string;
    startTime: string | Date;
    sport?: Sport;
    currentOdds?: unknown;
}

const getStartLabel = (sport?: Sport): string => {
    switch (sport) {
        case Sport.NFL:
        case Sport.COLLEGE_FOOTBALL:
            return 'Kickoff';
        case Sport.NBA:
        case Sport.COLLEGE_BASKETBALL:
        case Sport.BASKETBALL:
        case Sport.WNBA:
            return 'Tip-Off';
        case Sport.HOCKEY:
            return 'Puck Drop';
        case Sport.BASEBALL:
            return 'First Pitch';
        case Sport.SOCCER:
            return 'Kick-Off';
        case Sport.TENNIS:
            return 'First Serve';
        default:
            return 'Start';
    }
};

const MatchupHeader: React.FC<MatchupHeaderProps> = memo(({
    matchId: _matchId,
    homeTeam,
    awayTeam,
    homeRecord,
    awayRecord,
    broadcast,
    startTime,
    sport,
    currentOdds: _currentOdds
}) => {
    const dateObj = new Date(startTime);
    const hours = dateObj.getHours();
    const minutes = dateObj.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    const timeStr = `${displayHours}:${minutes}`;
    const dayStr = dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

    const finalHomeRecord = homeRecord || homeTeam?.record || '—';
    const finalAwayRecord = awayRecord || awayTeam?.record || '—';
    const startLabel = getStartLabel(sport);

    return (
        <div className="w-full max-w-[1080px] px-0">
            <div className="rounded-[8px] border border-[#E8E7E3] bg-white px-6 py-8 sm:px-10 sm:py-12">
                <div className="flex flex-col items-center gap-6 md:flex-row md:justify-center md:gap-16">
                    <div className="flex min-w-[160px] flex-col items-center gap-3 text-center">
                        <div className="flex h-[72px] w-[72px] items-center justify-center rounded-full border border-[#E8E7E3] bg-[#FAFAF8]">
                            {sport === Sport.TENNIS && awayTeam?.flag ? (
                                <img src={awayTeam.flag} alt="" className="h-[52px] w-[72px] rounded-md object-cover" />
                            ) : (
                                <TeamLogo logo={awayTeam?.logo} name={awayTeam?.name} className="h-[56px] w-[56px]" />
                            )}
                        </div>
                        <span className="text-[16px] font-semibold text-[#1A1A18]">
                            {sport === Sport.TENNIS ? awayTeam?.name : (awayTeam?.name || awayTeam?.shortName)}
                        </span>
                        <span className="font-mono text-[13px] text-[#9B9B91]">
                            {sport === Sport.TENNIS ? `Rank #${awayTeam?.rank || '—'}` : finalAwayRecord}
                        </span>
                    </div>

                    <div className="flex flex-col items-center gap-2">
                        <div className="rounded-[6px] border border-[#E8E7E3] px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-[#9B9B91]">
                            {dayStr}
                            {broadcast ? ` · ${broadcast.replace('Network', '').trim().split(' ')[0]}` : ''}
                        </div>
                        <div className="font-serif text-[44px] font-bold leading-none tracking-[-0.02em] text-[#1A1A18] sm:text-[48px]">
                            {timeStr}
                            <span className="ml-1 align-middle text-[20px] font-semibold text-[#6B6B63]">{ampm}</span>
                        </div>
                        <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9B9B91]">
                            {startLabel}
                        </div>
                    </div>

                    <div className="flex min-w-[160px] flex-col items-center gap-3 text-center">
                        <div className="flex h-[72px] w-[72px] items-center justify-center rounded-full border border-[#E8E7E3] bg-[#FAFAF8]">
                            {sport === Sport.TENNIS && homeTeam?.flag ? (
                                <img src={homeTeam.flag} alt="" className="h-[52px] w-[72px] rounded-md object-cover" />
                            ) : (
                                <TeamLogo logo={homeTeam?.logo} name={homeTeam?.name} className="h-[56px] w-[56px]" />
                            )}
                        </div>
                        <span className="text-[16px] font-semibold text-[#1A1A18]">
                            {sport === Sport.TENNIS ? homeTeam?.name : (homeTeam?.name || homeTeam?.shortName)}
                        </span>
                        <span className="font-mono text-[13px] text-[#9B9B91]">
                            {sport === Sport.TENNIS ? `Rank #${homeTeam?.rank || '—'}` : finalHomeRecord}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
});

MatchupHeader.displayName = 'MatchupHeader';

export default MatchupHeader;
