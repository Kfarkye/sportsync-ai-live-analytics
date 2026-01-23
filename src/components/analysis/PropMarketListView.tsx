/* ============================================================================
   PropMarketListView.tsx
   Player Props Market Interface — Internal Systems Grade
   
   Architecture:
   ├─ Sport-adaptive category system with semantic color mapping
   ├─ Dual-mode display: H2H comparison vs. single-team focus
   ├─ Real-time progress tracking with animated indicators
   ├─ Collapsible sections with sticky headers for scroll context
   └─ Responsive grid layouts optimized for mobile-first
   
   Performance:
   ├─ Memoized category filtering and player grouping
   ├─ Virtualization-ready data structures
   ├─ Optimized re-render boundaries via memo()
   └─ Layout animations using transform (GPU-accelerated)
============================================================================ */

import React, {
    useMemo,
    useState,
    useCallback,
    memo,
    type FC,
} from 'react';
import { motion, AnimatePresence, type Transition } from 'framer-motion';
import { TrendingUp, ChevronDown, User } from 'lucide-react';
import { cn } from '../../lib/essence';
import { getPlayerStatValue } from './PlayerStatComponents';
import type { Match } from '../../types';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface Category {
    id: string;
    label: string;
    color: string;
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

interface CategoryCardProps {
    category: Category;
    match: Match;
    activeTeamId: string;
    props: PlayerProp[];
    teams: Team[];
    defaultOpen: boolean;
}

interface PolishedPlayerCardProps {
    player: GroupedPlayer;
    match: Match;
    category: string;
    teamColor: string;
    isComparison?: boolean;
}

// ============================================================================
// DESIGN TOKENS
// ============================================================================

const tokens = {
    // Animation presets
    spring: {
        snappy: { type: 'spring', stiffness: 400, damping: 30 } as Transition,
        gentle: { type: 'spring', stiffness: 280, damping: 26 } as Transition,
        smooth: { duration: 0.4, ease: [0.32, 0.72, 0, 1] } as Transition,
    },

    // Z-index layers
    z: {
        sticky: 30,
        categoryHeader: 20,
        teamLabel: 10,
    },

    // Sticky positions (cascading)
    sticky: {
        nav: 'top-[186px]',
        categoryOpen: 'top-[234px]',
        teamLabel: 'top-[278px]',
    },
} as const;

// ============================================================================
// SPORT CATEGORY CONFIGURATION
// ============================================================================

const CATEGORIES_BY_SPORT: Record<string, Category[]> = {
    // Basketball
    NBA: [
        { id: 'POINTS', label: 'Points', color: 'from-amber-500 to-orange-600' },
        { id: 'REBOUNDS', label: 'Rebounds', color: 'from-emerald-500 to-teal-600' },
        { id: 'ASSISTS', label: 'Assists', color: 'from-cyan-500 to-blue-600' },
        { id: 'THREES_MADE', label: '3-PT Made', color: 'from-violet-500 to-purple-600' },
    ],
    WNBA: [
        { id: 'POINTS', label: 'Points', color: 'from-amber-500 to-orange-600' },
        { id: 'REBOUNDS', label: 'Rebounds', color: 'from-emerald-500 to-teal-600' },
        { id: 'ASSISTS', label: 'Assists', color: 'from-cyan-500 to-blue-600' },
    ],
    COLLEGE_BASKETBALL: [
        { id: 'POINTS', label: 'Points', color: 'from-amber-500 to-orange-600' },
        { id: 'REBOUNDS', label: 'Rebounds', color: 'from-emerald-500 to-teal-600' },
        { id: 'ASSISTS', label: 'Assists', color: 'from-cyan-500 to-blue-600' },
    ],

    // Hockey
    NHL: [
        { id: 'GOALS', label: 'Goals', color: 'from-rose-500 to-red-600' },
        { id: 'ASSISTS', label: 'Assists', color: 'from-cyan-500 to-blue-600' },
        { id: 'SHOTS_ON_GOAL', label: 'Shots on Goal', color: 'from-zinc-500 to-slate-600' },
        { id: 'POINTS', label: 'Total Points', color: 'from-amber-500 to-orange-600' },
    ],
    HOCKEY: [
        { id: 'GOALS', label: 'Goals', color: 'from-rose-500 to-red-600' },
        { id: 'ASSISTS', label: 'Assists', color: 'from-cyan-500 to-blue-600' },
        { id: 'SHOTS_ON_GOAL', label: 'Shots on Goal', color: 'from-zinc-500 to-slate-600' },
        { id: 'POINTS', label: 'Total Points', color: 'from-amber-500 to-orange-600' },
    ],

    // Football
    NFL: [
        { id: 'PASSING_YARDS', label: 'Pass Yds', color: 'from-blue-500 to-indigo-600' },
        { id: 'RUSHING_YARDS', label: 'Rush Yds', color: 'from-emerald-500 to-teal-600' },
        { id: 'RECEIVING_YARDS', label: 'Rec Yds', color: 'from-amber-500 to-orange-600' },
        { id: 'ANYTIME_TD', label: 'Touchdowns', color: 'from-rose-500 to-red-600' },
    ],
    FOOTBALL: [
        { id: 'PASSING_YARDS', label: 'Pass Yds', color: 'from-blue-500 to-indigo-600' },
        { id: 'RUSHING_YARDS', label: 'Rush Yds', color: 'from-emerald-500 to-teal-600' },
        { id: 'RECEIVING_YARDS', label: 'Rec Yds', color: 'from-amber-500 to-orange-600' },
        { id: 'ANYTIME_TD', label: 'Touchdowns', color: 'from-rose-500 to-red-600' },
    ],
    COLLEGE_FOOTBALL: [
        { id: 'PASSING_YARDS', label: 'Pass Yds', color: 'from-blue-500 to-indigo-600' },
        { id: 'RUSHING_YARDS', label: 'Rush Yds', color: 'from-emerald-500 to-teal-600' },
        { id: 'RECEIVING_YARDS', label: 'Rec Yds', color: 'from-amber-500 to-orange-600' },
        { id: 'ANYTIME_TD', label: 'Touchdowns', color: 'from-rose-500 to-red-600' },
    ],

    // Baseball
    MLB: [
        { id: 'STRIKEOUTS', label: 'Strikeouts', color: 'from-blue-500 to-indigo-600' },
        { id: 'HITS', label: 'Hits', color: 'from-emerald-500 to-teal-600' },
        { id: 'TOTAL_BASES', label: 'Total Bases', color: 'from-amber-500 to-orange-600' },
    ],
    BASEBALL: [
        { id: 'STRIKEOUTS', label: 'Strikeouts', color: 'from-blue-500 to-indigo-600' },
        { id: 'HITS', label: 'Hits', color: 'from-emerald-500 to-teal-600' },
        { id: 'TOTAL_BASES', label: 'Total Bases', color: 'from-amber-500 to-orange-600' },
    ],

    // Soccer
    SOCCER: [
        { id: 'GOALS', label: 'Goals', color: 'from-rose-500 to-red-600' },
        { id: 'ASSISTS', label: 'Assists', color: 'from-cyan-500 to-blue-600' },
        { id: 'SHOTS_ON_GOAL', label: 'Shots', color: 'from-zinc-500 to-slate-600' },
    ],

    // Fallback
    DEFAULT: [
        { id: 'POINTS', label: 'Points', color: 'from-amber-500 to-orange-600' },
    ],
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Normalizes team color to hex format
 */
function normalizeColor(color?: string): string {
    if (!color) return '#6366f1';
    return color.startsWith('#') ? color : `#${color}`;
}

/**
 * Extracts initials from player name
 */
function getInitials(name: string): string {
    return name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
}

/**
 * Formats line value for display
 */
function formatLine(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * Formats odds for display
 */
function formatOdds(odds: number): string {
    return odds > 0 ? `+${odds}` : String(odds);
}

/**
 * Creates a normalized key for player deduplication
 */
function createPlayerKey(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ============================================================================
// SUBCOMPONENTS
// ============================================================================

/**
 * Progress bar with animated fill
 */
interface ProgressBarProps {
    progress: number;
    isHitting: boolean;
}

const ProgressBar: FC<ProgressBarProps> = memo(({ progress, isHitting }) => (
    <div className="h-1 w-full bg-zinc-800/40 rounded-full overflow-hidden">
        <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${Math.min(progress, 100)}%` }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            className={cn(
                'h-full rounded-full',
                isHitting ? 'bg-emerald-500' : 'bg-zinc-600'
            )}
        />
    </div>
));

ProgressBar.displayName = 'ProgressBar';

/**
 * Player avatar with team color accent
 */
interface PlayerAvatarProps {
    headshotUrl?: string;
    initials: string;
    teamColor: string;
}

const PlayerAvatar: FC<PlayerAvatarProps> = memo(({ headshotUrl, initials, teamColor }) => (
    <div className="relative w-10 h-10 rounded-xl overflow-hidden bg-zinc-900 shrink-0 border border-white/[0.05]">
        {headshotUrl ? (
            <img
                src={headshotUrl}
                alt=""
                className="w-full h-full object-cover object-top"
                loading="lazy"
            />
        ) : (
            <div className="w-full h-full flex items-center justify-center">
                <span className="text-[10px] font-bold text-zinc-500">{initials}</span>
            </div>
        )}
        <div
            className="absolute bottom-0 left-0 right-0 h-0.5"
            style={{ backgroundColor: teamColor }}
            aria-hidden="true"
        />
    </div>
));

PlayerAvatar.displayName = 'PlayerAvatar';

/**
 * Team filter button
 */
interface TeamButtonProps {
    team: Team;
    isActive: boolean;
    onClick: () => void;
}

const TeamButton: FC<TeamButtonProps> = memo(({ team, isActive, onClick }) => (
    <button
        onClick={onClick}
        className={cn(
            'relative flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all duration-300',
            isActive
                ? 'bg-white/10 text-white'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5'
        )}
        aria-pressed={isActive}
    >
        {team.logo && (
            <img
                src={team.logo}
                alt=""
                className={cn(
                    'w-4 h-4 sm:w-5 sm:h-5 object-contain transition-all duration-300',
                    isActive ? 'opacity-100 scale-110' : 'opacity-40 grayscale'
                )}
            />
        )}
        <span className="text-[12px] sm:text-[14px] font-bold tracking-tight hidden xs:inline">
            {team.abbreviation || team.shortName || team.name}
        </span>
    </button>
));

TeamButton.displayName = 'TeamButton';

/**
 * Show more button
 */
interface ShowMoreButtonProps {
    count: number;
    onClick: () => void;
}

const ShowMoreButton: FC<ShowMoreButtonProps> = memo(({ count, onClick }) => (
    <div className="mt-6 flex justify-center">
        <button
            onClick={onClick}
            className={cn(
                'group flex items-center gap-2 px-6 py-2.5 rounded-full',
                'bg-emerald-500/10 border border-emerald-500/20',
                'hover:bg-emerald-500/20 hover:border-emerald-500/30',
                'transition-all duration-200'
            )}
        >
            <span
                className={cn(
                    'text-[10px] font-bold uppercase tracking-[0.15em]',
                    'text-emerald-400 group-hover:text-emerald-300',
                    'transition-colors'
                )}
            >
                +{count} More
            </span>
        </button>
    </div>
));

ShowMoreButton.displayName = 'ShowMoreButton';

// ============================================================================
// PLAYER CARD COMPONENT
// ============================================================================

const PolishedPlayerCard: FC<PolishedPlayerCardProps> = memo(
    ({ player, match, category, teamColor }) => {
        // Find the relevant prop for this category
        const prop = useMemo(() => {
            return (
                player.props.find((p) => p.betType?.toUpperCase() === category) ||
                player.props[0]
            );
        }, [player.props, category]);

        // Get live stat value
        const liveValue = useMemo(
            () => getPlayerStatValue(match, player.playerName, category),
            [match, player.playerName, category]
        );

        if (!prop) return null;

        const displayLine = prop.lineValue;
        const hasLiveStats = liveValue !== null && liveValue !== undefined;
        const isHitting = hasLiveStats && Number(liveValue) >= Number(displayLine);
        const progress = hasLiveStats
            ? Math.min((Number(liveValue) / Number(displayLine)) * 100, 150)
            : 0;

        const color = normalizeColor(teamColor);
        const initials = getInitials(player.playerName);
        const odds = prop.oddsAmerican;
        const side = prop.side?.toUpperCase() || 'OVER';

        return (
            <motion.article
                layout
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
                className="group relative pt-5 pb-4 border-b border-white/[0.04] last:border-b-0"
            >
                {/* Top Row: Identity & Line */}
                <div className="flex items-start justify-between gap-4">
                    {/* Player Identity */}
                    <div className="flex items-center gap-3 min-w-0">
                        <PlayerAvatar
                            headshotUrl={player.headshotUrl}
                            initials={initials}
                            teamColor={color}
                        />

                        <div className="min-w-0">
                            <h4 className="text-[13px] sm:text-[14px] font-bold text-white tracking-tight leading-none mb-1 whitespace-normal break-words">
                                {player.playerName}
                            </h4>
                        </div>
                    </div>

                    {/* Line Display */}
                    <div className="flex flex-col items-end shrink-0">
                        <span className="text-[9px] font-black text-zinc-600 uppercase tracking-widest mb-1 leading-none">
                            Line
                        </span>
                        <div className="flex items-baseline gap-1.5">
                            <span className="text-[20px] sm:text-[24px] font-black text-white tabular-nums leading-none tracking-tighter">
                                {formatLine(displayLine)}
                            </span>
                            <span className="text-[10px] font-bold text-zinc-500 tabular-nums">
                                {side === 'OVER' ? 'O' : 'U'} {formatOdds(odds)}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Bottom Row: Live Progress (only if live) */}
                {hasLiveStats && (
                    <div className="mt-4 flex items-center gap-4">
                        {/* Progress Bar */}
                        <div className="flex-1 max-w-[120px]">
                            <span className="text-[9px] font-black text-zinc-600 uppercase tracking-widest mb-1.5 leading-none block">
                                Live Progress
                            </span>
                            <ProgressBar progress={progress} isHitting={isHitting} />
                        </div>

                        {/* Live Value */}
                        <div className="flex items-baseline gap-2 ml-auto">
                            <span className="text-[9px] font-black text-zinc-600 uppercase tracking-widest leading-none">
                                Live
                            </span>
                            <div
                                className={cn(
                                    'text-[20px] font-black tabular-nums leading-none flex items-center gap-1',
                                    isHitting ? 'text-emerald-400' : 'text-zinc-500'
                                )}
                            >
                                {isHitting && (
                                    <TrendingUp size={12} strokeWidth={3} aria-hidden="true" />
                                )}
                                <span aria-label={`Current value: ${liveValue}`}>{liveValue}</span>
                            </div>
                        </div>
                    </div>
                )}
            </motion.article>
        );
    }
);

PolishedPlayerCard.displayName = 'PolishedPlayerCard';

// ============================================================================
// CATEGORY CARD COMPONENT
// ============================================================================

const CategoryCard: FC<CategoryCardProps> = memo(
    ({ category, match, activeTeamId, props, teams, defaultOpen }) => {
        const [isOpen, setIsOpen] = useState(defaultOpen);
        const [showAll, setShowAll] = useState(false);

        // Toggle handler
        const handleToggle = useCallback(() => {
            setIsOpen((prev) => !prev);
        }, []);

        // Show all handler
        const handleShowAll = useCallback(() => {
            setShowAll(true);
        }, []);

        // Filter props for this category
        const categoryProps = useMemo(() => {
            return props.filter((p) => p.betType?.toUpperCase() === category.id);
        }, [props, category.id]);

        // Group players by team and sort
        const { groupedPlayers, teamOrder, totalItems } = useMemo(() => {
            // Build player map (deduplicated)
            const playerMap = new Map<string, GroupedPlayer>();

            categoryProps.forEach((prop) => {
                const key = createPlayerKey(prop.playerName);
                if (!playerMap.has(key)) {
                    playerMap.set(key, {
                        playerName: prop.playerName,
                        headshotUrl: prop.headshotUrl,
                        team: prop.team || 'Unknown',
                        props: [],
                    });
                }
                playerMap.get(key)!.props.push(prop);
            });

            // Group by team
            const byTeam = new Map<string, GroupedPlayer[]>();
            const players = Array.from(playerMap.values());

            players.forEach((p) => {
                if (!byTeam.has(p.team)) {
                    byTeam.set(p.team, []);
                }
                byTeam.get(p.team)!.push(p);
            });

            // Filter by selected team if not ALL
            if (activeTeamId !== 'ALL') {
                const selectedTeamName = teams.find((t) => t.id === activeTeamId)?.name;
                const keys = Array.from(byTeam.keys());
                keys.forEach((k) => {
                    if (k !== selectedTeamName) {
                        byTeam.delete(k);
                    }
                });
            }

            // Sort players within each team by line value (descending)
            byTeam.forEach((list) => {
                list.sort((a, b) => {
                    const valA = parseFloat(String(a.props[0]?.lineValue || 0));
                    const valB = parseFloat(String(b.props[0]?.lineValue || 0));
                    return valB - valA;
                });
            });

            // Order teams (away first, then home)
            const teamsPresent = Array.from(byTeam.keys());
            const homeTeam = match.homeTeam?.name;
            const awayTeam = match.awayTeam?.name;

            const orderedTeams = teamsPresent.sort((a, b) => {
                if (a === awayTeam) return -1;
                if (b === awayTeam) return 1;
                if (a === homeTeam) return -1;
                if (b === homeTeam) return 1;
                return a.localeCompare(b);
            });

            // Calculate total items
            const total = Array.from(byTeam.values()).reduce(
                (acc, list) => acc + list.length,
                0
            );

            return {
                groupedPlayers: byTeam,
                teamOrder: orderedTeams,
                totalItems: total,
            };
        }, [categoryProps, activeTeamId, match.homeTeam?.name, match.awayTeam?.name, teams]);

        // Don't render if no players
        if (teamOrder.length === 0) return null;

        // Determine threshold and whether to show button
        const threshold = activeTeamId === 'ALL' ? 8 : 6;
        const shouldShowButton = totalItems > threshold && !showAll;
        const remainingCount = totalItems - threshold;

        // Get players for a team (with optional limit)
        const getPlayersForTeam = (teamName: string, limit?: number) => {
            const players = groupedPlayers.get(teamName) || [];
            return limit ? players.slice(0, limit) : players;
        };

        // Find team by name (handles both name and shortName)
        const findTeamName = (matchTeam?: { name?: string; shortName?: string }) => {
            if (!matchTeam) return '';
            return teamOrder.find(
                (name) => name === matchTeam.name || name === matchTeam.shortName
            ) || '';
        };

        return (
            <section className="overflow-hidden" aria-labelledby={`category-${category.id}`}>
                {/* Header Toggle */}
                <button
                    id={`category-${category.id}`}
                    onClick={handleToggle}
                    aria-expanded={isOpen}
                    aria-controls={`category-content-${category.id}`}
                    className={cn(
                        'w-full flex items-center justify-between py-4 group transition-all duration-300',
                        'border-b border-white/[0.04]',
                        isOpen && `sticky ${tokens.sticky.categoryOpen} z-${tokens.z.categoryHeader} bg-[#050505]/98 backdrop-blur-xl px-1`
                    )}
                >
                    <div className="flex items-center gap-2">
                        <div
                            className={cn(
                                'w-1.5 h-1.5 rounded-full transition-all duration-300',
                                isOpen ? 'bg-white' : 'bg-zinc-700'
                            )}
                            aria-hidden="true"
                        />
                        <span
                            className={cn(
                                'text-[11px] font-bold uppercase tracking-[0.15em] transition-colors duration-200',
                                isOpen ? 'text-white' : 'text-zinc-500'
                            )}
                        >
                            {category.label}
                        </span>
                        {!isOpen && (
                            <span className="text-[10px] text-zinc-600 font-mono ml-1.5">
                                {totalItems}
                            </span>
                        )}
                    </div>

                    <ChevronDown
                        size={12}
                        strokeWidth={2}
                        className={cn(
                            'text-zinc-600 transition-transform duration-300',
                            isOpen && 'rotate-180 text-zinc-400'
                        )}
                        aria-hidden="true"
                    />
                </button>

                {/* Collapsible Content */}
                <AnimatePresence initial={false}>
                    {isOpen && (
                        <motion.div
                            id={`category-content-${category.id}`}
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={tokens.spring.smooth}
                        >
                            <div className="pb-8">
                                {activeTeamId === 'ALL' ? (
                                    /* H2H Mode - Two columns on desktop */
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-2 px-1">
                                        {/* Away Team Column */}
                                        <div className="space-y-0 relative">
                                            <div
                                                className={cn(
                                                    `sticky ${tokens.sticky.teamLabel} z-${tokens.z.teamLabel}`,
                                                    'py-1.5 mb-2 bg-[#080808]/95 backdrop-blur-sm',
                                                    'border-b border-white/[0.02]'
                                                )}
                                            >
                                                <span className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.2em]">
                                                    {match.awayTeam?.shortName || match.awayTeam?.name}
                                                </span>
                                            </div>
                                            {getPlayersForTeam(findTeamName(match.awayTeam), showAll ? undefined : 4).map(
                                                (player) => (
                                                    <PolishedPlayerCard
                                                        key={player.playerName}
                                                        player={player}
                                                        match={match}
                                                        category={category.id}
                                                        teamColor={match.awayTeam?.color || 'fff'}
                                                        isComparison
                                                    />
                                                )
                                            )}
                                        </div>

                                        {/* Home Team Column */}
                                        <div className="space-y-0 relative mt-8 md:mt-0">
                                            <div
                                                className={cn(
                                                    `sticky ${tokens.sticky.teamLabel} z-${tokens.z.teamLabel}`,
                                                    'py-1.5 mb-2 bg-[#080808]/95 backdrop-blur-sm',
                                                    'border-b border-white/[0.02]'
                                                )}
                                            >
                                                <span className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.2em]">
                                                    {match.homeTeam?.shortName || match.homeTeam?.name}
                                                </span>
                                            </div>
                                            {getPlayersForTeam(findTeamName(match.homeTeam), showAll ? undefined : 4).map(
                                                (player) => (
                                                    <PolishedPlayerCard
                                                        key={player.playerName}
                                                        player={player}
                                                        match={match}
                                                        category={category.id}
                                                        teamColor={match.homeTeam?.color || 'fff'}
                                                        isComparison
                                                    />
                                                )
                                            )}
                                        </div>
                                    </div>
                                ) : (
                                    /* Single Team Mode - Responsive grid */
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-12 gap-y-2 px-1">
                                        {teamOrder.map((teamName) => {
                                            const players = getPlayersForTeam(teamName, showAll ? undefined : 6);
                                            const isHome =
                                                teamName === match.homeTeam?.name ||
                                                teamName === match.homeTeam?.shortName;
                                            const isAway =
                                                teamName === match.awayTeam?.name ||
                                                teamName === match.awayTeam?.shortName;
                                            const teamColor = isHome
                                                ? match.homeTeam?.color
                                                : isAway
                                                    ? match.awayTeam?.color
                                                    : 'fff';

                                            return (
                                                <React.Fragment key={teamName}>
                                                    {players.map((player) => (
                                                        <PolishedPlayerCard
                                                            key={player.playerName}
                                                            player={player}
                                                            match={match}
                                                            category={category.id}
                                                            teamColor={teamColor || 'fff'}
                                                        />
                                                    ))}
                                                </React.Fragment>
                                            );
                                        })}
                                    </div>
                                )}

                                {/* Show More Button */}
                                {shouldShowButton && (
                                    <ShowMoreButton count={remainingCount} onClick={handleShowAll} />
                                )}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </section>
        );
    }
);

CategoryCard.displayName = 'CategoryCard';

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const PropMarketListView: FC<PropMarketListViewProps> = ({ match }) => {
    const [activeTeamId, setActiveTeamId] = useState<'ALL' | string>('ALL');

    // Get categories for this sport
    const categories = useMemo(() => {
        const sport = match.sport?.toUpperCase() || 'DEFAULT';
        return CATEGORIES_BY_SPORT[sport] || CATEGORIES_BY_SPORT['DEFAULT'];
    }, [match.sport]);

    // Build teams list
    const teams = useMemo<Team[]>(() => {
        const list: Team[] = [];
        if (match.awayTeam) {
            list.push({
                ...match.awayTeam,
                id: match.awayTeam.id || 'away',
                name: match.awayTeam.name || 'Away',
                side: 'AWAY',
            } as Team);
        }
        if (match.homeTeam) {
            list.push({
                ...match.homeTeam,
                id: match.homeTeam.id || 'home',
                name: match.homeTeam.name || 'Home',
                side: 'HOME',
            } as Team);
        }
        return list;
    }, [match.homeTeam, match.awayTeam]);

    // Get props data
    const dbProps = (match.dbProps || []) as PlayerProp[];

    // Team filter handlers
    const handleTeamSelect = useCallback((teamId: string) => {
        setActiveTeamId(teamId);
    }, []);

    const handleAllSelect = useCallback(() => {
        setActiveTeamId('ALL');
    }, []);

    // Split teams by side
    const awayTeams = useMemo(() => teams.filter((t) => t.side === 'AWAY'), [teams]);
    const homeTeams = useMemo(() => teams.filter((t) => t.side === 'HOME'), [teams]);

    return (
        <div className="w-full min-h-[400px]">
            {/* Sticky Navigation */}
            <nav
                className={cn(
                    `sticky ${tokens.sticky.nav} z-${tokens.z.sticky}`,
                    'bg-[#050505]/98 backdrop-blur-xl',
                    'border-b border-white/[0.06] shadow-2xl py-2'
                )}
                aria-label="Team filter"
            >
                <div className="flex items-center justify-center px-6 h-10 gap-4 sm:gap-8">
                    {/* Away Team(s) */}
                    {awayTeams.map((team) => (
                        <TeamButton
                            key={team.id}
                            team={team}
                            isActive={activeTeamId === team.id}
                            onClick={() => handleTeamSelect(team.id)}
                        />
                    ))}

                    {/* H2H Toggle */}
                    <button
                        onClick={handleAllSelect}
                        aria-pressed={activeTeamId === 'ALL'}
                        className={cn(
                            'relative flex items-center px-4 py-1.5 rounded-lg transition-all duration-300',
                            activeTeamId === 'ALL'
                                ? 'bg-white/10 text-white'
                                : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5'
                        )}
                    >
                        <span className="text-[11px] sm:text-[13px] font-black tracking-[0.1em] uppercase">
                            H2H
                        </span>
                    </button>

                    {/* Home Team(s) */}
                    {homeTeams.map((team) => (
                        <TeamButton
                            key={team.id}
                            team={team}
                            isActive={activeTeamId === team.id}
                            onClick={() => handleTeamSelect(team.id)}
                        />
                    ))}
                </div>
            </nav>

            {/* Category Cards */}
            <div className="py-2 pb-24 space-y-px">
                {categories.map((cat, index) => (
                    <CategoryCard
                        key={cat.id}
                        category={cat}
                        match={match}
                        activeTeamId={activeTeamId}
                        props={dbProps}
                        teams={teams}
                        defaultOpen={index === 0}
                    />
                ))}
            </div>
        </div>
    );
};

export default PropMarketListView;
