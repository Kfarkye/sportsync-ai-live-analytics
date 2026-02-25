
import React, { useMemo, memo } from 'react';
import { Team, Sport, MatchOdds } from '@/types';
import TeamLogo from '../shared/TeamLogo';
import { motion } from 'framer-motion';
import { cn } from '@/lib/essence';

interface MatchupHeaderProps {
    matchId: string;
    homeTeam: Team;
    awayTeam: Team;
    homeRecord?: string;
    awayRecord?: string;
    broadcast?: string;
    startTime: string | Date;
    sport?: Sport;
    currentOdds?: MatchOdds;
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
    matchId,
    homeTeam,
    awayTeam,
    homeRecord,
    awayRecord,
    broadcast,
    startTime,
    sport,
    currentOdds
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

    const isUrgent = useMemo(() => {
        const now = new Date();
        const diff = dateObj.getTime() - now.getTime();
        return diff > 0 && diff < 60 * 60 * 1000;
    }, [startTime]);

    return (
        <div className="bg-white border-b border-slate-200 pt-8 flex flex-col items-center font-sans w-full">
            {/* Date / Status Pill */}
            <div className="bg-slate-50 border border-slate-200 text-slate-500 text-[10px] font-bold uppercase tracking-widest px-4 py-1.5 rounded-full mb-8">
                {dayStr}
                {broadcast && (
                    <span className="ml-2 text-slate-400">
                        {broadcast.replace('Network', '').trim().split(' ')[0]}
                    </span>
                )}
            </div>

            {/* Team Matchup Row */}
            <div className="w-full max-w-md flex justify-between items-start px-6 mb-10">
                {/* Away Team */}
                <div className="flex flex-col items-center w-[35%] text-center">
                    <motion.div
                        layoutId={`logo-${matchId}-${awayTeam.id}`}
                        className="w-16 h-16 flex items-center justify-center mb-3"
                    >
                        {sport === Sport.TENNIS && awayTeam?.flag ? (
                            <img src={awayTeam.flag} alt="" className="w-16 h-12 object-cover rounded-lg" />
                        ) : (
                            <TeamLogo
                                logo={awayTeam?.logo}
                                name={awayTeam?.name}
                                className="w-16 h-16"
                            />
                        )}
                    </motion.div>
                    <span className="text-sm font-bold text-slate-900 leading-tight">
                        {sport === Sport.TENNIS ? awayTeam?.name.split(' ').slice(-1)[0] : (awayTeam?.shortName || awayTeam?.name)}
                    </span>
                    <span className="text-xs font-semibold text-slate-500 mt-1.5">
                        {sport === Sport.TENNIS ? `Rank #${awayTeam?.rank || '—'}` : `${awayTeam?.rank ? `#${awayTeam.rank} · ` : ''}${finalAwayRecord}`}
                    </span>
                </div>

                {/* Center Time */}
                <div className="flex flex-col items-center justify-center mt-2">
                    <div className="flex items-baseline gap-1">
                        <span className={cn(
                            "text-5xl font-light tracking-tighter tabular-nums",
                            isUrgent ? "text-orange-600" : "text-slate-900"
                        )}>
                            {timeStr}
                        </span>
                        <span className={cn(
                            "text-sm font-bold",
                            isUrgent ? "text-orange-500" : "text-slate-500"
                        )}>
                            {ampm}
                        </span>
                    </div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2">
                        {startLabel}
                    </span>

                    {/* Market Data */}
                    {currentOdds && (() => {
                        const odds = currentOdds || {};
                        const homeSpreadNum = typeof odds.homeSpread === 'number' ? odds.homeSpread : parseFloat(String(odds.homeSpread));
                        const awaySpreadNum = typeof odds.awaySpread === 'number' ? odds.awaySpread : parseFloat(String(odds.awaySpread));

                        let favoriteAbbr = '';
                        let favoriteSpread: number | null = null;

                        if (!isNaN(homeSpreadNum)) {
                            if (homeSpreadNum < 0) {
                                favoriteAbbr = homeTeam.abbreviation || homeTeam.shortName || 'HOME';
                                favoriteSpread = homeSpreadNum;
                            } else if (homeSpreadNum > 0) {
                                favoriteAbbr = awayTeam.abbreviation || awayTeam.shortName || 'AWAY';
                                favoriteSpread = !isNaN(awaySpreadNum) ? awaySpreadNum : homeSpreadNum * -1;
                            } else {
                                favoriteAbbr = homeTeam.abbreviation || homeTeam.shortName || 'HOME';
                                favoriteSpread = 0;
                            }
                        }

                        return favoriteSpread !== null ? (
                            <span className="mt-3 text-[11px] font-mono font-medium text-slate-500 tracking-wide">
                                {favoriteAbbr} {favoriteSpread === 0 ? 'PK' : favoriteSpread}
                                {odds.total && <span className="text-slate-400 ml-2">O/U {odds.total}</span>}
                            </span>
                        ) : null;
                    })()}
                </div>

                {/* Home Team */}
                <div className="flex flex-col items-center w-[35%] text-center">
                    <motion.div
                        layoutId={`logo-${matchId}-${homeTeam.id}`}
                        className="w-16 h-16 flex items-center justify-center mb-3"
                    >
                        {sport === Sport.TENNIS && homeTeam?.flag ? (
                            <img src={homeTeam.flag} alt="" className="w-16 h-12 object-cover rounded-lg" />
                        ) : (
                            <TeamLogo
                                logo={homeTeam?.logo}
                                name={homeTeam?.name}
                                className="w-16 h-16"
                            />
                        )}
                    </motion.div>
                    <span className="text-sm font-bold text-slate-900 leading-tight">
                        {sport === Sport.TENNIS ? homeTeam?.name.split(' ').slice(-1)[0] : (homeTeam?.shortName || homeTeam?.name)}
                    </span>
                    <span className="text-xs font-semibold text-slate-500 mt-1.5">
                        {sport === Sport.TENNIS ? `Rank #${homeTeam?.rank || '—'}` : `${homeTeam?.rank ? `#${homeTeam.rank} · ` : ''}${finalHomeRecord}`}
                    </span>
                </div>
            </div>
        </div>
    );
});

MatchupHeader.displayName = 'MatchupHeader';

export default MatchupHeader;
