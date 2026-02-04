// ============================================================================
// PropMarketListView.tsx
// ARCHITECTURE: "SOTA Production" • Apple/Google Quality Standards
// AESTHETIC: Porsche Luxury • Jony Ive Minimalism • Jobs Narrative
// ============================================================================

import React, {
    useMemo,
    useState,
    useCallback,
    memo,
    type FC,
} from 'react';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import { cn } from '../../lib/essence';
import { getPlayerStatValue } from './PlayerStatComponents';
import type { Match } from '../../types';

// ============================================================================
// 🎨 DESIGN TOKENS & PHYSICS
// ============================================================================

const PHYSICS_SWITCH = { type: "spring", stiffness: 380, damping: 35, mass: 0.8 };

const TOKENS = {
    z: {
        sticky: 30,
        categoryHeader: 20,
        teamLabel: 10,
    },
    sticky: {
        // Precise offsets to stack below MatchDetails header (approx 110px)
        nav: 'top-[112px] md:top-[132px]',
        categoryOpen: 'top-[168px] md:top-[188px]',
        teamLabel: 'top-[220px] md:top-[240px]',
    },
};

// ============================================================================
// 💎 MICRO-COMPONENTS (PURE GEOMETRY)
// ============================================================================

// Pure CSS Plus/Minus Toggle
const ToggleSwitch = ({ expanded }: { expanded: boolean }) => (
    <div className="relative w-2.5 h-2.5 flex items-center justify-center opacity-40 group-hover:opacity-100 transition-opacity duration-300">
        <span className={cn(
            "absolute w-full h-[1px] bg-white transition-transform duration-500 ease-[cubic-bezier(0.23,1,0.32,1)]",
            expanded ? "rotate-180" : "rotate-0"
        )} />
        <span className={cn(
            "absolute w-full h-[1px] bg-white transition-transform duration-500 ease-[cubic-bezier(0.23,1,0.32,1)]",
            expanded ? "rotate-180 opacity-0" : "rotate-90 opacity-100"
        )} />
    </div>
);

