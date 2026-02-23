
import React, { useMemo, memo } from 'react';
import { Team, Sport, MatchOdds } from '@/types';
import TeamLogo from '../shared/TeamLogo';
import { motion } from 'framer-motion';
import { cn, ESSENCE } from '@/lib/essence';

// ============================================================================
// TYPES
// ============================================================================

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

// ============================================================================
// CONSTANTS
// ============================================================================

const START_LABELS: Partial<Record<Sport, string>> = {
    [Sport.NFL]: 'Kickoff',
    [Sport.COLLEGE_FOOTBALL]: 'Kickoff',
    [Sport.NBA]: 'Tip-Off',
    [Sport.COLLEGE_BASKETBALL]: 'Tip-Off',
    [Sport.BASKETBALL]: 'Tip-Off',
    [Sport.WNBA]: 'Tip-Off',
    [Sport.HOCKEY]: 'Puck Drop',
    [Sport.BASEBALL]: 'First Pitch',
    [Sport.SOCCER]: 'Kick-Off',
    [Sport.TENNIS]: 'First Serve',
};

const MESH_TRANSITION = { duration: 6, repeat: Infinity, ease: 'easeInOut' as const };

// ============================================================================
// SUBCOMPONENTS
// ============================================================================

const TeamBlock = memo(({
    team,
    record,
    matchId,
    color,
    sport,
    side,
}: {
    team: Team;
    record: string;
    matchId: string;
    color: string;
    sport?: Sport;
    side: 'home' | 'away';
}) => {
    const isTennis = sport === Sport.TENNIS;
    const displayName = isTennis
        ? team?.name.split(' ').slice(-1)[0]
        : (team?.shortName || team?.name);
    const recordStr = isTennis
        ? `RANK #${team?.rank || '—'}`
        : `${team?.rank ? `#${team.rank} · ` : ''}${record}`;

    return (
        <div className="flex flex-col items-center text-center group">
            <motion.div
                layoutId={`logo-${matchId}-${team.id}`}
                whileTap={{ scale: 0.97 }}
                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                className="relative mb-3"
            >
                <div
                    className="absolute inset-[-8px] rounded-full blur-2xl opacity-15 group-hover:opacity-25 transition-opacity duration-500"
                    style={{ background: color }}
                />
                {isTennis && team?.flag ? (
                    <img
                        src={team.flag}
                        alt=""
                        className="w-16 h-12 sm:w-20 sm:h-14 object-cover rounded-lg relative z-10 drop-shadow-lg"
                    />
                ) : (
                    <TeamLogo
                        logo={team?.logo}
                        name={team?.name}
                        className="w-18 h-18 sm:w-22 sm:h-22 relative z-10 drop-shadow-lg"
                    />
                )}
            </motion.div>
            <span className="text-body-lg sm:text-title-lg font-bold text-white tracking-tight leading-tight">
                {displayName}
            </span>
            <span className="mt-1 text-footnote font-semibold text-white/35 tabular-nums tracking-wide font-mono">
                {recordStr}
            </span>
        </div>
    );
});
TeamBlock.displayName = 'TeamBlock';

/** Extracts and formats the favorite spread + total line */
const OddsLine = memo(({
    odds,
    homeTeam,
    awayTeam,
}: {
    odds: MatchOdds;
    homeTeam: Team;
    awayTeam: Team;
}) => {
    const homeSpread = typeof odds.homeSpread === 'number' ? odds.homeSpread : parseFloat(String(odds.homeSpread));
    const awaySpread = typeof odds.awaySpread === 'number' ? odds.awaySpread : parseFloat(String(odds.awaySpread));

    if (isNaN(homeSpread)) return null;

    let abbr: string;
    let spread: number;

    if (homeSpread < 0) {
        abbr = homeTeam.abbreviation || homeTeam.shortName || 'HOME';
        spread = homeSpread;
    } else if (homeSpread > 0) {
        abbr = awayTeam.abbreviation || awayTeam.shortName || 'AWAY';
        spread = !isNaN(awaySpread) ? awaySpread : homeSpread * -1;
    } else {
        abbr = homeTeam.abbreviation || homeTeam.shortName || 'HOME';
        spread = 0;
    }

    return (
        <span className="mt-3 text-footnote font-mono font-medium text-zinc-500 tracking-wide">
            {abbr} {spread === 0 ? 'PK' : spread}
            {odds.total && <span className="text-zinc-600 ml-2">O/U {odds.total}</span>}
        </span>
    );
});
OddsLine.displayName = 'OddsLine';

