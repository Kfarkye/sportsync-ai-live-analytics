// ===================================================================
// PreGameCard.tsx
// ARCHITECTURE: "SOTA Production" • Apple/Google Quality Standards
// AESTHETIC: Porsche Luxury • Jony Ive Minimalism • Jobs Narrative
// ===================================================================

import React, { Component, useMemo, useState } from 'react';
import { Match, MatchOdds, Sport } from '@/types';
import { usePreGameData } from '../../hooks/usePreGameData';
import { useScoringSplits } from '../../hooks/useScoringSplits';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import { cn } from '@/lib/essence';
import {
    MatchupLoader,
    MatchupError,
    MatchupContextPills
} from '../ui';
import { extractGameContext } from './GameContextCard';
import { useMatchupCoaches } from '../../hooks/useCoach';
import RecentForm from './RecentForm';
import PregameOdds from './PregameOdds';
import OfficialIntelligence from './OfficialIntelligence';
import InjuryList from './InjuryList';
import VenueSplitsCard from '../VenueSplitsCard';
import { GoalieMatchup } from '../GoalieMatchup';
import { PregameIntelCards } from './PregameIntelCards';
import { usePregameIntel } from '../../hooks/usePregameIntel';
import SofaStats from './SofaStats';
import { PropMarketListView } from '../analysis/PropMarketListView';
import { americanToImpliedProb, calcEdge, getPolyData, usePolyOdds } from '../../hooks/usePolyOdds';

export type PreGameTabId = 'DETAILS' | 'PROPS' | 'DATA' | 'CHAT';

interface PreGameCardProps {
    match: Match;
    activeTab: PreGameTabId;
    propView?: 'classic' | 'cinematic';
    onPropViewChange?: (view: 'classic' | 'cinematic') => void;
}

// ─────────────────────────────────────────────────────────────────
// 🎨 DESIGN TOKENS & PHYSICS
// ─────────────────────────────────────────────────────────────────

// "Aluminum Switch" Physics: High stiffness, critical damping
const PHYSICS_SWITCH = { type: "spring", stiffness: 380, damping: 35, mass: 0.8 };
const STAGGER_DELAY = 0.05;

const parseMoneyline = (value: string | number | null | undefined): number | null => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') {
        if (!Number.isFinite(value) || value === 0) return null;
        return value;
    }

    const trimmed = value.trim().toUpperCase();
    if (!trimmed || trimmed === '-' || trimmed === '—') return null;
    if (trimmed === 'EVEN' || trimmed === 'EV') return 100;

    const cleaned = trimmed.replace(/[^\d+-]/g, '');
    if (!cleaned) return null;
    const parsed = Number.parseInt(cleaned, 10);
    if (!Number.isFinite(parsed) || parsed === 0) return null;
    return parsed;
};

const resolveBookMoneylines = (match: Match): { home: number | null; away: number | null } => {
    const current: Partial<MatchOdds> = match.current_odds || match.odds || {};
    const opening: Partial<MatchOdds> = match.opening_odds || {};

    const home =
        parseMoneyline(current.homeWin ?? current.home_ml ?? current.moneylineHome) ??
        parseMoneyline(opening.homeWin ?? opening.home_ml ?? opening.moneylineHome);

    const away =
        parseMoneyline(current.awayWin ?? current.away_ml ?? current.moneylineAway) ??
        parseMoneyline(opening.awayWin ?? opening.away_ml ?? opening.moneylineAway);

    return { home, away };
};

const formatProb = (value: number | null): string => {
    if (value === null || !Number.isFinite(value)) return 'n/a';
    return `${(value * 100).toFixed(1)}%`;
};

const formatGap = (value: number | null): string => {
    if (value === null || !Number.isFinite(value)) return 'n/a';
    const sign = value > 0 ? '+' : '';
    return `${sign}${value.toFixed(1)}pp`;
};

// ─────────────────────────────────────────────────────────────────
// 💎 MICRO-COMPONENTS (PURE GEOMETRY)
// ─────────────────────────────────────────────────────────────────

// Pure CSS Animated Plus/Minus Toggle (Jony Ive Reduction - No SVGs)
const ToggleSwitch = ({ expanded }: { expanded: boolean }) => (
    <div className="relative w-2.5 h-2.5 flex items-center justify-center opacity-40 group-hover:opacity-100 transition-opacity duration-300">
        <span className={cn(
            "absolute w-full h-px bg-white transition-transform duration-500 ease-[cubic-bezier(0.23,1,0.32,1)]",
            expanded ? "rotate-180" : "rotate-0"
        )} />
        <span className={cn(
            "absolute w-full h-px bg-white transition-transform duration-500 ease-[cubic-bezier(0.23,1,0.32,1)]",
            expanded ? "rotate-180 opacity-0" : "rotate-90 opacity-100"
        )} />
    </div>
);

