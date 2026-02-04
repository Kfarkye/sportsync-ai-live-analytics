import React, { Component, useMemo, useEffect, useState } from 'react';
import { Match, Sport } from '../../types';
import { usePreGameData } from '../../hooks/usePreGameData';
import { useScoringSplits } from '../../hooks/useScoringSplits';
import { AlertTriangle, Loader2, Sparkles, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn, ESSENCE } from '../../lib/essence';
import {
    SectionHeader as UnifiedSectionHeader,
    Card,
    CardShell,
    PropViewToggle,
    MatchupLoader,
    MatchupError,
    MatchupContextPills
} from '../ui';
import { extractGameContext } from './GameContextCard';
import { useMatchupCoaches } from '../../hooks/useCoach';
import { dbService } from '../../services/dbService';
import RecentForm from './RecentForm';
import PregameOdds from './PregameOdds';
import OfficialIntelligence from './OfficialIntelligence';
import InjuryList from './InjuryList';
import { EdgeAnalysisCard, EdgeResult, EdgeDirection } from '../analysis/EdgeAnalysisCard';
import VenueSplitsCard from '../VenueSplitsCard';
import { GoalieMatchup } from '../GoalieMatchup';
import InsightPills from './InsightPills';
import { PregameIntelCards } from './PregameIntelCards';
import { usePregameIntel } from '../../hooks/usePregameIntel';

import SofaStats from './SofaStats';
import StatLeaders from './StatLeaders';
import { PropMarketListView } from '../analysis/PropMarketListView';
import { MarketType, PredictionContract } from '../../utils/edge-script-engine';

export type PreGameTabId = 'DETAILS' | 'PROPS' | 'DATA' | 'CHAT';

interface PreGameCardProps {
    match: Match;
    activeTab: PreGameTabId;
    propView?: 'classic' | 'cinematic';
    onPropViewChange?: (view: 'classic' | 'cinematic') => void;
}

// --- Premium Section Header using Unified Component ---
const SectionHeader = ({ title, action }: { title: string; action?: string }) => (
    <UnifiedSectionHeader
        compact
        className="px-1"
        rightAccessory={action ? (
            <button className="text-[10px] font-bold text-zinc-600 hover:text-white transition-colors duration-300">
                {action}
            </button>
        ) : undefined}
    >
        {title}
    </UnifiedSectionHeader>
);

// --- Collapsible Section for Progressive Disclosure ---