// ============================================================================
// MAIN COMPONENT
// ============================================================================

const MatchupHeader: React.FC<MatchupHeaderProps> = memo(({
    matchId,
    homeTeam,
    awayTeam,
    homeRecord,
    awayRecord,
    broadcast,
    startTime,
    sport,
    currentOdds,
}) => {
    const dateObj = new Date(startTime);
    const hours = dateObj.getHours();
    const minutes = dateObj.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const timeStr = `${hours % 12 || 12}:${minutes}`;
    const dayStr = dateObj.toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
    }).toUpperCase();

    const homeColor = homeTeam?.color ? `#${homeTeam.color.replace('#', '')}` : '#3B82F6';
    const awayColor = awayTeam?.color ? `#${awayTeam.color.replace('#', '')}` : '#EF4444';
    const startLabel = START_LABELS[sport!] || 'Start';

    const isUrgent = useMemo(() => {
        const diff = dateObj.getTime() - Date.now();
        return diff > 0 && diff < 3_600_000;
    }, [startTime]);

    return (
        <div className="relative w-full overflow-hidden bg-surface-base">

            {/* Ambient team color wash */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden select-none">
                <motion.div
                    animate={{ opacity: [0.12, 0.18, 0.12] }}
                    transition={MESH_TRANSITION}
                    className="absolute top-[-30%] left-[-15%] w-[60%] h-[160%] blur-[100px]"
                    style={{ background: `radial-gradient(ellipse at center, ${awayColor} 0%, transparent 70%)` }}
                />
                <motion.div
                    animate={{ opacity: [0.12, 0.18, 0.12] }}
                    transition={{ ...MESH_TRANSITION, delay: 0.5 }}
                    className="absolute top-[-30%] right-[-15%] w-[60%] h-[160%] blur-[100px]"
                    style={{ background: `radial-gradient(ellipse at center, ${homeColor} 0%, transparent 70%)` }}
                />
                <div className="absolute inset-0 bg-gradient-to-b from-transparent via-surface-pure/50 to-surface-pure" />
            </div>

            {/* Content */}
            <div className="relative z-10 flex flex-col items-center pt-[calc(env(safe-area-inset-top)+16px)] pb-8 px-4">

                {/* Date + Broadcast */}
                <div className="flex items-center gap-3 mb-8">
                    <span className="text-caption font-bold text-zinc-400 tracking-widest uppercase">
                        {dayStr}
                    </span>
                    {broadcast && (
                        <>
                            <div className="w-px h-2 bg-white/15" />
                            <span className="text-caption font-medium text-zinc-600 tracking-wide">
                                {broadcast.replace('Network', '').trim().split(' ')[0]}
                            </span>
                        </>
                    )}
                </div>

                {/* Matchup Grid */}
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-8 sm:gap-14 w-full max-w-2xl">

                    {/* Away */}
                    <TeamBlock
                        team={awayTeam}
                        record={awayRecord || awayTeam?.record || '—'}
                        matchId={matchId}
                        color={awayColor}
                        sport={sport}
                        side="away"
                    />

                    {/* Center: Time */}
                    <div className="flex flex-col items-center">
                        <motion.div
                            className="flex items-baseline"
                            animate={isUrgent ? { scale: [1, 1.015, 1] } : {}}
                            transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
                        >
                            <span
                                className={cn(
                                    "text-[42px] sm:text-[52px] font-light tracking-[-0.03em] tabular-nums",
                                    isUrgent ? "text-orange-400" : "text-white"
                                )}
                                style={{ fontFeatureSettings: '"tnum" on, "lnum" on' }}
                            >
                                {timeStr}
                            </span>
                            <span className={cn(
                                "text-body-sm sm:text-body font-medium ml-1",
                                isUrgent ? "text-orange-400/60" : "text-white/40"
                            )}>
                                {ampm}
                            </span>
                        </motion.div>

                        <span className="text-caption font-medium text-zinc-600 uppercase tracking-widest mt-1">
                            {startLabel}
                        </span>

                        {currentOdds && (
                            <OddsLine odds={currentOdds} homeTeam={homeTeam} awayTeam={awayTeam} />
                        )}
                    </div>

                    {/* Home */}
                    <TeamBlock
                        team={homeTeam}
                        record={homeRecord || homeTeam?.record || '—'}
                        matchId={matchId}
                        color={homeColor}
                        sport={sport}
                        side="home"
                    />
                </div>
            </div>
        </div>
    );
});

MatchupHeader.displayName = 'MatchupHeader';

export default MatchupHeader;