// ─────────────────────────────────────────────────────────────────
// 🏗️ SPEC SHEET ROW (THE LAYOUT ENGINE)
// ─────────────────────────────────────────────────────────────────

interface SpecSheetRowProps {
    label: string;
    children: React.ReactNode;
    defaultOpen?: boolean;
    collapsible?: boolean;
    rightAccessory?: React.ReactNode;
}

const SpecSheetRow = ({
    label,
    children,
    defaultOpen = false,
    collapsible = true,
    rightAccessory
}: SpecSheetRowProps) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    // If not collapsible, force open state
    const effectiveOpen = collapsible ? isOpen : true;

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className={cn(
                "group relative border-t border-white/8 transition-all duration-500",
                collapsible ? "cursor-pointer" : "cursor-default"
            )}
            onClick={() => collapsible && setIsOpen(!isOpen)}
        >
            {/* Active Laser Line (Left Edge) */}
            <div className={cn(
                "absolute -top-px left-0 h-px bg-white transition-all duration-500 ease-out z-10 shadow-[0_0_10px_rgba(255,255,255,0.4)]",
                effectiveOpen ? "w-full opacity-100" : "w-0 opacity-0"
            )} />

            <div className="py-8 flex flex-col md:flex-row md:items-start gap-6 md:gap-0">

                {/* 1. Technical Label (Desktop: Left Col / Mobile: Top) */}
                <div className="w-full md:w-[140px] shrink-0 flex items-center justify-between md:block select-none">
                    <span className={cn(
                        "text-[10px] font-bold tracking-[0.2em] uppercase transition-colors duration-300 font-mono block",
                        effectiveOpen ? "text-zinc-50" : "text-zinc-600 group-hover:text-zinc-400"
                    )}>
                        {label}
                    </span>

                    {/* Mobile Toggle */}
                    {collapsible && (
                        <div className="md:hidden block">
                            <ToggleSwitch expanded={effectiveOpen} />
                        </div>
                    )}
                </div>

                {/* 2. Content Body */}
                <div className="flex-1 min-w-0 relative">
                    {/* Desktop Toggle (Absolute Right) */}
                    {collapsible && (
                        <div className="hidden md:block absolute right-0 top-1">
                            <ToggleSwitch expanded={effectiveOpen} />
                        </div>
                    )}

                    {rightAccessory && (
                        <div className="mb-6">
                            {rightAccessory}
                        </div>
                    )}

                    <AnimatePresence initial={false}>
                        {effectiveOpen && (
                            <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: "auto", opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={PHYSICS_SWITCH}
                                className="overflow-hidden"
                            >
                                <div className={cn(
                                    "text-zinc-200 font-light leading-relaxed",
                                    // Add minor delay to content fade-in for sophistication
                                    "animate-in fade-in duration-700 fill-mode-forwards"
                                )}>
                                    {children}
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>
        </motion.div>
    );
};

// ─────────────────────────────────────────────────────────────────
// 🏗️ SUB-SECTIONS
// ─────────────────────────────────────────────────────────────────

const VenueSplitsSection = ({ match }: { match: Match }) => {
    const { data: leagueSplits, isLoading, error } = useScoringSplits({
        leagueId: match.leagueId,
        limit: 100
    });

    const matchedSplits = useMemo(() => {
        if (!leagueSplits?.data) return null;
        const homeSplit = leagueSplits.data.find(t => t.team?.id === match.homeTeam?.id);
        const awaySplit = leagueSplits.data.find(t => t.team?.id === match.awayTeam?.id);
        if (!homeSplit || !awaySplit) return null;
        return { homeSplit, awaySplit };
    }, [leagueSplits, match.homeTeam.id, match.awayTeam.id]);

    if (isLoading) return <MatchupLoader className="h-32 opacity-50" />;
    if (error || !matchedSplits) return null;

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8">
            <VenueSplitsCard data={matchedSplits.awaySplit} teamColor={match.awayTeam.color} />
            <VenueSplitsCard data={matchedSplits.homeSplit} teamColor={match.homeTeam.color} />
        </div>
    );
};

