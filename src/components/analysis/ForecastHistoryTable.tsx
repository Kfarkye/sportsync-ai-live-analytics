import React, { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../../lib/supabase';
import { cn } from '@/lib/essence';
import { Activity, TrendingUp, TrendingDown } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';

// ─── Types ───────────────────────────────────────────────────
interface PlayEvent {
    id: string;
    sequence: number;
    period: number;
    clock: string;
    home_score: number;
    away_score: number;
    play_data: {
        text: string;
        type?: string;
        scoringPlay?: boolean;
    };
    created_at: string;
}

interface OddsSnapshot {
    total: string | null;
    home_ml: number | null;
    away_ml: number | null;
    spread_home: string | null;
    captured_at: string;
}

interface TimelineRow {
    id: string;
    sequence: number;
    period: number;
    clock: string;
    home_score: number;
    away_score: number;
    play_text: string;
    scoringPlay: boolean;
    mkt_total: number | null;
    home_ml: number | null;
    spread: number | null;
    isScoreChange: boolean;
}

interface ForecastHistoryTableProps {
    matchId: string;
}

// ─── Helpers ─────────────────────────────────────────────────
function findNearestOdds(playTime: string, odds: OddsSnapshot[]): OddsSnapshot | null {
    if (!odds.length) return null;
    const pt = new Date(playTime).getTime();
    let best = odds[0];
    let bestDiff = Math.abs(new Date(best.captured_at).getTime() - pt);
    for (const o of odds) {
        const diff = Math.abs(new Date(o.captured_at).getTime() - pt);
        if (diff < bestDiff) { best = o; bestDiff = diff; }
    }
    return best;
}

function formatOdds(val: number | null): string {
    if (val === null) return '—';
    return val > 0 ? `+${val}` : `${val}`;
}

// ─── Component ───────────────────────────────────────────────
export const ForecastHistoryTable: React.FC<ForecastHistoryTableProps> = ({ matchId }) => {
    const [plays, setPlays] = useState<PlayEvent[]>([]);
    const [odds, setOdds] = useState<OddsSnapshot[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAll, setShowAll] = useState(false);

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);

            // Fetch PBP plays from game_events
            const { data: playData } = await supabase
                .from('game_events')
                .select('id, sequence, period, clock, home_score, away_score, play_data, created_at')
                .eq('match_id', matchId)
                .eq('event_type', 'play')
                .order('sequence', { ascending: true });

            // Fetch live odds from live_odds_snapshots
            const { data: oddsData } = await supabase
                .from('live_odds_snapshots')
                .select('total, home_ml, away_ml, spread_home, captured_at')
                .eq('match_id', matchId)
                .eq('market_type', 'main')
                .eq('is_live', true)
                .not('total', 'is', null)
                .order('captured_at', { ascending: true });

            if (playData) setPlays(playData);
            if (oddsData) setOdds(oddsData);
            setLoading(false);
        };

        fetchData();

        // Real-time: new plays
        const playChannel = supabase
            .channel(`pbp_plays:${matchId}`)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'game_events',
                    filter: `match_id=eq.${matchId}`
                },
                (payload) => {
                    const row = payload.new as any;
                    if (row.event_type === 'play') {
                        setPlays(prev => {
                            const exists = prev.some(p => p.sequence === row.sequence);
                            if (exists) return prev;
                            return [...prev, row].sort((a, b) => a.sequence - b.sequence);
                        });
                    }
                }
            )
            .subscribe();

        // Real-time: new odds
        const oddsChannel = supabase
            .channel(`pbp_odds:${matchId}`)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'live_odds_snapshots',
                    filter: `match_id=eq.${matchId}`
                },
                (payload) => {
                    const row = payload.new as any;
                    if (row.market_type === 'main' && row.is_live && row.total) {
                        setOdds(prev => [...prev, row].sort((a, b) =>
                            new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime()
                        ));
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(playChannel);
            supabase.removeChannel(oddsChannel);
        };
    }, [matchId]);

    // Build merged timeline
    const timeline: TimelineRow[] = useMemo(() => {
        if (!plays.length) return [];

        let prevHome = -1;
        let prevAway = -1;

        return plays.map(p => {
            const nearest = findNearestOdds(p.created_at, odds);
            const isScoreChange = p.home_score !== prevHome || p.away_score !== prevAway;
            prevHome = p.home_score;
            prevAway = p.away_score;

            return {
                id: p.id,
                sequence: p.sequence,
                period: p.period,
                clock: p.clock || '—',
                home_score: p.home_score,
                away_score: p.away_score,
                play_text: p.play_data?.text || '',
                scoringPlay: !!p.play_data?.scoringPlay,
                mkt_total: nearest?.total ? parseFloat(nearest.total) : null,
                home_ml: nearest?.home_ml ?? null,
                spread: nearest?.spread_home ? parseFloat(nearest.spread_home) : null,
                isScoreChange,
            };
        });
    }, [plays, odds]);

    // Filter: show only scoring plays or all
    const displayRows = useMemo(() => {
        const rows = showAll ? timeline : timeline.filter(r => r.isScoreChange);
        return rows.slice(-30).reverse(); // Most recent first, cap at 30
    }, [timeline, showAll]);

    // Track market movement
    const mktDelta = useMemo(() => {
        const withTotal = displayRows.filter(r => r.mkt_total !== null);
        if (withTotal.length < 2) return null;
        return (withTotal[0].mkt_total ?? 0) - (withTotal[withTotal.length - 1].mkt_total ?? 0);
    }, [displayRows]);

    if (loading && plays.length === 0) {
        return (
            <div className="flex items-center justify-center p-8">
                <div className="w-5 h-5 border-2 border-zinc-200 border-t-zinc-800 rounded-full animate-spin" />
            </div>
        );
    }

    if (plays.length === 0) return (
        <EmptyState
            icon={<Activity size={20} className="text-zinc-400" />}
            message="No play-by-play data"
            description="The market timeline will appear once the game begins."
        />
    );

    return (
        <div className="w-full">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex flex-col">
                    <h3 className="text-sm font-semibold text-zinc-900 leading-none">Play-by-Play</h3>
                    <span className="text-xs text-zinc-500 mt-1">
                        {plays.length} plays recorded
                    </span>
                </div>
                
                <div className="flex items-center gap-4">
                    {/* Market Delta */}
                    {mktDelta !== null && mktDelta !== 0 && (
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-zinc-200 bg-zinc-50 shadow-sm">
                            {mktDelta > 0 ? <TrendingUp size={14} className="text-zinc-500" /> :
                             <TrendingDown size={14} className="text-zinc-500" />}
                            <span className="text-xs font-medium text-zinc-700">
                                {mktDelta > 0 ? '+' : ''}{mktDelta.toFixed(1)} Total
                            </span>
                        </div>
                    )}

                    {/* Segmented Control */}
                    <div className="flex p-0.5 bg-zinc-100/80 rounded-lg border border-zinc-200/50">
                        <button
                            onClick={() => setShowAll(false)}
                            className={cn(
                                "px-3 py-1.5 text-xs font-medium rounded-md transition-all",
                                !showAll 
                                    ? "bg-white text-zinc-900 shadow-sm border border-zinc-200/50" 
                                    : "text-zinc-500 hover:text-zinc-700 hover:bg-zinc-200/50"
                            )}
                        >
                            Scoring
                        </button>
                        <button
                            onClick={() => setShowAll(true)}
                            className={cn(
                                "px-3 py-1.5 text-xs font-medium rounded-md transition-all",
                                showAll 
                                    ? "bg-white text-zinc-900 shadow-sm border border-zinc-200/50" 
                                    : "text-zinc-500 hover:text-zinc-700 hover:bg-zinc-200/50"
                            )}
                        >
                            All Plays
                        </button>
                    </div>
                </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm">
                <table className="w-full text-left border-collapse whitespace-nowrap">
                    <thead>
                        <tr className="bg-zinc-50/50 border-b border-zinc-200">
                            <th className="py-2.5 px-4 text-xs font-medium text-zinc-500 w-[100px]">Time</th>
                            <th className="py-2.5 px-4 text-xs font-medium text-zinc-500 text-center w-[80px]">Score</th>
                            <th className="py-2.5 px-4 text-xs font-medium text-zinc-500 w-full min-w-[280px]">Play</th>
                            <th className="py-2.5 px-4 text-xs font-medium text-zinc-500 text-right w-[80px]">Total</th>
                            <th className="py-2.5 px-4 text-xs font-medium text-zinc-500 text-right w-[80px]">ML</th>
                            <th className="py-2.5 px-4 text-xs font-medium text-zinc-500 text-right w-[80px]">Spread</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                        <AnimatePresence mode="popLayout">
                            {displayRows.map((r) => (
                                <motion.tr
                                    key={r.id}
                                    initial={{ opacity: 0, y: -4 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0 }}
                                    transition={{ duration: 0.15 }}
                                    className={cn(
                                        "group transition-colors",
                                        r.scoringPlay ? "bg-zinc-50/80 hover:bg-zinc-100/60" : "hover:bg-zinc-50/50"
                                    )}
                                >
                                    {/* Time */}
                                    <td className="py-3 px-4">
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-[11px] font-medium text-zinc-400 w-5">
                                                {r.period <= 2 ? `H${r.period}` : r.period <= 4 ? `Q${r.period}` : `P${r.period}`}
                                            </span>
                                            <span className="text-xs font-mono tabular-nums text-zinc-600">
                                                {r.clock}
                                            </span>
                                        </div>
                                    </td>

                                    {/* Score */}
                                    <td className="py-3 px-4 text-center">
                                        <span className={cn(
                                            "text-xs font-mono tabular-nums",
                                            r.isScoreChange ? "font-semibold text-zinc-900" : "font-medium text-zinc-400"
                                        )}>
                                            {r.home_score} - {r.away_score}
                                        </span>
                                    </td>

                                    {/* Play Text */}
                                    <td className="py-3 px-4 whitespace-normal">
                                        <span className={cn(
                                            "text-xs leading-relaxed line-clamp-2",
                                            r.scoringPlay ? "font-medium text-zinc-900" : "text-zinc-600"
                                        )}>
                                            {r.play_text}
                                        </span>
                                    </td>

                                    {/* Market Total */}
                                    <td className="py-3 px-4 text-right">
                                        <span className="text-xs font-mono tabular-nums text-zinc-600">
                                            {r.mkt_total?.toFixed(1) ?? '—'}
                                        </span>
                                    </td>

                                    {/* ML */}
                                    <td className="py-3 px-4 text-right">
                                        <span className={cn(
                                            "text-xs font-mono tabular-nums",
                                            r.home_ml === null ? "text-zinc-600" : r.home_ml < 0 ? "font-medium text-emerald-600" : "text-zinc-600"
                                        )}>
                                            {formatOdds(r.home_ml)}
                                        </span>
                                    </td>

                                    {/* Spread */}
                                    <td className="py-3 px-4 text-right">
                                        <span className="text-xs font-mono tabular-nums text-zinc-600">
                                            {formatOdds(r.spread)}
                                        </span>
                                    </td>
                                </motion.tr>
                            ))}
                        </AnimatePresence>
                    </tbody>
                </table>
            </div>

            {/* Footer */}
            {timeline.length > 30 && (
                <div className="flex justify-center mt-4">
                    <span className="text-xs text-zinc-400">
                        Showing last {displayRows.length} plays
                    </span>
                </div>
            )}
        </div>
    );
};
