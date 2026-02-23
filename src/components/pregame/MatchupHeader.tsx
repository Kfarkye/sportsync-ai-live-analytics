
import React, { useMemo, memo } from 'react';
import { Team, Sport, MatchOdds } from '@/types';
import TeamLogo from '../shared/TeamLogo';
import { motion } from 'framer-motion';
import { cn, ESSENCE } from '@/lib/essence';
import { useValueFlash } from '../../hooks/useValueFlash';

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

/**
 * MATCHUP HEADER — STATE OF THE ART
 * 
 * Jony Ive Audit Checklist:
 * ✓ Every pixel has purpose
 * ✓ Typography hierarchy is sacred
 * ✓ Animations are subtle, never jarring
 * ✓ Whitespace creates rhythm
 * ✓ Color serves information
 */

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
    // Apple-style time formatting: "10:00" with "AM" as suffix
    const hours = dateObj.getHours();
    const minutes = dateObj.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    const timeStr = `${displayHours}:${minutes}`;
    const dayStr = dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase();

    const finalHomeRecord = homeRecord || homeTeam?.record || '—';
    const finalAwayRecord = awayRecord || awayTeam?.record || '—';

    const startLabel = getStartLabel(sport);

    const homeColor = homeTeam?.color ? `#${homeTeam.color.replace('#', '')}` : '#3B82F6';
    const awayColor = awayTeam?.color ? `#${awayTeam.color.replace('#', '')}` : '#EF4444';

    const isUrgent = useMemo(() => {
        const now = new Date();
        const diff = dateObj.getTime() - now.getTime();
        return diff > 0 && diff < 60 * 60 * 1000;
    }, [startTime]);

    return (
        <div className="relative w-full overflow-hidden bg-surface-elevated/60 backdrop-blur-[40px] saturate-[180%]">
            {/* CINEMATIC DEPTH: Animated Mesh Gradients - "Battleground" Momentum */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden select-none">
                {/* Away Team Primary Glow (Shared Layout) */}
                <motion.div
                    layoutId="away-mesh-primary"
                    animate={{
                        opacity: [0.15, 0.22, 0.15],
                        scale: [1, 1.1, 1]
                    }}
                    transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
                    className="absolute top-[-40%] left-[-20%] w-[65%] h-[180%] blur-[120px]"
                    style={{ background: `radial-gradient(ellipse at center, ${awayColor} 0%, transparent 70%)` }}
                />

                {/* Home Team Primary Glow (Shared Layout) */}
                <motion.div
                    layoutId="home-mesh-primary"
                    animate={{
                        opacity: [0.15, 0.22, 0.15],
                        scale: [1, 1.1, 1]
                    }}
                    transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}
                    className="absolute top-[-40%] right-[-20%] w-[65%] h-[180%] blur-[120px]"
                    style={{ background: `radial-gradient(ellipse at center, ${homeColor} 0%, transparent 70%)` }}
                />

                {/* Kinetic Blend Overlay (Apple Glass) */}
                <div className={cn("absolute inset-0 bg-gradient-to-b from-transparent via-surface-pure/40 to-surface-pure", ESSENCE.interactions.vibrancy)} />
            </div>

            {/* Content */}
            <div className="relative z-10 flex flex-col items-center pt-[calc(env(safe-area-inset-top)+16px)] pb-7 px-4">

                {/* Context Bar (Date + Broadcast) - Vibrant */}
                <div className="flex items-center gap-3 mb-6">
                    <span className={cn("text-caption font-black text-white tracking-widest", ESSENCE.interactions.vibrancy)}>
                        {dayStr}
                    </span>
                    {broadcast && (
                        <>
                            <div className="w-[1px] h-[8px] bg-white/20" />
                            <span className={cn("text-caption font-semibold text-white/40 tracking-wide", ESSENCE.interactions.vibrancy)}>
                                {broadcast.replace('Network', '').trim().split(' ')[0]}
                            </span>
                        </>
                    )}
                </div>

                {/* Matchup Grid */}
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-10 sm:gap-16 w-full max-w-2xl">

                    {/* Away Team */}
                    <div className="flex flex-col items-center text-center group">
                        <motion.div
                            layoutId={`logo-${matchId}-${awayTeam.id}`}
                            whileHover={{ scale: 1.04 }}
                            whileTap={{ scale: 0.97 }}
                            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                            className="relative mb-3"
                        >
                            {/* Subtle Logo Glow */}
                            <div
                                className="absolute inset-[-8px] rounded-full blur-2xl opacity-15 group-hover:opacity-30 transition-opacity duration-500"
                                style={{ background: awayColor }}
                            />
                            {sport === Sport.TENNIS && awayTeam?.flag ? (
                                <img src={awayTeam.flag} alt="" className="w-16 h-12 sm:w-20 sm:h-14 object-cover rounded-lg relative z-10 drop-shadow-lg" />
                            ) : (
                                <TeamLogo
                                    logo={awayTeam?.logo}
                                    name={awayTeam?.name}
                                    className="w-18 h-18 sm:w-22 sm:h-22 relative z-10 drop-shadow-lg"
                                />
                            )}
                        </motion.div>
                        <span className="text-body-lg sm:text-title-lg font-bold text-white tracking-tight leading-tight">
                            {sport === Sport.TENNIS ? awayTeam?.name.split(' ').slice(-1)[0] : (awayTeam?.shortName || awayTeam?.name)}
                        </span>
                        <span className="mt-1 text-footnote font-semibold text-white/35 tabular-nums tracking-wide font-mono">
                            {sport === Sport.TENNIS ? `RANK #${awayTeam?.rank || '—'}` : `${awayTeam?.rank ? `#${awayTeam.rank} · ` : ''}${finalAwayRecord}`}
                        </span>
                    </div>


                    {/* Time Block - Peak Apple Typography */}
                    <motion.div
                        layoutId="dynamic-island-clock"
                        className="flex flex-col items-center justify-center px-4 py-2 rounded-full bg-surface-elevated/60 border-[0.5px] border-white/10 backdrop-blur-[40px] saturate-[180%] shadow-[0_10px_40px_rgba(0,0,0,0.45)]"
                    >
                        <motion.div
                            className="relative flex items-baseline gap-0.5"
                            animate={isUrgent ? { scale: [1, 1.02, 1] } : {}}
                            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                        >
                            <span className={cn(
                                "text-[38px] sm:text-[48px] font-medium tracking-[-0.04em] tabular-nums",
                                isUrgent ? "text-orange-400" : "text-white"
                            )} style={{
                                textShadow: isUrgent ? '0 0 40px rgba(251,146,60,0.3)' : 'none',
                                fontFeatureSettings: '"tnum" on, "lnum" on'
                            }}>
                                {timeStr}
                            </span>
                            <span className={cn(
                                "text-body sm:text-[16px] font-medium tracking-tight",
                                isUrgent ? "text-orange-400/70" : "text-white/50"
                            )}>
                                {ampm}
                            </span>
                            {isUrgent && (
                                <motion.div
                                    animate={{ opacity: [1, 0.4, 1] }}
                                    transition={{ duration: 1.2, repeat: Infinity }}
                                    className="absolute -right-3 top-2 w-2 h-2 rounded-full bg-orange-500 shadow-[0_0_12px_rgba(251,146,60,0.7)]"
                                />
                            )}
                        </motion.div>
                        <span className="mt-1 text-caption font-semibold text-white/30 uppercase tracking-[0.25em]">
                            {startLabel}
                        </span>

                        {/* Market Data: Raw Monospace (Liquid Data Aesthetic) */}
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
                                <span className="mt-3 text-footnote font-mono font-medium text-zinc-500 tracking-wide">
                                    {favoriteAbbr} {favoriteSpread === 0 ? 'PK' : favoriteSpread}
                                    {odds.total && <span className="text-zinc-600 ml-2">O/U {odds.total}</span>}
                                </span>
                            ) : null;
                        })()}







                    </motion.div>

                    {/* Home Team */}
                    <div className="flex flex-col items-center text-center group">
                        <motion.div
                            layoutId={`logo-${matchId}-${homeTeam.id}`}
                            whileHover={{ scale: 1.04 }}
                            whileTap={{ scale: 0.97 }}
                            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                            className="relative mb-3"
                        >
                            {/* Subtle Logo Glow */}
                            <div
                                className="absolute inset-[-8px] rounded-full blur-2xl opacity-15 group-hover:opacity-30 transition-opacity duration-500"
                                style={{ background: homeColor }}
                            />
                            {sport === Sport.TENNIS && homeTeam?.flag ? (
                                <img src={homeTeam.flag} alt="" className="w-16 h-12 sm:w-20 sm:h-14 object-cover rounded-lg relative z-10 drop-shadow-lg" />
                            ) : (
                                <TeamLogo
                                    logo={homeTeam?.logo}
                                    name={homeTeam?.name}
                                    className="w-18 h-18 sm:w-22 sm:h-22 relative z-10 drop-shadow-lg"
                                />
                            )}
                        </motion.div>
                        <span className="text-body-lg sm:text-title-lg font-bold text-white tracking-tight leading-tight">
                            {sport === Sport.TENNIS ? homeTeam?.name.split(' ').slice(-1)[0] : (homeTeam?.shortName || homeTeam?.name)}
                        </span>
                        <span className="mt-1 text-footnote font-semibold text-white/35 tabular-nums tracking-wide font-mono">
                            {sport === Sport.TENNIS ? `RANK #${homeTeam?.rank || '—'}` : `${homeTeam?.rank ? `#${homeTeam.rank} · ` : ''}${finalHomeRecord}`}
                        </span>
                    </div>

                </div>
            </div>
        </div>
    );
});

MatchupHeader.displayName = 'MatchupHeader';

export default MatchupHeader;