interface PolyGapSectionProps {
    homeTeam: string;
    awayTeam: string;
    homePolyProb: number;
    awayPolyProb: number;
    homeBookProb: number | null;
    awayBookProb: number | null;
    homeGap: number | null;
    awayGap: number | null;
    volume: number;
}

const PolyGapSection = ({
    homeTeam,
    awayTeam,
    homePolyProb,
    awayPolyProb,
    homeBookProb,
    awayBookProb,
    homeGap,
    awayGap,
    volume,
}: PolyGapSectionProps) => {
    const strongestGap = (() => {
        const homeAbs = homeGap === null ? -1 : Math.abs(homeGap);
        const awayAbs = awayGap === null ? -1 : Math.abs(awayGap);
        if (homeAbs < 0 && awayAbs < 0) return null;
        return homeAbs >= awayAbs
            ? { team: homeTeam, gap: homeGap }
            : { team: awayTeam, gap: awayGap };
    })();

    const rows = [
        {
            team: awayTeam,
            polyProb: awayPolyProb,
            bookProb: awayBookProb,
            gap: awayGap,
        },
        {
            team: homeTeam,
            polyProb: homePolyProb,
            bookProb: homeBookProb,
            gap: homeGap,
        },
    ];

    return (
        <div className="rounded-xl border border-white/10 bg-white/2 px-4 py-3">
            <div className="mb-3 flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                    Prediction Market vs Sportsbook
                </span>
                {volume > 0 ? (
                    <span className="text-[10px] font-mono tabular-nums text-zinc-500">
                        ${Math.round(volume).toLocaleString()} volume
                    </span>
                ) : null}
            </div>

            <div className="grid grid-cols-[minmax(0,1fr)_70px_70px_76px] border-b border-white/8 pb-2 text-[9px] font-bold uppercase tracking-[0.14em] text-zinc-600">
                <span>Team</span>
                <span className="text-center">Poly</span>
                <span className="text-center">Book</span>
                <span className="text-right">Gap</span>
            </div>

            <div className="divide-y divide-white/6">
                {rows.map((row) => (
                    <div key={row.team} className="grid grid-cols-[minmax(0,1fr)_70px_70px_76px] items-center py-2.5">
                        <span className="truncate text-[12px] font-semibold text-zinc-100">
                            {row.team}
                        </span>
                        <span className="text-center font-mono text-[12px] tabular-nums text-zinc-200">
                            {formatProb(row.polyProb)}
                        </span>
                        <span className="text-center font-mono text-[12px] tabular-nums text-zinc-400">
                            {formatProb(row.bookProb)}
                        </span>
                        <span className={cn(
                            "text-right font-mono text-[12px] font-semibold tabular-nums",
                            row.gap === null
                                ? "text-zinc-500"
                                : row.gap > 0
                                    ? "text-emerald-400"
                                    : row.gap < 0
                                        ? "text-rose-400"
                                        : "text-zinc-300"
                        )}>
                            {formatGap(row.gap)}
                        </span>
                    </div>
                ))}
            </div>

            {strongestGap ? (
                <div className="mt-3 rounded-lg border border-white/8 bg-black/20 px-3 py-2 text-[11px] text-zinc-300">
                    Strongest divergence: <span className="font-semibold text-zinc-100">{strongestGap.team}</span>{' '}
                    <span className={cn(
                        "font-mono tabular-nums font-semibold",
                        strongestGap.gap !== null && strongestGap.gap > 0 ? "text-emerald-400" : "text-rose-400"
                    )}>
                        {formatGap(strongestGap.gap)}
                    </span>
                </div>
            ) : null}
        </div>
    );
};

// 🛡️ Error Boundary for production safety
class DebugBoundary extends Component<{ children: React.ReactNode }, { hasError: boolean, error: Error | null }> {
    public state = { hasError: false, error: null };
    public static getDerivedStateFromError(error: Error) { return { hasError: true, error }; }
    public componentDidCatch(error: Error) { console.error('COMPONENT CRASH:', error); }
    public render() {
        if (this.state.hasError) return <MatchupError error={this.state.error} />;
        return this.props.children;
    }
}

// ─────────────────────────────────────────────────────────────────
// 🏛️ MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────