// High-Precision Progress Line
const PrecisionProgress = memo(({ progress, isHitting, color }: { progress: number; isHitting: boolean; color: string }) => (
    <div className="h-[2px] w-full bg-white/[0.06] mt-3 relative overflow-hidden">
        <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${Math.min(progress, 100)}%` }}
            transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }} // Custom easing
            className={cn(
                "absolute top-0 left-0 h-full transition-colors duration-500",
                isHitting ? "bg-white shadow-[0_0_8px_rgba(255,255,255,0.6)]" : "bg-zinc-500"
            )}
        />
        {/* Target Marker */}
        <div className="absolute right-0 top-1/2 -translate-y-1/2 w-[1px] h-2 bg-white/20" />
    </div>
));
PrecisionProgress.displayName = 'PrecisionProgress';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface Category {
    id: string;
    label: string;
    accent: string;
}

interface PlayerProp {
    betType: string;
    lineValue: number;
    oddsAmerican: number;
    side: 'OVER' | 'UNDER';
    playerName: string;
    headshotUrl?: string;
    team?: string;
}

interface GroupedPlayer {
    playerName: string;
    headshotUrl?: string;
    team: string;
    props: PlayerProp[];
}

interface Team {
    id: string;
    name: string;
    shortName?: string;
    abbreviation?: string;
    logo?: string;
    color?: string;
    side: 'HOME' | 'AWAY';
}

interface PropMarketListViewProps {
    match: Match;
}

// Local Type Supremacy: Handle dynamic props safely
interface ExtendedMatch extends Match {
    dbProps?: PlayerProp[];
}

// ============================================================================
// SPORT CONFIGURATION (Minimalist Colors)
// ============================================================================

const CATEGORIES_BY_SPORT: Record<string, Category[]> = {
    NBA: [
        { id: 'POINTS', label: 'POINTS', accent: 'text-amber-200' },
        { id: 'REBOUNDS', label: 'REBOUNDS', accent: 'text-emerald-200' },
        { id: 'ASSISTS', label: 'ASSISTS', accent: 'text-blue-200' },
        { id: 'THREES_MADE', label: '3PM', accent: 'text-purple-200' },
    ],
    NFL: [
        { id: 'PASSING_YARDS', label: 'PASS YDS', accent: 'text-blue-200' },
        { id: 'RUSHING_YARDS', label: 'RUSH YDS', accent: 'text-emerald-200' },
        { id: 'RECEIVING_YARDS', label: 'REC YDS', accent: 'text-amber-200' },
        { id: 'ANYTIME_TD', label: 'TDs', accent: 'text-rose-200' },
    ],
    MLB: [
        { id: 'STRIKEOUTS', label: 'Ks', accent: 'text-blue-200' },
        { id: 'HITS', label: 'HITS', accent: 'text-emerald-200' },
        { id: 'TOTAL_BASES', label: 'BASES', accent: 'text-amber-200' },
    ],
    NHL: [
        { id: 'GOALS', label: 'GOALS', accent: 'text-rose-200' },
        { id: 'ASSISTS', label: 'ASSISTS', accent: 'text-cyan-200' },
        { id: 'SHOTS_ON_GOAL', label: 'SHOTS', accent: 'text-zinc-200' },
    ],
    DEFAULT: [
        { id: 'POINTS', label: 'POINTS', accent: 'text-zinc-200' },
    ],
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function normalizeColor(color?: string): string {
    if (!color) return '#71717a';
    return color.startsWith('#') ? color : `#${color}`;
}

function getInitials(name: string): string {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

function formatOdds(odds: number): string {
    return odds > 0 ? `+${odds}` : String(odds);
}

function createPlayerKey(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ============================================================================
// PLAYER CARD (SPEC SHEET ROW)
// ============================================================================

interface PlayerCardProps {
    player: GroupedPlayer;
    match: Match;
    category: string;
    teamColor: string;
}

const PlayerCard: FC<PlayerCardProps> = memo(({ player, match, category, teamColor }) => {
    // 1. Data derivation
    const prop = useMemo(() =>
        player.props.find((p) => p.betType?.toUpperCase() === category) || player.props[0]
        , [player.props, category]);

    const liveValue = useMemo(() =>
        getPlayerStatValue(match, player.playerName, category)
        , [match, player.playerName, category]);

    if (!prop) return null;

    const displayLine = prop.lineValue;
    const hasLiveStats = liveValue !== null && liveValue !== undefined;
    const isHitting = hasLiveStats && Number(liveValue) >= Number(displayLine);
    const progress = hasLiveStats
        ? Math.min((Number(liveValue) / Number(displayLine)) * 100, 150)
        : 0;

    const initials = getInitials(player.playerName);
    const side = prop.side?.toUpperCase() || 'OVER';

    return (
        <motion.div
            layout
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="group relative py-4 px-2 transition-colors duration-300 hover:bg-white/[0.02] border-t border-white/[0.04] first:border-t-0"
        >
            {/* Active Laser Line (Left Edge) */}
            <div className={cn(
                "absolute left-0 top-0 bottom-0 w-[2px] bg-white scale-y-0 group-hover:scale-y-100 transition-transform duration-300 origin-center opacity-0 group-hover:opacity-100 shadow-[0_0_10px_rgba(255,255,255,0.4)]"
            )} />

            <div className="flex items-start gap-4">

                {/* 1. Identity Matrix */}
                <div className="flex items-center gap-3 min-w-0 flex-1">
                    {/* Minimalist Avatar */}
                    <div className="relative w-9 h-9 shrink-0 bg-zinc-900 border border-white/10 grayscale group-hover:grayscale-0 transition-all duration-500">
                        {player.headshotUrl ? (
                            <img src={player.headshotUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center text-[10px] font-mono text-zinc-500">
                                {initials}
                            </div>
                        )}
                        {/* Team Indicator Bar */}
                        <div className="absolute bottom-0 left-0 right-0 h-[2px]" style={{ backgroundColor: teamColor }} />
                    </div>

                    <div className="min-w-0 flex flex-col justify-center">
                        <span className="text-[13px] font-medium text-zinc-200 tracking-tight truncate group-hover:text-white transition-colors">
                            {player.playerName}
                        </span>
                        <div className="flex items-center gap-2">
                            <span className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest font-mono">
                                {side}
                            </span>
                            <span className="text-[9px] font-mono text-zinc-600 tabular-nums">
                                {formatOdds(prop.oddsAmerican)}
                            </span>
                        </div>
                    </div>
                </div>

                {/* 2. Telemetry */}
                <div className="text-right shrink-0">
                    <div className="flex flex-col items-end">
                        <span className="text-[20px] font-light text-white tabular-nums tracking-tighter leading-none">
                            {Number.isInteger(displayLine) ? displayLine : displayLine.toFixed(1)}
                        </span>
                        {hasLiveStats && (
                            <span className={cn(
                                "text-[10px] font-mono font-bold mt-1 tracking-wider tabular-nums",
                                isHitting ? "text-emerald-400" : "text-zinc-500"
                            )}>
                                {liveValue} ACT
                            </span>
                        )}
                    </div>
                </div>
            </div>

            {/* 3. Progress Line (Live Only) */}
            {hasLiveStats && (
                <PrecisionProgress progress={progress} isHitting={isHitting} color={teamColor} />
            )}
        </motion.div>
    );
});
PlayerCard.displayName = 'PlayerCard';

// ============================================================================
// CATEGORY CARD (SPEC SHEET ROW)
// ============================================================================

interface CategoryCardProps {
    category: Category;
    index: number;
    match: Match;
    activeTeamId: string;
    props: PlayerProp[];
    teams: Team[];
    defaultOpen: boolean;
}

const CategoryCard: FC<CategoryCardProps> = memo(({ category, index, match, activeTeamId, props, teams, defaultOpen }) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);
    const [showAll, setShowAll] = useState(false);

    // Filter Logic
    const { groupedPlayers, teamOrder, totalItems } = useMemo(() => {
        const catProps = props.filter((p) => p.betType?.toUpperCase() === category.id);
        const playerMap = new Map<string, GroupedPlayer>();

        catProps.forEach((prop) => {
            const key = createPlayerKey(prop.playerName);
            if (!playerMap.has(key)) {
                playerMap.set(key, { playerName: prop.playerName, headshotUrl: prop.headshotUrl, team: prop.team || 'Unknown', props: [] });
            }
            playerMap.get(key)!.props.push(prop);
        });

        const byTeam = new Map<string, GroupedPlayer[]>();
        Array.from(playerMap.values()).forEach((p) => {
            if (!byTeam.has(p.team)) byTeam.set(p.team, []);
            byTeam.get(p.team)!.push(p);
        });

        if (activeTeamId !== 'ALL') {
            const selectedName = teams.find((t) => t.id === activeTeamId)?.name;
            Array.from(byTeam.keys()).forEach((k) => { if (k !== selectedName) byTeam.delete(k); });
        }

        byTeam.forEach((list) => {
            list.sort((a, b) => parseFloat(String(b.props[0]?.lineValue || 0)) - parseFloat(String(a.props[0]?.lineValue || 0)));
        });

        const orderedTeams = Array.from(byTeam.keys()).sort((a, b) => {
            if (a === match.awayTeam?.name) return -1;
            if (b === match.awayTeam?.name) return 1;
            return 0;
        });

        return {
            groupedPlayers: byTeam,
            teamOrder: orderedTeams,
            totalItems: Array.from(byTeam.values()).reduce((acc, list) => acc + list.length, 0)
        };
    }, [props, category.id, activeTeamId, match, teams]);

    if (teamOrder.length === 0) return null;

    const threshold = activeTeamId === 'ALL' ? 8 : 6;
    const shouldShowButton = totalItems > threshold && !showAll;
    const remainingCount = totalItems - threshold;
    const formattedIndex = (index + 1).toString().padStart(2, '0');

    return (
        <div className="relative border-t border-white/[0.08]">
            {/* Active Laser (Vertical) */}
            <div className={cn(
                "absolute top-0 bottom-0 left-0 w-[2px] bg-white transition-all duration-500 ease-out z-10 shadow-[0_0_10px_rgba(255,255,255,0.4)]",
                isOpen ? "h-full opacity-100" : "h-0 opacity-0"
            )} />

            {/* Header */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={cn(
                    'w-full flex items-center justify-between py-6 group transition-all duration-300 px-4 md:px-0',
                    isOpen && `sticky ${TOKENS.sticky.categoryOpen} z-${TOKENS.z.categoryHeader} bg-[#050505]/95 backdrop-blur-xl border-b border-white/[0.08]`
                )}
            >
                <div className="flex items-center gap-4 pl-4">
                    <span className={cn(
                        "text-[10px] font-bold tracking-[0.2em] uppercase font-mono transition-colors duration-300",
                        isOpen ? "text-white" : "text-zinc-600 group-hover:text-zinc-400"
                    )}>
                        {formattedIndex} // {category.label}
                    </span>
                    {!isOpen && (
                        <span className="text-[9px] font-mono text-zinc-600 bg-white/5 px-1.5 py-0.5 rounded">
                            {totalItems}
                        </span>
                    )}
                </div>

                <div className="opacity-40 group-hover:opacity-100 transition-opacity pr-4 md:pr-0">
                    <ToggleSwitch expanded={isOpen} />
                </div>
            </button>

            {/* Drawer */}
            <AnimatePresence initial={false}>
                {isOpen && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={PHYSICS_SWITCH}
                        className="overflow-hidden"
                    >
                        <div className="pb-12 px-4 md:px-0">
                            <div className={cn(
                                "grid gap-x-16 gap-y-8",
                                activeTeamId === 'ALL' ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
                            )}>
                                {teamOrder.map((teamName) => {
                                    const players = groupedPlayers.get(teamName) || [];
                                    const visiblePlayers = showAll ? players : players.slice(0, activeTeamId === 'ALL' ? 4 : 6);
                                    const isHome = teamName === match.homeTeam?.name || teamName === match.homeTeam?.shortName;
                                    const isAway = teamName === match.awayTeam?.name || teamName === match.awayTeam?.shortName;
                                    const teamColor = isHome ? match.homeTeam?.color : isAway ? match.awayTeam?.color : '#fff';

                                    return (
                                        <div key={teamName} className="relative">
                                            {/* Sub-header */}
                                            <div className={cn(
                                                `sticky ${TOKENS.sticky.teamLabel} z-${TOKENS.z.teamLabel}`,
                                                "py-2 mb-2 bg-[#050505]/95 backdrop-blur-sm border-b border-white/[0.04] flex items-center justify-between"
                                            )}>
                                                <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-[0.2em] font-mono">
                                                    {teamName}
                                                </span>
                                                <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: normalizeColor(teamColor) }} />
                                            </div>

                                            <div className="space-y-0">
                                                {visiblePlayers.map((player) => (
                                                    <PlayerCard
                                                        key={player.playerName}
                                                        player={player}
                                                        match={match}
                                                        category={category.id}
                                                        teamColor={teamColor || '#fff'}
                                                    />
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {shouldShowButton && (
                                <div className="mt-8 flex justify-center">
                                    <button
                                        onClick={() => setShowAll(true)}
                                        className="px-6 py-2 border-b border-zinc-800 text-[9px] font-bold uppercase tracking-[0.2em] text-zinc-500 hover:text-white hover:border-zinc-500 transition-all duration-300"
                                    >
                                        Load Full Roster ({remainingCount}+)
                                    </button>
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
});
CategoryCard.displayName = 'CategoryCard';

// ============================================================================
// 🏛️ MAIN COMPONENT
// ============================================================================

export const PropMarketListView: FC<PropMarketListViewProps> = ({ match: rawMatch }) => {
    // Cast to ExtendedMatch for type safety
    const match = rawMatch as ExtendedMatch;
    const [activeTeamId, setActiveTeamId] = useState<'ALL' | string>('ALL');

    const categories = useMemo(() => {
        const sport = match.sport?.toUpperCase() || 'DEFAULT';
        return CATEGORIES_BY_SPORT[sport] || CATEGORIES_BY_SPORT['DEFAULT'];
    }, [match.sport]);

    const teams = useMemo<Team[]>(() => {
        const list: Team[] = [];
        if (match.awayTeam) list.push({ ...match.awayTeam, id: match.awayTeam.id || 'away', name: match.awayTeam.name || 'Away', side: 'AWAY' } as Team);
        if (match.homeTeam) list.push({ ...match.homeTeam, id: match.homeTeam.id || 'home', name: match.homeTeam.name || 'Home', side: 'HOME' } as Team);
        return list;
    }, [match.homeTeam, match.awayTeam]);

    const dbProps = match.dbProps || [];

    if (!dbProps.length) return (
        <div className="py-32 text-center border border-dashed border-zinc-800 rounded-xl opacity-50 mt-12 mx-4">
            <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-zinc-600">
                Market Data Unavailable
            </span>
        </div>
    );

    return (
        <div className="w-full min-h-[400px]">
            {/* Sticky Filter Deck */}
            <nav className={cn(
                `sticky ${TOKENS.sticky.nav} z-${TOKENS.z.sticky}`,
                "bg-[#050505]/95 backdrop-blur-xl border-b border-white/[0.06] py-3"
            )}>
                <div className="flex items-center justify-center gap-6 md:gap-12 px-4">
                    {/* Away */}
                    {teams.filter(t => t.side === 'AWAY').map(t => (
                        <button
                            key={t.id}
                            onClick={() => setActiveTeamId(t.id)}
                            className={cn(
                                "relative py-2 group outline-none transition-colors duration-300",
                                activeTeamId === t.id ? "text-white" : "text-zinc-600 hover:text-zinc-400"
                            )}
                        >
                            <span className="text-[10px] font-bold tracking-[0.2em] uppercase">
                                {t.abbreviation || t.shortName}
                            </span>
                            {activeTeamId === t.id && (
                                <motion.div layoutId="propFilter" className="absolute bottom-0 left-0 right-0 h-px bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)]" />
                            )}
                        </button>
                    ))}

                    {/* H2H */}
                    <button
                        onClick={() => setActiveTeamId('ALL')}
                        className={cn(
                            "relative py-2 group outline-none transition-colors duration-300",
                            activeTeamId === 'ALL' ? "text-white" : "text-zinc-600 hover:text-zinc-400"
                        )}
                    >
                        <span className="text-[10px] font-bold tracking-[0.2em] uppercase">ALL MARKETS</span>
                        {activeTeamId === 'ALL' && (
                            <motion.div layoutId="propFilter" className="absolute bottom-0 left-0 right-0 h-px bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)]" />
                        )}
                    </button>

                    {/* Home */}
                    {teams.filter(t => t.side === 'HOME').map(t => (
                        <button
                            key={t.id}
                            onClick={() => setActiveTeamId(t.id)}
                            className={cn(
                                "relative py-2 group outline-none transition-colors duration-300",
                                activeTeamId === t.id ? "text-white" : "text-zinc-600 hover:text-zinc-400"
                            )}
                        >
                            <span className="text-[10px] font-bold tracking-[0.2em] uppercase">
                                {t.abbreviation || t.shortName}
                            </span>
                            {activeTeamId === t.id && (
                                <motion.div layoutId="propFilter" className="absolute bottom-0 left-0 right-0 h-px bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)]" />
                            )}
                        </button>
                    ))}
                </div>
            </nav>

            {/* Spec Sheet Stacks */}
            <div className="pb-24 pt-4 px-1 md:px-0">
                <LayoutGroup>
                    {categories.map((cat, index) => (
                        <CategoryCard
                            key={cat.id}
                            index={index}
                            category={cat}
                            match={match}
                            activeTeamId={activeTeamId}
                            props={dbProps}
                            teams={teams}
                            defaultOpen={index === 0}
                        />
                    ))}
                </LayoutGroup>
                <div className="w-full h-px bg-white/[0.08] mt-8" />
            </div>
        </div>
    );
};

export default PropMarketListView;
