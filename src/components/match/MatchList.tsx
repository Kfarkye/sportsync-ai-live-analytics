// ═══════════════════════════════════════════════════════════════════════════════
// MatchList.tsx — ESSENCE v13 · Cupertino Glass × Financial Terminal
//
// DESIGN PHILOSOPHY:
//   · Jony Ive   → Hardware-like continuous curves, diffuse shadows, fluid spring 
//                  physics, frosted glass, and absolute typographic hierarchy.
//   · Kalshi     → Data-dense binary market blocks. Match probabilities are 
//                  visualized as executable contracts rather than passive text.
//   · Production → Memoized components, framer-motion orchestration, zero-jank 
//                  hardware-accelerated layout transitions.
// ═══════════════════════════════════════════════════════════════════════════════

import React, { useMemo, memo } from 'react';
import { Match, MatchStatus } from '@/types';
import { LEAGUES } from '@/constants';
import MatchRow from './MatchRow';
import TeamLogo from '../shared/TeamLogo';
import { LayoutGroup, motion, AnimatePresence } from 'framer-motion';
import { getPeriodDisplay } from '../../utils/matchUtils';
import { useAppStore } from '../../store/appStore';
import { ESSENCE } from '@/lib/essence';

// ─── Animation Physics ───────────────────────────────────────────────────────
const SPRING_CONFIG = { type: 'spring', bounce: 0, duration: 0.4 };
const MotionDiv = motion.div;

interface MatchListProps {
    matches: Match[];
    onSelectMatch: (match: Match) => void;
    isLoading: boolean;
    pinnedMatchIds: ReadonlySet<string>;
    onTogglePin: (id: string, e: React.MouseEvent | React.KeyboardEvent) => void;
    isMatchLive: (match: Match) => boolean;
    isMatchFinal: (match: Match) => boolean;
    onOpenPricing: () => void;
}

// ─── Skeleton (Fluid Shimmer) ────────────────────────────────────────────────
const RowSkeleton: React.FC = memo(() => (
    <div
        className="flex items-center h-[68px] px-5 border-b last:border-b-0 relative overflow-hidden"
        style={{ borderColor: ESSENCE.colors.border.ghost, backgroundColor: ESSENCE.colors.surface.pure }}
    >
        <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-slate-200/40 to-transparent z-10" />
        <div className="flex flex-col gap-2.5 flex-1 opacity-40">
            <div className="flex items-center gap-3">
                <div className="w-5 h-5 rounded-full bg-slate-300" />
                <div className="h-2.5 w-28 rounded-full bg-slate-300" />
            </div>
            <div className="flex items-center gap-3">
                <div className="w-5 h-5 rounded-full bg-slate-300" />
                <div className="h-2.5 w-24 rounded-full bg-slate-300" />
            </div>
        </div>
        <div className="w-16 h-4 rounded-full bg-slate-300 opacity-40" />
    </div>
));
RowSkeleton.displayName = 'RowSkeleton';

// ─── Featured Hero Components ────────────────────────────────────────────────

const TeamMarketBlock = memo(({
    team, prob, isFav
}: {
    team: Match['homeTeam']; prob?: number; isFav: boolean
}) => {
    const teamName = team.abbreviation || team.shortName || team.name.substring(0, 3).toUpperCase();

    return (
        <div className="flex flex-col items-center gap-2.5 flex-1 min-w-0">
            <TeamLogo logo={team.logo} name={team.name} className="w-12 h-12 object-contain drop-shadow-sm" />
            <span
                className="text-[12px] font-semibold tracking-[-0.01em] text-center truncate w-full"
                style={{ color: ESSENCE.colors.text.primary }}
                title={team.name}
            >
                {teamName}
            </span>
            {prob !== undefined && prob > 0 && (
                <span
                    className="text-[11px] font-bold tabular-nums px-2.5 py-1 rounded-md transition-colors w-full text-center"
                    style={{
                        color: isFav ? ESSENCE.colors.accent.emerald : ESSENCE.colors.text.tertiary,
                        border: `1px solid ${isFav ? 'rgba(16,185,129,0.25)' : ESSENCE.colors.border.ghost}`,
                        backgroundColor: isFav ? 'rgba(16,185,129,0.06)' : 'transparent',
                    }}
                >
                    {Math.round(prob)}%
                </span>
            )}
        </div>
    );
});
TeamMarketBlock.displayName = 'TeamMarketBlock';

