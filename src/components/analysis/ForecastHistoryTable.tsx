import React, { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../../lib/supabase';
import { cn } from '@/lib/essence';
import { Activity, TrendingUp, TrendingDown, Minus } from 'lucide-react';
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
    total: number | null;
    overOdds: number | null;
    underOdds: number | null;
    home_ml: number | null;
    away_ml: number | null;
    spread_home: number | null;
    spreadOdds: number | null;
    provider: string | null;
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
    overOdds: number | null;
    underOdds: number | null;
    home_ml: number | null;
    spread: number | null;
    spreadOdds: number | null;
    provider: string | null;
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

function formatAmerican(val: number | null): string {
    if (val === null) return '—';
    return val > 0 ? `+${val}` : `${val}`;
}

function formatJuice(val: number | null): string {
    if (val === null) return '—';
    return val > 0 ? `+${val}` : `${val}`;
}

/** Safely extract a number from Core API's polymorphic odds values */
function parseSafeNum(val: any): number | null {
    if (val === null || val === undefined) return null;
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
        const n = parseInt(val.replace('+', ''), 10);
        return isNaN(n) ? null : n;
    }
    if (val && val.american) {
        const n = parseInt(String(val.american).replace('+', ''), 10);
        return isNaN(n) ? null : n;
    }
    if (val && typeof val.value === 'number') return val.value;
    return null;
}

