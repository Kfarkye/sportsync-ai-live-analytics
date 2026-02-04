
import React, { useMemo, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { User, Target, ChevronLeft, ChevronRight } from 'lucide-react';
import { Match, PlayerPropBet, Team, InjuryReport, RosterPlayer } from '../../types';
import { isGameInProgress, isGameFinished } from '../../utils/matchUtils';
import { ESSENCE } from '../../lib/essence';

// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

const cn = (...classes: (string | boolean | undefined | null)[]): string =>
    classes.filter(Boolean).join(' ');

const formatMarketLabel = (betType: string, marketLabel?: string): string => {
    const raw = marketLabel || betType.replace(/_/g, ' ');
    // Strip numbers and collapse whitespace since the line value is displayed separately
    return raw.replace(/[\d.]+/g, '').replace(/\s+/g, ' ').trim();
};

const useTeamColors = (match: Match) => useMemo(() => ({
    home: match.homeTeam.color ? `#${match.homeTeam.color.replace('#', '')}` : '#3B82F6',
    away: match.awayTeam.color ? `#${match.awayTeam.color.replace('#', '')}` : '#EF4444'
}), [match.homeTeam.color, match.awayTeam.color]);

// Generate a fallback headshot URL using ESPN CDN pattern
const generateHeadshotUrl = (playerName: string, sport: string): string | null => {
    // We don't have player IDs readily available, so return null to show fallback avatar
    // This could be enhanced with a player ID lookup if we add that data
    return null;
};

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface PlayerPropGroup {
    playerName: string;
    headshotUrl?: string;
    team?: string;
    props: PlayerPropBet[];
}

interface UniqueProp {
    main: PlayerPropBet;
    over?: PlayerPropBet;
    under?: PlayerPropBet;
}

// ═══════════════════════════════════════════════════════════════════════════
// STAT LOOKUP
// ═══════════════════════════════════════════════════════════════════════════

export const getPlayerStatValue = (match: Match, playerName: string, betType: string): number | null => {
    if (!match.playerStats) return null;
    const normName = playerName.toLowerCase().replace(/[^a-z0-9]/g, '');

    for (const teamStats of match.playerStats) {
        for (const category of teamStats.categories) {
            const athlete = category.athletes.find(a =>
                a.name?.toLowerCase().replace(/[^a-z0-9]/g, '') === normName ||
                a.shortName?.toLowerCase().replace(/[^a-z0-9]/g, '') === normName
            );

            if (athlete) {
                const bt = betType.toLowerCase();
                const labels = category.labels.map(l => l.toUpperCase());
                let idx = -1;

                if (bt === 'points') idx = labels.indexOf('PTS');
                else if (bt === 'rebounds') idx = labels.indexOf('REB');
                else if (bt === 'assists') idx = labels.indexOf('AST');
                else if (bt === 'steals') idx = labels.indexOf('STL');
                else if (bt === 'blocks') idx = labels.indexOf('BLK');
                else if (bt === 'threes_made' || bt === '3pm') idx = labels.indexOf('3PM');
                else if (bt === 'passing_yards' && category.name.toLowerCase().includes('passing')) idx = labels.indexOf('YDS');
                else if (bt === 'rushing_yards' && category.name.toLowerCase().includes('rushing')) idx = labels.indexOf('YDS');
                else if (bt === 'receiving_yards' && category.name.toLowerCase().includes('receiving')) idx = labels.indexOf('YDS');
                else if (bt === 'receptions') idx = labels.indexOf('REC');
                else if (bt === 'shots_on_goal' || bt === 'sog') idx = labels.indexOf('SOG');
                else if (bt === 'goals') idx = labels.indexOf('G');
                else if (bt === 'saves') idx = labels.indexOf('SAVES');
                else if (bt === 'hits' && category.name.toLowerCase().includes('batting')) idx = labels.indexOf('H');
                else if ((bt === 'strikeouts' || bt === 'k') && category.name.toLowerCase().includes('pitching')) idx = labels.indexOf('K');
                else if (bt === 'total_bases' && category.name.toLowerCase().includes('batting')) idx = labels.indexOf('TB');
                else if (bt === 'anytime_td' || bt === 'touchdowns') {
                    // TDs are often not in a single column, but let's check common labels
                    idx = labels.indexOf('TD') !== -1 ? labels.indexOf('TD') : labels.indexOf('D/ST TD');
                }

                if (idx !== -1 && athlete.stats[idx]) {
                    const val = parseFloat(athlete.stats[idx]);
                    return isNaN(val) ? 0 : val;
                }
            }
        }
    }
    return null;
};

// ═══════════════════════════════════════════════════════════════════════════
// PROP CARD — Jony Ive Philosophy
// "Design is not just what it looks like. Design is how it works."
// ═══════════════════════════════════════════════════════════════════════════

export const ApplePlayerCard: React.FC<{
    group: PlayerPropGroup;
    teamColor: string;
    index: number;
    match: Match;
}> = memo(({ group, teamColor, index, match }) => {
    const isLive = isGameInProgress(match.status);
    const isFinal = isGameFinished(match.status);
    const showResults = isLive || isFinal;

    const [activePropIndex, setActivePropIndex] = React.useState(0);

    const uniqueProps = useMemo(() => {
        const seen = new Map<string, UniqueProp>();
        group.props.forEach(p => {
            const key = `${p.betType}-${p.lineValue}`;
            if (!seen.has(key)) seen.set(key, { main: p });
            const entry = seen.get(key)!;
            if (p.side?.toLowerCase() === 'over') entry.over = p;
            else if (p.side?.toLowerCase() === 'under') entry.under = p;
        });
        return Array.from(seen.values());
    }, [group.props]);

    const currentProp = uniqueProps[activePropIndex];
    if (!currentProp) return null;

    const hasMultipleProps = uniqueProps.length > 1;
    const liveVal = currentProp.main.resultValue ?? getPlayerStatValue(match, group.playerName, currentProp.main.betType);
    const currentValue = liveVal ?? (showResults ? 0 : null);
    const line = currentProp.main.lineValue;
    const progress = currentValue !== null ? Math.min((currentValue / line) * 100, 100) : 0;
    const diff = currentValue !== null ? line - currentValue : 0;

    const isOverBet = currentProp.main.side?.toLowerCase() !== 'under';
    const isTargetMet = isOverBet ? (currentValue >= line) : (currentValue <= line);
    const isBusted = !isOverBet && (currentValue > line);

    const nextProp = () => setActivePropIndex(i => (i + 1) % uniqueProps.length);
    const prevProp = () => setActivePropIndex(i => (i - 1 + uniqueProps.length) % uniqueProps.length);

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ scale: 1.02, y: -2 }}
            transition={{ delay: index * 0.05, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
                "group relative rounded-[32px] overflow-hidden transition-all duration-500 transform-gpu",
                "bg-[#050505]/80 backdrop-blur-[24px] border-[0.5px] border-white/10",
                "shadow-[0_0_0_1px_rgba(255,255,255,0.04),_0_20px_50px_-12px_rgba(0,0,0,0.55)]",
                "after:content-[''] after:absolute after:inset-0 after:opacity-[0.03] after:pointer-events-none",
                "after:bg-[url('data:image/svg+xml,%3Csvg viewBox=%270 0 256 256%27 xmlns=%27http://www.w3.org/2000/svg%27%3E%3Cfilter id=%27n%27%3E%3CfeTurbulence type=%27fractalNoise%27 baseFrequency=%270.8%27 numOctaves=%273%27 stitchTiles=%27stitch%27/%3E%3C/filter%3E%3Crect width=%27100%25%27 height=%27100%25%27 filter=%27url(%23n)%27 opacity=%270.05%27/%3E%3C/svg%3E')]"
            )}
            style={{
                boxShadow: '0 0 0 1px rgba(255,255,255,0.05), 0 20px 50px -12px rgba(0,0,0,0.5)'
            }}
        >
            {/* Ambient Background Glow (Dynamic) */}
            <div
                className="absolute inset-x-0 top-0 h-40 opacity-[0.08] blur-[60px] pointer-events-none transition-opacity duration-1000 group-hover:opacity-[0.15]"
                style={{ background: `radial-gradient(circle at 50% 0%, ${teamColor}, transparent)` }}
            />

            {/* Content Container */}
            <div className="relative px-7 pt-8 pb-7 z-10">
                {/* Identity Row */}
                <div className="flex items-center gap-5 mb-8">
                    {/* Avatar with Gradient Ring */}
                    <div className="relative group/avatar">
                        <div
                            className="absolute -inset-1 rounded-[26px] opacity-20 blur-sm transition-all duration-500 group-hover:opacity-40"
                            style={{ background: `linear-gradient(135deg, ${teamColor}, transparent)` }}
                        />
                        <div
                            className="relative w-[72px] h-[72px] rounded-[22px] overflow-hidden ring-1 ring-white/10"
                            style={{
                                background: 'linear-gradient(145deg, #1a1a1a, #0d0d0d)',
                            }}
                        >
                            {group.headshotUrl ? (
                                <img
                                    src={group.headshotUrl}
                                    alt=""
                                    className="w-full h-full object-cover object-top transition-transform duration-700 group-hover/avatar:scale-110"
                                    loading="lazy"
                                />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                    <User size={28} strokeWidth={1.5} className="text-zinc-700" />
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Name & Metadata */}
                    <div className="flex-1 min-w-0">
                        <motion.h3
                            layout
                            className="text-[22px] font-semibold text-white tracking-[-0.03em] truncate leading-tight"
                        >
                            {group.playerName}
                        </motion.h3>
                        {group.team && (
                            <p className="text-[10px] font-black text-zinc-500 mt-1 uppercase tracking-widest">
                                {group.team}
                            </p>
                        )}
                    </div>

                    {/* Current Score - Institutional Polish */}
                    {showResults && (
                        <motion.div
                            key={currentValue}
                            initial={{ opacity: 0, scale: 0.9, y: 5 }}
                            animate={{ opacity: 1, scale: [1, 1.1, 1], y: 0 }}
                            transition={{ duration: 0.6, ease: "easeOut" }}
                            className="text-right"
                        >
                            <div className={cn(
                                "text-[42px] font-bold tabular-nums leading-none tracking-tighter filter drop-shadow-sm",
                                isFinal ? (isTargetMet ? "text-emerald-400" : "text-rose-400") : (isBusted ? "text-rose-400" : "text-white")
                            )}>
                                {currentValue}
                            </div>
                            <div className="text-[10px] font-black text-zinc-600 uppercase tracking-widest mt-1">Live</div>
                        </motion.div>
                    )}
                </div>

                {/* Stat Type Selector — iOS Native Segmented Feel */}
                <div className="flex items-center justify-between gap-2 mb-8 bg-white/[0.03] p-1 rounded-2xl ring-1 ring-white/[0.05]">
                    {hasMultipleProps && (
                        <button
                            onClick={prevProp}
                            className="w-10 h-10 rounded-xl flex items-center justify-center text-zinc-500 hover:text-white transition-all active:scale-90 tap-feedback"
                        >
                            <ChevronLeft size={20} strokeWidth={2} />
                        </button>
                    )}

                    <div className="flex-1 text-center overflow-hidden">
                        <AnimatePresence mode="wait">
                            <motion.span
                                key={activePropIndex}
                                initial={{ opacity: 0, scale: 0.9, y: 4 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 1.1, y: -4 }}
                                transition={ESSENCE.transition.spring}
                                className="text-[13px] font-black text-zinc-300 tracking-widest uppercase"
                            >
                                {formatMarketLabel(currentProp.main.betType, currentProp.main.marketLabel)}
                            </motion.span>
                        </AnimatePresence>
                    </div>

                    {hasMultipleProps && (
                        <button
                            onClick={nextProp}
                            className="w-10 h-10 rounded-xl flex items-center justify-center text-zinc-500 hover:text-white transition-all active:scale-90 tap-feedback"
                        >
                            <ChevronRight size={20} strokeWidth={2} />
                        </button>
                    )}
                </div>

                {/* The Number — Hero Element with Depth */}
                <div className="text-center mb-10 relative">
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={`${activePropIndex}-${line}`}
                            initial={{ opacity: 0, filter: 'blur(10px)', scale: 0.9 }}
                            animate={{ opacity: 1, filter: 'blur(0px)', scale: 1 }}
                            exit={{ opacity: 0, filter: 'blur(10px)', scale: 1.1 }}
                            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                        >
                            <span
                                className="text-[88px] font-black tabular-nums leading-none tracking-tighter"
                                style={{
                                    color: '#fff',
                                    textShadow: '0 0 40px rgba(255,255,255,0.1)'
                                }}
                            >
                                {line}
                            </span>
                        </motion.div>
                    </AnimatePresence>

                    {/* Perspective Label */}
                    <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[10px] font-black text-zinc-700 uppercase tracking-[0.4em]">
                        Projected Line
                    </div>
                </div>

                {/* Progress — Optimized for iOS tactile feedback */}
                {showResults && (
                    <div className="space-y-5 bg-white/[0.02] p-5 rounded-3xl border border-white/[0.04]">
                        {/* Progress Bar with Internal Glow */}
                        <div
                            className="h-2 w-full rounded-full overflow-hidden relative"
                            style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}
                        >
                            <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${progress}%` }}
                                transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
                                className="h-full rounded-full relative"
                                style={{
                                    background: isTargetMet
                                        ? `linear-gradient(90deg, #10b981, #34d399)`
                                        : (isFinal || isBusted ? `linear-gradient(90deg, #f43f5e, #fb7185)` : `linear-gradient(90deg, ${teamColor}, ${teamColor}dd)`)
                                }}
                            >
                                <div className="absolute inset-0 bg-white/20 mix-blend-overlay" />
                            </motion.div>
                        </div>

                        {/* Status Labeling */}
                        <div className="flex justify-between items-center text-[11px] font-bold uppercase tracking-wider">
                            <span className="text-zinc-600 tabular-nums">
                                Progress: <span className="text-zinc-400">{currentValue} / {line}</span>
                            </span>
                            <span className={cn(
                                "py-1 px-3 rounded-full",
                                isTargetMet ? "bg-emerald-500/10 text-emerald-400" : (isFinal || isBusted ? "bg-rose-500/10 text-rose-400" : "bg-white/5 text-zinc-500")
                            )}>
                                {isFinal
                                    ? (isTargetMet ? 'CLEARED' : 'MISSED')
                                    : (isOverBet
                                        ? (isTargetMet ? 'GOAL MET' : `${(line - currentValue).toFixed(1)} REMAINING`)
                                        : (isTargetMet ? `${(line - currentValue).toFixed(1)} TO SPARE` : 'OVER LINE')
                                    )
                                }
                            </span>
                        </div>
                    </div>
                )}

                {/* Pagination Dots — Minimal iOS style */}
                {hasMultipleProps && (
                    <div className="flex justify-center gap-1.5 mt-8">
                        {uniqueProps.map((_, i) => (
                            <button
                                key={i}
                                onClick={() => setActivePropIndex(i)}
                                className={cn(
                                    "transition-all duration-500 rounded-full",
                                    i === activePropIndex
                                        ? "w-8 h-1 bg-white"
                                        : "w-1 h-1 bg-zinc-800 hover:bg-zinc-600"
                                )}
                            />
                        ))}
                    </div>
                )}
            </div>
        </motion.div>
    );
});