const FeaturedHero: React.FC<{
    match: Match;
    onClick: () => void;
    isLive: boolean;
}> = memo(({ match, onClick, isLive }) => {
    const homeProb = match.predictor?.homeTeamChance ?? match.win_probability?.home;
    const awayProb = match.predictor?.awayTeamChance ?? match.win_probability?.away;
    const homeFav = (homeProb ?? 0) >= (awayProb ?? 0);

    return (
        <motion.div
            role="button"
            tabIndex={0}
            onClick={onClick}
            whileHover={{ y: -2, scale: 0.99 }}
            whileTap={{ scale: 0.97 }}
            transition={SPRING_CONFIG}
            className="relative overflow-hidden cursor-pointer group"
            style={{
                borderRadius: 24, // Continuous Squircle
                border: `1px solid ${ESSENCE.colors.border.default}`,
                backgroundColor: ESSENCE.colors.surface.pure,
                boxShadow: `0 8px 32px rgba(0,0,0,0.04), 0 2px 8px rgba(0,0,0,0.02)`,
            }}
        >
            {/* Live ambient gradient glow */}
            <AnimatePresence>
                {isLive && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 0.5 }}
                        exit={{ opacity: 0 }}
                        className="absolute top-0 inset-x-0 h-[3px]"
                        style={{ background: `linear-gradient(90deg, transparent, ${ESSENCE.colors.accent.rose} 20%, ${ESSENCE.colors.accent.rose} 80%, transparent)` }}
                    />
                )}
            </AnimatePresence>

            <div className="p-5">
                {/* Status Header */}
                <div className="flex items-center justify-between mb-5">
                    {isLive ? (
                        <div className="flex items-center gap-1.5 bg-red-50/80 backdrop-blur-sm px-2 py-0.5 rounded-md border border-red-100">
                            <span className="relative flex h-1.5 w-1.5 items-center justify-center">
                                <motion.span
                                    animate={{ scale: [1, 2.5], opacity: [0.6, 0] }}
                                    transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
                                    className="absolute inset-0 rounded-full bg-red-500"
                                />
                                <span className="relative rounded-full h-1.5 w-1.5 bg-red-600" />
                            </span>
                            <span className="text-[10px] font-bold text-red-600 uppercase tracking-[0.1em]">Live</span>
                        </div>
                    ) : (
                        <span
                            className="text-[11px] font-medium tracking-wide tabular-nums"
                            style={{ color: ESSENCE.colors.text.secondary }}
                        >
                            {new Date(match.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                        </span>
                    )}
                    <span
                        className="text-[10px] font-bold uppercase tracking-[0.15em]"
                        style={{ color: ESSENCE.colors.text.muted }}
                    >
                        {match.leagueId?.toUpperCase() || match.sport}
                    </span>
                </div>

                {/* Matchup Data Visualization */}
                <div className="flex items-center justify-between gap-4">
                    <TeamMarketBlock team={match.awayTeam} prob={awayProb} isFav={!homeFav} />

                    <div className="flex flex-col items-center shrink-0 px-2">
                        {isLive || match.homeScore > 0 || match.awayScore > 0 ? (
                            <div className="flex items-baseline gap-2.5">
                                <span
                                    className="text-3xl font-semibold tabular-nums tracking-[-0.04em]"
                                    style={{ color: ESSENCE.colors.text.primary, fontFamily: 'system-ui, -apple-system' }}
                                >
                                    {match.awayScore}
                                </span>
                                <span className="text-xl font-light opacity-30 mb-1" style={{ color: ESSENCE.colors.text.primary }}>:</span>
                                <span
                                    className="text-3xl font-semibold tabular-nums tracking-[-0.04em]"
                                    style={{ color: ESSENCE.colors.text.primary, fontFamily: 'system-ui, -apple-system' }}
                                >
                                    {match.homeScore}
                                </span>
                            </div>
                        ) : (
                            <span className="text-[13px] font-bold uppercase tracking-widest opacity-20" style={{ color: ESSENCE.colors.text.primary }}>
                                VS
                            </span>
                        )}

                        <AnimatePresence>
                            {isLive && (
                                <motion.span
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    className="text-[10px] font-semibold uppercase tracking-[0.1em] mt-1.5"
                                    style={{ color: ESSENCE.colors.text.tertiary }}
                                >
                                    {getPeriodDisplay(match)}
                                </motion.span>
                            )}
                        </AnimatePresence>
                    </div>

                    <TeamMarketBlock team={match.homeTeam} prob={homeProb} isFav={homeFav} />
                </div>
            </div>
        </motion.div>
    );
});
FeaturedHero.displayName = 'FeaturedHero';

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

