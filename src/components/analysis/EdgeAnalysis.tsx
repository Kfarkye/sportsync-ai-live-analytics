
import React, { useMemo, useState } from 'react';
import { Match, MatchIntelligence } from '../../types';
import { geminiService } from '../../services/geminiService';
import { computeAISignals } from '../../services/gameStateEngine';
import { useDbFirst } from '../../hooks/useDbFirst';
import { dbService, CacheResult } from '../../services/dbService';
import { isGameInProgress } from '../../utils/matchUtils';
import { TranslatedExplanationBlock } from './TranslatedExplanationBlock';
import { motion, AnimatePresence } from 'framer-motion';
import { cn, ESSENCE } from '../../lib/essence';
import { Sparkles, ChevronDown, ChevronUp, Activity, Target, ShieldCheck, Bot } from 'lucide-react';
import { EdgeAnalysisCard, EdgeResult } from './EdgeAnalysisCard';

/**
 * EdgeAnalysis
 * Wrapper component that handles data fetching and renders the EdgeAnalysisCard.
 * Featuring the restored Bot Loading Spinner.
 */
export const EdgeAnalysis: React.FC<{ match: Match }> = ({ match }) => {
    const isLive = isGameInProgress(match.status);

    // 1. Math Layer: Canonical Engine Signals
    const signals = useMemo(() => {
        return computeAISignals(match);
    }, [match]);

    // 2. AI Layer: Strategic Intelligence
    const { data: intel, isLoading } = useDbFirst<MatchIntelligence>(
        () => dbService.getCachedIntel(match.id) as Promise<CacheResult<MatchIntelligence> | null>,
        async () => geminiService.getMatchIntelligence(match),
        (data) => dbService.cacheIntel(match.id, data),
        [match.id]
    );

    // 3. Derived Visual States
    const edgePoints = signals.edge_points || 0;

    // v5.5 Restore the spinning bot loading state as the primary entrance
    if (isLoading) {
        return (
            <div className="space-y-10">
                <EdgeAnalysisCard isLoading={true} sport={match.sport} />
            </div>
        );
    }

    if (!intel) return null;

    // Transform intel into EdgeResult for the card
    const edgeResult: EdgeResult = {
        type: 'TOTAL',
        impliedLine: match.current_odds?.total || 100,
        modelLine: signals.deterministic_fair_total || 100,
        edgePoints: Math.abs(edgePoints),
        edgeDirection: (edgePoints > 0 ? 'OVER' : 'UNDER'),
        confidence: (intel.prediction.confidence?.score || 68) / 100,
        implications: [intel.summary, intel.tacticalAnalysis].filter(Boolean),
        sources: intel.sources,
        keyInjuries: [],
        trace: {
            pace: signals.blueprint?.pace || signals.system_state?.pace || 0,
            efficiency: signals.blueprint?.efficiency || signals.system_state?.efficiency || 0,
            possessions: signals.blueprint?.possessions || signals.system_state?.possessions || 0
        },
        edgePercent: (Math.abs(edgePoints) / (match.current_odds?.total || 100)) * 100
    };

    return (
        <div className="space-y-10">
            <EdgeAnalysisCard data={edgeResult} sport={match.sport} />

            {/* Reasoning Trace (Atomic Step-wise Logic) */}
            {intel.thought_trace && (
                <div className={cn("p-6", ESSENCE.card.base)}>
                    <div className="flex items-center gap-3 mb-4">
                        <ShieldCheck size={14} className="text-zinc-500" />
                        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Forensic Trace</span>
                    </div>
                    <div className="font-mono text-[11px] text-zinc-500 leading-relaxed max-h-48 overflow-y-auto">
                        {intel.thought_trace}
                    </div>
                </div>
            )}
        </div>
    );
};

export default EdgeAnalysis;