ApplePlayerCard.displayName = 'ApplePlayerCard';

// ═══════════════════════════════════════════════════════════════════════════
// CONTAINER — "Simplicity is the ultimate sophistication."
// ═══════════════════════════════════════════════════════════════════════════

export const CinematicPlayerProps: React.FC<{ match: Match }> = ({ match }) => {
    const dbProps = match.dbProps || [];
    const colors = useTeamColors(match);

    const { awayPlayers, homePlayers } = useMemo(() => {
        const groups = new Map<string, PlayerPropGroup>();

        // Identity normalization helper
        const normalize = (s: string | undefined | null) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

        // 1. Identify "OUT" players to suppress
        const injuredOutNames = new Set<string>();
        const injData = (match as Match & { injuries?: { home?: InjuryReport[]; away?: InjuryReport[] } }).injuries;
        const rostersData = match.rosters;

        if (injData) {
            [...(injData.home || []), ...(injData.away || [])].forEach((inj: InjuryReport) => {
                if (inj.status === 'OUT') {
                    injuredOutNames.add(normalize(inj.name || inj.player));
                }
            });
        }

        dbProps.forEach(prop => {
            const pName = prop.playerName;
            const normName = normalize(pName);

            // STOP: If player is officially OUT, do not show their props
            if (injuredOutNames.has(normName)) return;

            const key = normName;
            if (!groups.has(key)) {
                groups.set(key, {
                    playerName: pName,
                    headshotUrl: prop.headshotUrl,
                    team: prop.team,
                    props: []
                });
            }
            const group = groups.get(key)!;
            group.props.push(prop);
            // Optimization: If current group team is null but this prop has a team, populate it
            if (!group.team && prop.team) group.team = prop.team;
        });

        const all = Array.from(groups.values());
        const hName = match.homeTeam.name.toLowerCase();
        const aName = match.awayTeam.name.toLowerCase();
        const hShort = (match.homeTeam.shortName || '').toLowerCase();
        const aShort = (match.awayTeam.shortName || '').toLowerCase();
        const hAbbr = (match.homeTeam.abbreviation || '').toLowerCase();
        const aAbbr = (match.awayTeam.abbreviation || '').toLowerCase();

        const isTeamMatch = (pTeam: string | undefined, targetNames: string[], playerName: string, isHomeCheck: boolean) => {
            const normP = normalize(playerName);

            // PRIORITY 1: Use roster data as the source of truth
            if (rostersData) {
                const isOnHomeRoster = rostersData.home?.some((p: RosterPlayer) => normalize(p.name || p.displayName) === normP);
                const isOnAwayRoster = rostersData.away?.some((p: RosterPlayer) => normalize(p.name || p.displayName) === normP);

                // If we definitively find the player on one roster, use that
                if (isOnHomeRoster && !isOnAwayRoster) return isHomeCheck;
                if (isOnAwayRoster && !isOnHomeRoster) return !isHomeCheck;
            }

            // PRIORITY 2: Use team string from prop data
            if (pTeam) {
                const norm = pTeam.toLowerCase();
                return targetNames.some(t => t && (norm.includes(t) || t.includes(norm)));
            }

            // PRIORITY 3: If no team data at all, do NOT show on both sides (prevents duplication)
            // Return false for both to prevent duplicates. We'll handle orphan players separately.
            return false;
        };

        const homeMatches = all.filter(p => isTeamMatch(p.team, [hName, hShort, hAbbr], p.playerName, true));
        const awayMatches = all.filter(p => isTeamMatch(p.team, [aName, aShort, aAbbr], p.playerName, false));

        // ORPHAN RECOVERY: Find players NOT assigned to either team (missing all data)
        // For these, we need to show them somewhere. Assign them to the home team section.
        const homeKeys = new Set(homeMatches.map(p => normalize(p.playerName)));
        const awayKeys = new Set(awayMatches.map(p => normalize(p.playerName)));
        const orphans = all.filter(p => {
            const key = normalize(p.playerName);
            return !homeKeys.has(key) && !awayKeys.has(key);
        });

        // Add orphans to home team only (to avoid any duplication)
        const finalHome = [...homeMatches, ...orphans];

        return {
            homePlayers: finalHome.sort((a, b) => b.props.length - a.props.length),
            awayPlayers: awayMatches.sort((a, b) => b.props.length - a.props.length)
        };
    }, [dbProps, match]);

    if (dbProps.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-24">
                <Target size={32} strokeWidth={1} className="text-zinc-700 mb-4" />
                <span className="text-[14px] text-zinc-600">
                    No props available
                </span>
            </div>
        );
    }

    const renderPlayerSection = (players: PlayerPropGroup[], title: string, color: string) => {
        if (players.length === 0) return null;
        return (
            <div className="space-y-6">
                <div className="flex items-center gap-3">
                    <span className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.2em]">{title}</span>
                    <div className="flex-1 h-px bg-white/[0.03]" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {players.map((group, idx) => (
                        <ApplePlayerCard
                            key={`${group.playerName}-${idx}`}
                            group={group}
                            teamColor={color}
                            index={idx}
                            match={match}
                        />
                    ))}
                </div>
            </div>
        );
    };

    const renderTeamContainer = (players: PlayerPropGroup[], team: Team, color: string) => {
        if (players.length === 0) return null;

        const keyPlayers = players.filter(p => p.props.length >= 3);
        const rolePlayers = players.filter(p => p.props.length < 3);

        return (
            <div className="space-y-10">
                <div className="flex items-center gap-4">
                    <img src={team.logo} alt="" className="w-10 h-10 object-contain" />
                    <div>
                        <h2 className="text-[20px] font-bold text-white tracking-tight">{team.name}</h2>
                        <span className="text-[12px] text-zinc-500 font-medium">
                            {players.length} {players.length === 1 ? 'Player' : 'Players'}
                        </span>
                    </div>
                </div>

                <div className="space-y-12">
                    {renderPlayerSection(keyPlayers, "Key Players", color)}
                    {renderPlayerSection(rolePlayers, "Role Players", color)}
                </div>
            </div>
        );
    };

    return (
        <div className="space-y-20">
            {renderTeamContainer(awayPlayers, match.awayTeam, colors.away)}

            {(awayPlayers.length > 0 && homePlayers.length > 0) && (
                <div className="relative py-4">
                    <div className="absolute inset-0 flex items-center">
                        <div className="w-full h-px bg-gradient-to-r from-transparent via-white/[0.05] to-transparent" />
                    </div>
                    <div className="relative flex justify-center">
                        <span className="px-6 bg-[#050505] text-[10px] font-black text-zinc-700 uppercase tracking-[0.3em]">vs</span>
                    </div>
                </div>
            )}

            {renderTeamContainer(homePlayers, match.homeTeam, colors.home)}
        </div>
    );
};

export const PropCard = ApplePlayerCard;