const PreGameCard: React.FC<PreGameCardProps> = ({ match, activeTab, propView, onPropViewChange }) => {
    const { data, isLoading, error } = usePreGameData(match.id, match.sport, match.leagueId);
    const { data: polyOddsResult } = usePolyOdds({
        leagueId: match.leagueId,
        enabled: activeTab === 'DETAILS'
    });

    // Fetch coaching data for the context row
    const { data: coachData } = useMatchupCoaches(match.homeTeam.id, match.awayTeam.id, match.sport);

    const { intel } = usePregameIntel(
        match.id,
        match.homeTeam.name,
        match.awayTeam.name,
        match.sport,
        match.leagueId,
        typeof match.startTime === 'string' ? match.startTime : match.startTime?.toISOString()
    );

    const polyGap = useMemo(() => {
        const poly = getPolyData(polyOddsResult, match.id, match.homeTeam.name, match.awayTeam.name);
        if (!poly) return null;

        const bookMoneylines = resolveBookMoneylines(match);
        const homeBookProb = bookMoneylines.home !== null ? americanToImpliedProb(bookMoneylines.home) : null;
        const awayBookProb = bookMoneylines.away !== null ? americanToImpliedProb(bookMoneylines.away) : null;

        if (homeBookProb === null && awayBookProb === null) return null;

        return {
            homePolyProb: poly.homeProb,
            awayPolyProb: poly.awayProb,
            homeBookProb,
            awayBookProb,
            homeGap: homeBookProb !== null ? calcEdge(poly.homeProb, homeBookProb) : null,
            awayGap: awayBookProb !== null ? calcEdge(poly.awayProb, awayBookProb) : null,
            volume: poly.volume,
        };
    }, [
        polyOddsResult,
        match,
    ]);

    // --- LOADING & ERROR STATES ---
    if (isLoading && !data) {
        return (
            <div className="w-full h-[600px] flex flex-col items-center justify-center space-y-6 opacity-40">
                <div className="h-px w-32 bg-linear-to-r from-transparent via-white to-transparent opacity-20 animate-pulse" />
                <div className="text-[9px] tracking-[0.4em] uppercase text-zinc-500 font-mono">Loading Schematics</div>
            </div>
        );
    }

    if (error || !data) return (
        <MatchupError
            title="Schematic Error"
            message="Tactical data unavailable for this coordinate."
        />
    );

    // Data Availability Checks
    const hasInjuries = (data.injuries?.home?.length || 0) > 0 || (data.injuries?.away?.length || 0) > 0;
    const hasOfficialsData = (data.officials && data.officials.length > 0) || !!data.refIntel;
    const hasStats = data.homeTeam?.stats?.length > 0 && data.awayTeam?.stats?.length > 0;
    const hasForm = data.homeTeam?.last5?.length > 0 && data.awayTeam?.last5?.length > 0;

    return (
        <LayoutGroup>
            <div className="w-full max-w-[840px] mx-auto min-h-screen">

                {/* --- DETAILS TAB (The "Spec Sheet") --- */}
                {activeTab === 'DETAILS' && (
                    <motion.div
                        initial="hidden"
                        animate="visible"
                        variants={{ visible: { transition: { staggerChildren: STAGGER_DELAY } } }}
                        className="pb-24"
                    >
                        {/* 01 // MARKET (Odds - Always Open, No Collapse) */}
                        <SpecSheetRow label="01 // MARKET" defaultOpen={true} collapsible={false}>
                            <PregameOdds match={match} />
                        </SpecSheetRow>

                        {polyGap && (
                            <SpecSheetRow label="01A // POLY GAP" defaultOpen={true} collapsible={false}>
                                <PolyGapSection
                                    homeTeam={match.homeTeam.shortName || match.homeTeam.name}
                                    awayTeam={match.awayTeam.shortName || match.awayTeam.name}
                                    homePolyProb={polyGap.homePolyProb}
                                    awayPolyProb={polyGap.awayPolyProb}
                                    homeBookProb={polyGap.homeBookProb}
                                    awayBookProb={polyGap.awayBookProb}
                                    homeGap={polyGap.homeGap}
                                    awayGap={polyGap.awayGap}
                                    volume={polyGap.volume}
                                />
                            </SpecSheetRow>
                        )}

                        {/* 02 // CONDITIONS (Context) */}
                        <SpecSheetRow label="02 // CONDITIONS" defaultOpen={true}>
                            <MatchupContextPills
                                venue={data.venue}
                                weather={data.weather}
                                broadcast={data.broadcast}
                                gameContext={extractGameContext(match).primary}
                                coaches={coachData ? {
                                    home: coachData.homeCoach?.coach_name || '',
                                    away: coachData.awayCoach?.coach_name || ''
                                } : undefined}
                                sport={match.sport}
                            />
                        </SpecSheetRow>

                        {/* 03 // METRICS (Performance) */}
                        {hasStats && (
                            <SpecSheetRow label="03 // METRICS" defaultOpen={true}>
                                <SofaStats
                                    homeTeam={{
                                        id: match.homeTeam.id,
                                        name: match.homeTeam.name,
                                        shortName: match.homeTeam.shortName || match.homeTeam.name,
                                        logo: match.homeTeam.logo,
                                        color: match.homeTeam.color || '#EF4444',
                                        stats: data.homeTeam.stats.map(s => ({ label: s.label, value: String(s.value) }))
                                    }}
                                    awayTeam={{
                                        id: match.awayTeam.id,
                                        name: match.awayTeam.name,
                                        shortName: match.awayTeam.shortName || match.awayTeam.name,
                                        logo: match.awayTeam.logo,
                                        color: match.awayTeam.color || '#3B82F6',
                                        stats: data.awayTeam.stats.map(s => ({ label: s.label, value: String(s.value) }))
                                    }}
                                />
                            </SpecSheetRow>
                        )}

                        {/* 04 // TRAJECTORY (Form) */}
                        {hasForm && (
                            <SpecSheetRow label="04 // TRAJECTORY" defaultOpen={false}>
                                <RecentForm
                                    homeTeam={data.homeTeam}
                                    awayTeam={data.awayTeam}
                                    homeName={match.homeTeam.shortName || match.homeTeam.name}
                                    awayName={match.awayTeam.shortName || match.awayTeam.name}
                                    homeLogo={match.homeTeam.logo}
                                    awayLogo={match.awayTeam.logo}
                                    homeColor={match.homeTeam.color}
                                    awayColor={match.awayTeam.color}
                                />
                            </SpecSheetRow>
                        )}

                        {/* 05 // VENUE (Splits) */}
                        <SpecSheetRow label="05 // VENUE" defaultOpen={false}>
                            <VenueSplitsSection match={match} />
                        </SpecSheetRow>

                        {/* 06 // AUTHORITY (Officials) */}
                        {hasOfficialsData && (
                            <SpecSheetRow label="06 // AUTHORITY" defaultOpen={false}>
                                <OfficialIntelligence
                                    officials={data.officials}
                                    intel={data.refIntel}
                                />
                            </SpecSheetRow>
                        )}

                        {/* 07 // ROSTER (Injuries) */}
                        {hasInjuries && (
                            <SpecSheetRow label="07 // ROSTER" defaultOpen={true}>
                                <InjuryList
                                    homeInjuries={data.injuries.home}
                                    awayInjuries={data.injuries.away}
                                    homeTeamName={match.homeTeam.shortName}
                                    awayTeamName={match.awayTeam.shortName}
                                />
                            </SpecSheetRow>
                        )}

                        {/* 08 // NETMINDER (Hockey Only) */}
                        {match.sport === Sport.HOCKEY && (
                            <SpecSheetRow label="08 // NETMINDER" defaultOpen={true}>
                                <GoalieMatchup
                                    matchId={match.id}
                                    homeTeam={match.homeTeam}
                                    awayTeam={match.awayTeam}
                                />
                            </SpecSheetRow>
                        )}

                        {/* Closing Hairline */}
                        <div className="w-full h-px bg-white/8" />
                    </motion.div>
                )}

                {/* --- PROPS TAB --- */}
                {activeTab === 'PROPS' && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="pb-24"
                    >
                        <SpecSheetRow label="01 // MARKETS" defaultOpen={true} collapsible={false}>
                            <DebugBoundary>
                                <PropMarketListView match={match} />
                            </DebugBoundary>
                        </SpecSheetRow>
                        <div className="w-full h-px bg-white/8" />
                    </motion.div>
                )}

                {/* --- DATA TAB (Intel Cards) --- */}
                {activeTab === 'DATA' && (
                    <DebugBoundary>
                        {/* 
                            PregameIntelCards already has its own Hero/Layout structure 
                            that matches this aesthetic perfectly. We render it directly
                            without wrapping in a SpecSheetRow to avoid visual redundancy.
                        */}
                        <PregameIntelCards match={match} hideFooter={true} intel={intel} />
                    </DebugBoundary>
                )}
            </div>
        </LayoutGroup>
    );
};

export default PreGameCard;
