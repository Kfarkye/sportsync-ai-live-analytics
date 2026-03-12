import React, { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../../lib/supabase';
import { cn } from '@/lib/essence';
import { Activity, TrendingUp, TrendingDown, Minus, Timer } from 'lucide-react';
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

function formatML(val: number | null): string {
    if (val === null) return '—';
    return val > 0 ? `+${val}` : `${val}`;
}

function formatSpread(val: number | null): string {
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
                <div className="w-6 h-6 border-2 border-zinc-800 border-t-zinc-500 rounded-full motion-safe:animate-spin" />
            </div>
        );
    }

    if (plays.length === 0) return (
        <EmptyState
            icon={<Activity size={24} />}
            message="No play-by-play data yet"
            description="PBP timeline appears once the game goes live"
        />
    );

    return (
        <div className="w-full">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]" />
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">
                        Live Timeline
                    </span>
                    <span className="text-[9px] font-mono text-slate-400 ml-1">
                        {plays.length} plays
                    </span>
                </div>
                <div className="flex items-center gap-3">
                    {mktDelta !== null && (
                        <div className={cn(
                            "flex items-center gap-1 px-2 py-0.5 rounded-full",
                            mktDelta > 0 ? "bg-emerald-500/10" : mktDelta < 0 ? "bg-rose-500/10" : "bg-zinc-100"
                        )}>
                            {mktDelta > 0 ? <TrendingUp size={9} className="text-emerald-500" /> :
                             mktDelta < 0 ? <TrendingDown size={9} className="text-rose-500" /> :
                             <Minus size={9} className="text-zinc-400" />}
                            <span className={cn(
                                "text-[9px] font-mono font-bold",
                                mktDelta > 0 ? "text-emerald-600" : mktDelta < 0 ? "text-rose-600" : "text-zinc-500"
                            )}>
                                {mktDelta > 0 ? '+' : ''}{mktDelta.toFixed(1)} total
                            </span>
                        </div>
                    )}
                    <button
                        onClick={() => setShowAll(!showAll)}
                        className={cn(
                            "text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full transition-all",
                            showAll
                                ? "bg-zinc-900 text-white"
                                : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200"
                        )}
                    >
                        {showAll ? 'All Plays' : 'Scoring'}
                    </button>
                </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto rounded-lg border border-zinc-100">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-zinc-50/80 border-b border-zinc-100">
                            <th className="py-2.5 px-2.5 text-[8px] font-black text-zinc-400 uppercase tracking-[0.15em]">Time</th>
                            <th className="py-2.5 px-2.5 text-[8px] font-black text-zinc-400 uppercase tracking-[0.15em] text-center">Score</th>
                            <th className="py-2.5 px-2.5 text-[8px] font-black text-zinc-400 uppercase tracking-[0.15em]">Play</th>
                            <th className="py-2.5 px-2.5 text-[8px] font-black text-zinc-400 uppercase tracking-[0.15em] text-center">Total</th>
                            <th className="py-2.5 px-2.5 text-[8px] font-black text-zinc-400 uppercase tracking-[0.15em] text-center">ML</th>
                            <th className="py-2.5 px-2.5 text-[8px] font-black text-zinc-400 uppercase tracking-[0.15em] text-center">Spread</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-50">
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
                                        r.scoringPlay
                                            ? "bg-emerald-500/[0.03] hover:bg-emerald-500/[0.06]"
                                            : "hover:bg-zinc-50/60"
                                    )}
                                >
                                    {/* Clock + Period */}
                                    <td className="py-2 px-2.5 w-[60px]">
                                        <div className="flex flex-col">
                                            <span className="text-[11px] font-mono font-bold text-zinc-700">{r.clock}</span>
                                            <span className="text-[8px] font-bold text-zinc-400 uppercase">
                                                {r.period <= 2 ? `H${r.period}` : r.period <= 4 ? `Q${r.period}` : `P${r.period}`}
                                            </span>
                                        </div>
                                    </td>

                                    {/* Score */}
                                    <td className="py-2 px-2.5 text-center w-[50px]">
                                        <span className={cn(
                                            "text-[11px] font-mono font-bold",
                                            r.isScoreChange ? "text-zinc-900" : "text-zinc-400"
                                        )}>
                                            {r.home_score}-{r.away_score}
                                        </span>
                                    </td>

                                    {/* Play Text */}
                                    <td className="py-2 px-2.5 max-w-[220px]">
                                        <div className="flex items-center gap-1.5">
                                            {r.scoringPlay && (
                                                <div className="w-1 h-1 rounded-full bg-emerald-500 shrink-0" />
                                            )}
                                            <span className={cn(
                                                "text-[10px] leading-tight truncate",
                                                r.scoringPlay ? "font-bold text-zinc-800" : "text-zinc-500"
                                            )}>
                                                {r.play_text}
                                            </span>
                                        </div>
                                    </td>

                                    {/* Market Total */}
                                    <td className="py-2 px-2.5 text-center w-[52px]">
                                        <span className="text-[10px] font-mono font-bold text-zinc-600">
                                            {r.mkt_total?.toFixed(1) ?? '—'}
                                        </span>
                                    </td>

                                    {/* ML */}
                                    <td className="py-2 px-2.5 text-center w-[52px]">
                                        <span className={cn(
                                            "text-[10px] font-mono font-bold",
                                            r.home_ml !== null && r.home_ml < 0 ? "text-emerald-600" : "text-rose-600"
                                        )}>
                                            {formatML(r.home_ml)}
                                        </span>
                                    </td>

                                    {/* Spread */}
                                    <td className="py-2 px-2.5 text-center w-[52px]">
                                        <span className="text-[10px] font-mono font-bold text-zinc-500">
                                            {formatSpread(r.spread)}
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
                <div className="flex justify-center mt-3">
                    <span className="text-[9px] font-mono text-zinc-400">
                        Showing {displayRows.length} of {showAll ? timeline.length : timeline.filter(r => r.isScoreChange).length} plays
                    </span>
                </div>
            )}
        </div>
    );
};