const MatchList: React.FC<MatchListProps> = ({
    matches,
    onSelectMatch,
    isLoading,
    pinnedMatchIds,
    onTogglePin,
    isMatchLive,
    isMatchFinal,
    onOpenPricing,
}) => {
    const { selectedSport } = useAppStore();
    const selectedSportKey = String(selectedSport);

    // ── Data Orchestration ─────────────────────────────────────────────────────
    const { favorites, groupedMatches, featuredMatches } = useMemo(() => {
        const favs: Match[] = [];
        const rest: Match[] = [];

        matches.forEach(m => {
            if (pinnedMatchIds.has(m.id)) favs.push(m);
            else rest.push(m);
        });

        const groups: Map<string, Match[]> = new Map();
        rest.forEach(m => {
            if (!groups.has(m.leagueId)) groups.set(m.leagueId, []);
            groups.get(m.leagueId)?.push(m);
        });

        groups.forEach((groupMatches) => {
            groupMatches.sort((a, b) => {
                const isALive = isMatchLive(a);
                const isBLive = isMatchLive(b);
                if (isALive && !isBLive) return -1;
                if (!isALive && isBLive) return 1;
                return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
            });
        });

        const sortedGroups = Array.from(groups.entries()).sort((a, b) => {
            const idxA = LEAGUES.findIndex(l => l.id === a[0]);
            const idxB = LEAGUES.findIndex(l => l.id === b[0]);
            return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB);
        });

        // Extract top 2 active majors for the sidebar headlines
        const majors = new Set(['nba', 'nfl', 'ncaaf', 'ncaab', 'epl', 'mlb', 'nhl']);
        const possibleHeadlines = matches
            .filter(m => majors.has(m.leagueId.toLowerCase()) && !isMatchFinal(m))
            .sort((a, b) => {
                const aLive = isMatchLive(a);
                const bLive = isMatchLive(b);
                if (aLive !== bLive) return aLive ? -1 : 1;
                return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
            });

        const headlines = possibleHeadlines.length > 0
            ? possibleHeadlines.slice(0, 2)
            : matches.filter(m => !isMatchFinal(m)).slice(0, 2);

        return { favorites: favs, groupedMatches: sortedGroups, featuredMatches: headlines };
    }, [matches, pinnedMatchIds, isMatchLive, isMatchFinal]);

    // ── Loading State ──────────────────────────────────────────────────────────
    if (isLoading && matches.length === 0) {
        return (
            <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={SPRING_CONFIG}
                className="max-w-7xl mx-auto w-full pt-4 lg:px-6"
            >
                <div
                    className="overflow-hidden"
                    style={{
                        borderRadius: 20,
                        border: `1px solid ${ESSENCE.colors.border.default}`,
                        backgroundColor: ESSENCE.colors.surface.pure,
                        boxShadow: ESSENCE.shadows.sm,
                    }}
                >
                    {[...Array(6)].map((_, i) => <RowSkeleton key={`skel-${i}`} />)}
                </div>
            </motion.div>
        );
    }

    // ── Empty State ────────────────────────────────────────────────────────────
    if (matches.length === 0) {
        return (
            <motion.div
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={SPRING_CONFIG}
                className="flex flex-col items-center justify-center min-h-[50vh] gap-3"
            >
                <span className="text-4xl font-light opacity-20" style={{ color: ESSENCE.colors.text.primary }}>∅</span>
                <span
                    className="text-[11px] font-bold uppercase tracking-[0.2em]"
                    style={{ color: ESSENCE.colors.text.muted }}
                >
                    No Scheduled Events
                </span>
            </motion.div>
        );
    }

    // ── Feed Layout ────────────────────────────────────────────────────────────
    return (
        <div className="min-h-screen bg-transparent pb-32">
            <LayoutGroup>
                <div className="max-w-7xl mx-auto px-0 lg:px-6 w-full">
                    <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-8 lg:gap-12 items-start">

                        {/* ═══ PRIMARY FEED COLUMN ══════════════════════════════════ */}
                        <div className="min-w-0 flex flex-col gap-10 pt-4">

                            {/* Watchlist */}
                            <AnimatePresence mode="popLayout">
                                {favorites.length > 0 && (
                                    <MotionDiv
                                        layout
                                        initial={{ opacity: 0, y: 20 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, scale: 0.95 }}
                                        transition={SPRING_CONFIG}
                                    >
                                        <div className="flex items-center gap-2 mb-3.5 px-4 lg:px-2">
                                            <span
                                                className="w-[6px] h-[6px] rounded-full shadow-[0_0_8px_rgba(251,191,36,0.6)]"
                                                style={{ backgroundColor: ESSENCE.colors.accent.amber }}
                                            />
                                            <span
                                                className="text-[11px] font-bold uppercase tracking-[0.12em]"
                                                style={{ color: ESSENCE.colors.text.tertiary }}
                                            >
                                                Watchlist
                                            </span>
                                        </div>
                                        <div
                                            className="overflow-hidden"
                                            style={{
                                                borderRadius: 20,
                                                border: `1px solid ${ESSENCE.colors.border.default}`,
                                                backgroundColor: ESSENCE.colors.surface.pure,
                                                boxShadow: `0 4px 20px rgba(0,0,0,0.02)`,
                                            }}
                                        >
                                            {favorites.map(match => (
                                                <MatchRow
                                                    key={`fav-${match.id}`}
                                                    match={match}
                                                    isPinned={true}
                                                    isLive={isMatchLive(match)}
                                                    isFinal={isMatchFinal(match)}
                                                    onSelect={() => onSelectMatch(match)}
                                                    onTogglePin={(e) => onTogglePin(match.id, e)}
                                                />
                                            ))}
                                        </div>
                                    </MotionDiv>
                                )}
                            </AnimatePresence>

                            {/* League Groups */}
                            <div className="space-y-8">
                                <AnimatePresence>
                                    {groupedMatches.map(([leagueId, leagueMatches], groupIndex) => {
                                        const leagueConfig = LEAGUES.find(l => l.id === leagueId);
                                        const leagueName = leagueConfig?.name || leagueId.toUpperCase();
                                        const liveCount = leagueMatches.filter(m => isMatchLive(m)).length;

                                        return (
                                            <MotionDiv
                                                layout="position"
                                                key={leagueId}
                                                initial={{ opacity: 0, y: 15 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                transition={{ ...SPRING_CONFIG, delay: groupIndex * 0.05 }}
                                            >
                                                {/* Glassmorphic Sticky Header */}
                                                {selectedSportKey === 'all' && (
                                                    <div className="sticky top-[64px] z-10 flex items-center justify-between px-4 lg:px-2 pt-4 pb-3 mb-1 bg-white/70 backdrop-blur-xl supports-[backdrop-filter]:bg-white/60">
                                                        <div className="flex items-center gap-2.5">
                                                            <h3
                                                                className="text-[12px] font-bold uppercase tracking-[0.08em]"
                                                                style={{ color: ESSENCE.colors.text.primary }}
                                                            >
                                                                {leagueName}
                                                            </h3>
                                                            {liveCount > 0 && (
                                                                <span
                                                                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-bold tabular-nums tracking-wide"
                                                                    style={{ backgroundColor: 'rgba(16,185,129,0.1)', color: ESSENCE.colors.accent.emerald }}
                                                                >
                                                                    <motion.span
                                                                        animate={{ opacity: [1, 0.4, 1] }}
                                                                        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                                                                        className="w-[4px] h-[4px] rounded-full bg-current"
                                                                    />
                                                                    {liveCount} Live
                                                                </span>
                                                            )}
                                                        </div>
                                                        <span
                                                            className="text-[11px] font-semibold tabular-nums px-2 py-0.5 rounded-full"
                                                            style={{ color: ESSENCE.colors.text.muted, backgroundColor: ESSENCE.colors.border.ghost }}
                                                        >
                                                            {leagueMatches.length}
                                                        </span>
                                                    </div>
                                                )}

                                                {/* Inset Group Card */}
                                                <div
                                                    className="overflow-hidden"
                                                    style={{
                                                        borderRadius: 20,
                                                        border: `1px solid ${ESSENCE.colors.border.default}`,
                                                        backgroundColor: ESSENCE.colors.surface.pure,
                                                        boxShadow: `0 4px 20px rgba(0,0,0,0.02)`,
                                                    }}
                                                >
                                                    {leagueMatches.map(match => (
                                                        <MatchRow
                                                            key={match.id}
                                                            match={match}
                                                            isPinned={pinnedMatchIds.has(match.id)}
                                                            isLive={isMatchLive(match)}
                                                            isFinal={isMatchFinal(match)}
                                                            onSelect={() => onSelectMatch(match)}
                                                            onTogglePin={(e) => onTogglePin(match.id, e)}
                                                        />
                                                    ))}
                                                </div>
                                            </MotionDiv>
                                        );
                                    })}
                                </AnimatePresence>
                            </div>
                        </div>

                        {/* ═══ SIDEBAR (Desktop intelligence layer) ═══════════ */}
                        <div className="hidden lg:flex flex-col sticky top-24 space-y-8 pt-4">

                            {/* Headline Events */}
                            {featuredMatches.length > 0 && (
                                <section>
                                    <div className="flex items-center gap-2 mb-3.5 px-2">
                                        <span
                                            className="w-1.5 h-1.5 rounded-full"
                                            style={{ backgroundColor: ESSENCE.colors.text.primary }}
                                        />
                                        <span
                                            className="text-[10px] font-bold uppercase tracking-[0.15em]"
                                            style={{ color: ESSENCE.colors.text.tertiary }}
                                        >
                                            Headlines
                                        </span>
                                    </div>
                                    <div className="flex flex-col gap-4">
                                        {featuredMatches.map((match, idx) => (
                                            <MotionDiv
                                                key={`feat-${match.id}`}
                                                initial={{ opacity: 0, x: 10 }}
                                                animate={{ opacity: 1, x: 0 }}
                                                transition={{ ...SPRING_CONFIG, delay: idx * 0.1 }}
                                            >
                                                <FeaturedHero
                                                    match={match}
                                                    onClick={() => onSelectMatch(match)}
                                                    isLive={isMatchLive(match)}
                                                />
                                            </MotionDiv>
                                        ))}
                                    </div>
                                </section>
                            )}

                            {/* Obsidian / Titanium "Pro Access" Terminal Card */}
                            <motion.div
                                whileHover={{ y: -2, boxShadow: '0 20px 40px rgba(0,0,0,0.1)' }}
                                transition={SPRING_CONFIG}
                                className="overflow-hidden relative group p-8 flex flex-col items-start cursor-pointer"
                                onClick={onOpenPricing}
                                style={{
                                    borderRadius: 24,
                                    backgroundColor: '#0F1115', // Premium Matte Black
                                    border: '1px solid rgba(255,255,255,0.08)',
                                }}
                            >
                                {/* Iridescent background mesh / Glass reflection */}
                                <div
                                    className="absolute inset-0 opacity-20 pointer-events-none transition-opacity duration-500 group-hover:opacity-30"
                                    style={{ background: 'radial-gradient(circle at 100% 0%, rgba(59,130,246,0.4) 0%, transparent 50%), radial-gradient(circle at 0% 100%, rgba(139,92,246,0.3) 0%, transparent 50%)' }}
                                />

                                <span className="relative z-10 text-[10px] font-black uppercase tracking-[0.2em] text-white/50 mb-1">
                                    Terminal
                                </span>
                                <h4 className="relative z-10 text-[18px] font-semibold tracking-tight text-white mb-2">
                                    Pro Access
                                </h4>
                                <p className="relative z-10 mt-1 mb-7 leading-relaxed text-[13px] text-white/60 font-light text-balance">
                                    Real-time institutional feeds, sharp money indicators, and AI-powered edge detection.
                                </p>
                                <button
                                    className="relative z-10 w-full py-3 rounded-xl font-bold uppercase tracking-[0.12em] transition-colors duration-200 bg-white text-black hover:bg-slate-200 text-[11px]"
                                >
                                    Upgrade Tier
                                </button>
                            </motion.div>
                        </div>

                    </div>
                </div>
            </LayoutGroup>

            {/* Global Hardware-Accelerated Keyframes */}
            <style>{`
        @keyframes shimmer {
          100% { transform: translateX(100%); }
        }
      `}</style>
        </div>
    );
};

export default memo(MatchList);