/** Parse spread — may be a number, string, or nested object */
function parseSafeSpread(val: any): number | null {
    if (val === null || val === undefined) return null;
    if (typeof val === 'number') return val;
    if (typeof val === 'string') { const n = parseFloat(val); return isNaN(n) ? null : n; }
    if (val && typeof val.value === 'number') return val.value;
    return null;
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

            // Fetch live odds from live_odds_snapshots (Secondary — DraftKings-only games)
            const { data: primaryOddsDB } = await supabase
                .from('live_odds_snapshots')
                .select('total, home_ml, away_ml, spread_home, captured_at')
                .eq('match_id', matchId)
                .eq('market_type', 'main')
                .eq('is_live', true)
                .not('total', 'is', null)
                .order('captured_at', { ascending: true });

            // Fetch odds from game_events (PRIMARY — Core API / ESPN aggregate)
            const { data: coreOddsDB } = await supabase
                .from('game_events')
                .select('odds_live, odds_open, odds_close, created_at')
                .eq('match_id', matchId)
                .eq('event_type', 'odds_snapshot')
                .not('odds_live', 'is', null)
                .order('sequence', { ascending: true });

            const mergedOdds: OddsSnapshot[] = [];

            // Core API odds (PRIMARY — full depth)
            if (coreOddsDB) {
                for (const row of coreOddsDB) {
                    if (row.odds_live?.total) {
                        mergedOdds.push({
                            total: typeof row.odds_live.total === 'number' ? row.odds_live.total : parseFloat(row.odds_live.total),
                            overOdds: parseSafeNum(row.odds_live.overOdds),
                            underOdds: parseSafeNum(row.odds_live.underOdds),
                            home_ml: parseSafeNum(row.odds_live.home_ml),
                            away_ml: parseSafeNum(row.odds_live.away_ml),
                            spread_home: parseSafeSpread(row.odds_live.homeSpread),
                            spreadOdds: parseSafeNum(row.odds_live.homeSpreadOdds),
                            provider: row.odds_live.provider || null,
                            captured_at: row.created_at
                        });
                    }
                }
            }

            // live_odds_snapshots (Secondary — fill gaps only)
            if (primaryOddsDB && mergedOdds.length === 0) {
                for (const o of primaryOddsDB) {
                    mergedOdds.push({
                        total: o.total ? parseFloat(String(o.total)) : null,
                        overOdds: null,
                        underOdds: null,
                        home_ml: o.home_ml,
                        away_ml: o.away_ml,
                        spread_home: o.spread_home ? parseFloat(String(o.spread_home)) : null,
                        spreadOdds: null,
                        provider: null,
                        captured_at: o.captured_at
                    });
                }
            }

            mergedOdds.sort((a, b) => new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime());

            if (playData) setPlays(playData);
            setOdds(mergedOdds);
            setLoading(false);
        };

        fetchData();

        // Real-time: new plays + core API odds
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
                    } else if (row.event_type === 'odds_snapshot' && row.odds_live?.total) {
                        setOdds(prev => [...prev, {
                            total: typeof row.odds_live.total === 'number' ? row.odds_live.total : parseFloat(row.odds_live.total),
                            overOdds: parseSafeNum(row.odds_live.overOdds),
                            underOdds: parseSafeNum(row.odds_live.underOdds),
                            home_ml: parseSafeNum(row.odds_live.home_ml),
                            away_ml: parseSafeNum(row.odds_live.away_ml),
                            spread_home: parseSafeSpread(row.odds_live.homeSpread),
                            spreadOdds: parseSafeNum(row.odds_live.homeSpreadOdds),
                            provider: row.odds_live.provider || null,
                            captured_at: row.created_at
                        }].sort((a, b) => new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime()));
                    }
                }
            )
            .subscribe();

        // Real-time: live_odds_snapshots (secondary)
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
                        setOdds(prev => [...prev, {
                            total: parseFloat(String(row.total)),
                            overOdds: null,
                            underOdds: null,
                            home_ml: row.home_ml,
                            away_ml: row.away_ml,
                            spread_home: row.spread_home ? parseFloat(String(row.spread_home)) : null,
                            spreadOdds: null,
                            provider: null,
                            captured_at: row.captured_at
                        }].sort((a, b) =>
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
                mkt_total: nearest?.total ?? null,
                overOdds: nearest?.overOdds ?? null,
                underOdds: nearest?.underOdds ?? null,
                home_ml: nearest?.home_ml ?? null,
                spread: nearest?.spread_home ?? null,
                spreadOdds: nearest?.spreadOdds ?? null,
                provider: nearest?.provider ?? null,
                isScoreChange,
            };
        });
    }, [plays, odds]);

    // Filter: show only scoring plays or all
    const displayRows = useMemo(() => {
        const rows = showAll ? timeline : timeline.filter(r => r.isScoreChange);
        return rows.slice(-30).reverse();
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
            message="No play-by-play data yet"
            description="The market timeline will appear once the game begins."
        />
    );

    return (
        <div className="w-full">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-zinc-900 leading-none">Timeline</h3>
                
                <div className="flex items-center gap-4">
                    {/* Market Delta */}
                    {mktDelta !== null && (
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-zinc-300 bg-zinc-100/80 shadow-sm">
                            {mktDelta > 0 ? <TrendingUp size={14} className="text-emerald-600" /> :
                             mktDelta < 0 ? <TrendingDown size={14} className="text-rose-600" /> :
                             <Minus size={14} className="text-zinc-500" />}
                            <span className={cn(
                                "text-xs font-medium tabular-nums",
                                mktDelta > 0 ? "text-emerald-700" : mktDelta < 0 ? "text-rose-700" : "text-zinc-600"
                            )}>
                                {mktDelta > 0 ? '+' : ''}{mktDelta.toFixed(1)} Total
                            </span>
                        </div>
                    )}

                    {/* Segmented Control */}
                    <div className="flex p-0.5 bg-zinc-200/70 rounded-lg border border-zinc-300/70">
                        <button
                            onClick={() => setShowAll(false)}
                            className={cn(
                                "px-3 py-1.5 text-xs font-medium rounded-md transition-all",
                                !showAll 
                                    ? "bg-white text-zinc-900 shadow-sm border border-zinc-300/70" 
                                    : "text-zinc-700 hover:text-zinc-900 hover:bg-zinc-300/60"
                            )}
                        >
                            Scoring
                        </button>
                        <button
                            onClick={() => setShowAll(true)}
                            className={cn(
                                "px-3 py-1.5 text-xs font-medium rounded-md transition-all",
                                showAll 
                                    ? "bg-white text-zinc-900 shadow-sm border border-zinc-300/70" 
                                    : "text-zinc-700 hover:text-zinc-900 hover:bg-zinc-300/60"
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
                            <th className="py-2.5 px-4 text-xs font-medium text-zinc-700 w-[100px]">Time</th>
                            <th className="py-2.5 px-4 text-xs font-medium text-zinc-700 text-center w-[80px]">Score</th>
                            <th className="py-2.5 px-4 text-xs font-medium text-zinc-700 w-full min-w-[240px]">Play</th>
                            <th className="py-2.5 px-4 text-xs font-medium text-zinc-700 text-right w-[110px]">
                                <div className="flex flex-col items-end">
                                    <span>Total</span>
                                    <span className="text-[10px] text-zinc-600 font-normal">O/U</span>
                                </div>
                            </th>
                            <th className="py-2.5 px-4 text-xs font-medium text-zinc-700 text-right w-[80px]">ML</th>
                            <th className="py-2.5 px-4 text-xs font-medium text-zinc-700 text-right w-[110px]">
                                <div className="flex flex-col items-end">
                                    <span>Spread</span>
                                    <span className="text-[10px] text-zinc-600 font-normal">Juice</span>
                                </div>
                            </th>
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
                                            <span className="text-[11px] font-medium text-zinc-600 w-5">
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
                                            r.isScoreChange ? "font-semibold text-zinc-900" : "font-medium text-zinc-600"
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

                                    {/* Total + O/U Juice */}
                                    <td className="py-3 px-4 text-right">
                                        <div className="flex flex-col items-end">
                                            <span className="text-xs font-mono tabular-nums text-zinc-600">
                                                {r.mkt_total?.toFixed(1) ?? '—'}
                                            </span>
                                            {(r.overOdds !== null || r.underOdds !== null) && (
                                                <span className="text-[10px] font-mono tabular-nums text-zinc-500 mt-0.5">
                                                    o{formatJuice(r.overOdds)} u{formatJuice(r.underOdds)}
                                                </span>
                                            )}
                                        </div>
                                    </td>

                                    {/* ML */}
                                    <td className="py-3 px-4 text-right">
                                        <span className={cn(
                                            "text-xs font-mono tabular-nums",
                                            r.home_ml !== null && r.home_ml < 0 ? "font-medium text-emerald-600" : 
                                            r.home_ml !== null && r.home_ml > 0 ? "font-medium text-rose-600" : 
                                            "text-zinc-600"
                                        )}>
                                            {formatAmerican(r.home_ml)}
                                        </span>
                                    </td>

                                    {/* Spread + Juice */}
                                    <td className="py-3 px-4 text-right">
                                        <div className="flex flex-col items-end">
                                            <span className="text-xs font-mono tabular-nums text-zinc-600">
                                                {formatAmerican(r.spread)}
                                            </span>
                                            {r.spreadOdds !== null && (
                                                <span className="text-[10px] font-mono tabular-nums text-zinc-500 mt-0.5">
                                                    {formatJuice(r.spreadOdds)}
                                                </span>
                                            )}
                                        </div>
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
                    <span className="text-xs text-zinc-600">
                        Showing {displayRows.length} of {showAll ? timeline.length : timeline.filter(r => r.isScoreChange).length} plays
                    </span>
                </div>
            )}
        </div>
    );
};