const CollapsibleSection = ({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    return (
        <div>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between py-3 group transition-all duration-200"
            >
                <div className="flex items-center gap-2">
                    <div className={cn(
                        "w-1 h-1 rounded-full transition-colors duration-300",
                        isOpen ? "bg-white" : "bg-zinc-700"
                    )} />
                    <span className={cn(
                        "text-[10px] font-bold uppercase tracking-[0.15em] transition-colors duration-200",
                        isOpen ? "text-zinc-300" : "text-zinc-600"
                    )}>
                        {title}
                    </span>
                </div>
                <ChevronDown size={12} strokeWidth={2} className={cn(
                    "text-zinc-600 transition-transform duration-300",
                    isOpen && "rotate-180 text-zinc-400"
                )} />
            </button>
            <AnimatePresence initial={false}>
                {isOpen && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
                    >
                        <div className="pb-4">
                            {children}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

// Use integrated UI component


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

    if (isLoading) return <MatchupLoader className="h-48" />;
    if (error || !matchedSplits) return null;

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <VenueSplitsCard data={matchedSplits.awaySplit} teamColor={match.awayTeam.color} />
            <VenueSplitsCard data={matchedSplits.homeSplit} teamColor={match.homeTeam.color} />
        </div>
    );
};

// Fix: Add generic type constraints to properly inherit this.props
class DebugBoundary extends Component<{ children: React.ReactNode }, { hasError: boolean, error: unknown }> {
    public state = { hasError: false, error: null };

    public static getDerivedStateFromError(error: unknown) {
        return { hasError: true, error };
    }

    public componentDidCatch(error: unknown) {
        console.error('COMPONENT CRASH:', error);
    }

    public render() {
        if (this.state.hasError) {
            return <MatchupError error={this.state.error} />;
        }
        // Fix: Inherit props access
        return this.props.children;
    }
}

// --- HELPER: Reserved for Future Expansion ---

const PreGameCard: React.FC<PreGameCardProps> = ({ match, activeTab, propView, onPropViewChange }) => {
    const { data, isLoading, error } = usePreGameData(match.id, match.sport, match.leagueId);
    const [aiImplications, setAiImplications] = useState<string[]>([]);
    const [aiSources, setAiSources] = useState<any[]>([]);
    const [aiReport, setAiReport] = useState<string | null>(null);
    const [isAiLoading, setIsAiLoading] = useState(false);

    // Fetch coaching data for the context row
    const { data: coachData } = useMatchupCoaches(match.homeTeam.id, match.awayTeam.id, match.sport);

    const {
        intel,
        loading: intelLoading
    } = usePregameIntel(
        match.id,
        match.homeTeam.name,
        match.awayTeam.name,
        match.sport,
        match.leagueId,
        typeof match.startTime === 'string' ? match.startTime : match.startTime?.toISOString()
    );


    // --- TRANSFORM: Edge Analysis Data ---
    const edgeResult: EdgeResult | undefined = useMemo(() => {
        if (!data?.projections || !data?.market) return undefined;

        const modelTotal = typeof data.projections.total === 'number' ? data.projections.total : null;
        const marketTotal = typeof data.market.currentTotal === 'number' ? data.market.currentTotal : null;

        if (modelTotal == null || marketTotal == null || marketTotal <= 0) return undefined;

        const rawDiff = modelTotal - marketTotal;
        const edgeMagnitude = Math.abs(rawDiff);
        const direction: EdgeDirection = rawDiff > 0 ? 'OVER' : 'UNDER';
        const percent = (edgeMagnitude / marketTotal) * 100;

        // Extract key injuries for the ledger
        // Flatten home/away, filter non-impact status, take top 3
        const allInjuries = [
            ...(data.injuries?.home || []).map(i => ({ name: i.player || i.name, status: i.status || '' })),
            ...(data.injuries?.away || []).map(i => ({ name: i.player || i.name, status: i.status || '' }))
        ].filter(i => i.status && ['OUT', 'GTD', 'DOUBTFUL', 'SUSPENDED'].includes(i.status)).slice(0, 3);

        // Map status strings to strict types for badge rendering
        const typedInjuries = allInjuries.map(i => ({
            name: i.name,
            status: ((i.status && i.status.includes('OUT')) ? 'OUT' : 'GTD') as 'OUT' | 'GTD'
        }));

        // implications: Deterministic rules are now purged in favor of Sharp Report (AI)
        const implications: string[] = [];

        // v7 Optimization: The engine already produces high-precision normalized units.
        // No further division required.
        const efficiency = data.projections.efficiency;

        return {
            type: 'TOTAL' as const,
            impliedLine: marketTotal,
            modelLine: modelTotal,
            edgePoints: edgeMagnitude,
            edgePercent: percent,
            edgeDirection: direction,
            confidence: data.projections.confidence || 0.68,
            trace: {
                pace: data.projections.pace,
                efficiency: efficiency,
                possessions: data.projections.possessions || data.projections.pace
            },
            implications,
            keyInjuries: typedInjuries
        } as EdgeResult;
    }, [data, match]);

    // NOTE: AI Synthesis for pregame is now handled exclusively by PregameIntelCards.
    // The previous `fetchAiSynthesis` effect was removed as it was redundantly calling
    // `geminiService.getMatchIntelligence` (which hits `analyze-match`), wasting API calls.

    // Merge AI implications into EdgeResult
    const finalEdgeResult = useMemo(() => {
        if (!edgeResult) return undefined;
        if (aiImplications.length === 0) return edgeResult;
        return {
            ...edgeResult,
            implications: aiImplications,
            sources: aiSources
        };
    }, [edgeResult, aiImplications, aiSources]);



    // --- UI HELPERS ---
    const isProcessing = aiReport === 'PROCESSING_LOCK';

    const narrativeText = useMemo(() => {
        if (isProcessing) return null;
        return aiReport?.trim() ? aiReport : null;
    }, [aiReport, isProcessing]);

    if (isLoading && !data) {
        return <MatchupLoader className="py-40" />;
    }

    if (error || !data) return (
        <MatchupError
            title="Intel Unavailable"
            message="We couldn't retrieve the tactical data for this matchup."
        />
    );

    // Determine if Game Environment section has any data worth showing
    const hasVenueData = data.venue?.name && data.venue.name !== 'Unknown Venue';
    const hasWeatherData = data.weather && (data.weather.temp !== 0 || data.weather.condition);
    const hasBroadcast = !!data.broadcast;
    const hasConditionsData = hasVenueData || hasWeatherData || hasBroadcast;
    const hasInjuries = (data.injuries?.home?.length || 0) > 0 || (data.injuries?.away?.length || 0) > 0;
    const hasOfficialsData = (data.officials && data.officials.length > 0) || !!data.refIntel;

    return (
        <div className="py-6 animate-in fade-in slide-in-from-bottom-6 duration-700">

            {/* --- DETAILS TAB (Matchup) --- */}
            {activeTab === 'DETAILS' && (
                <div className="space-y-10 pb-12">
                    {/* 1. Odds Section (Primary Decision Surface) */}
                    <section>
                        <PregameOdds match={match} />
                    </section>

                    {/* 2. Matchup Context Row (Collapsed Density) */}
                    <section className="px-1">
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
                    </section>

                    {/* 3. Performance Comparison - Moved from Edge Tab */}
                    {data.homeTeam?.stats?.length > 0 && data.awayTeam?.stats?.length > 0 && (
                        <CollapsibleSection title="Performance Comparison" defaultOpen={true}>
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
                        </CollapsibleSection>
                    )}

                    {/* 4. Recent Form - Moved from Edge Tab */}
                    {data.homeTeam?.last5?.length > 0 && data.awayTeam?.last5?.length > 0 && (
                        <CollapsibleSection title="Recent Form" defaultOpen={false}>
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
                        </CollapsibleSection>
                    )}

                    {/* 5. Venue Edge */}
                    <CollapsibleSection title="Venue Edge" defaultOpen={false}>
                        <VenueSplitsSection match={match} />
                    </CollapsibleSection>

                    {/* 6. High-Signal Tactical Intel (Officials + Injuries) */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        {/* Officials */}
                        {hasOfficialsData && (
                            <CollapsibleSection title="Officiating" defaultOpen={false}>
                                <OfficialIntelligence
                                    officials={data.officials}
                                    intel={data.refIntel}
                                />
                            </CollapsibleSection>
                        )}

                        {/* Injuries */}
                        {hasInjuries && (
                            <CollapsibleSection title="Injury Report" defaultOpen={true}>
                                <InjuryList
                                    homeInjuries={data.injuries.home}
                                    awayInjuries={data.injuries.away}
                                    homeTeamName={match.homeTeam.shortName}
                                    awayTeamName={match.awayTeam.shortName}
                                />
                            </CollapsibleSection>
                        )}
                    </div>
                </div>
            )}

            {/* --- PROPS TAB --- */}
            {activeTab === 'PROPS' && (
                <section className="max-w-3xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
                    <DebugBoundary>
                        <PropMarketListView match={match} />
                    </DebugBoundary>
                </section>
            )}

            {/* --- DATA TAB (Edge - AI Intelligence) --- */}
            {activeTab === 'DATA' && (
                <DebugBoundary>
                    <div className="w-full animate-in fade-in slide-in-from-bottom-6 duration-700">
                        {/* AI Intelligence Cards - The Core Value */}
                        <PregameIntelCards match={match} hideFooter={true} intel={intel} />
                    </div>
                </DebugBoundary>
            )}

            {/* Hockey Goalies Section (Keep as key personnel data) */}
            {match.sport === Sport.HOCKEY && (
                <section className="mt-16">
                    <SectionHeader title="Netminder Context" />
                    <GoalieMatchup
                        matchId={match.id}
                        homeTeam={match.homeTeam}
                        awayTeam={match.awayTeam}
                    />
                </section>
            )}

            <div className="flex flex-col items-center justify-center py-16 opacity-20">
                <div className="h-px w-16 bg-gradient-to-r from-transparent via-zinc-700 to-transparent" />
            </div>
        </div>
    );
};

export default PreGameCard;
