import React, { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../../lib/supabase';
import { cn } from '@/lib/essence';
import { Activity, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { getDbMatchId } from '../../utils/matchUtils';

// ─── Types ───────────────────────────────────────────────────
interface PlayEvent {
    id: string;
    match_id?: string;
    sequence: number;
    period: number;
    clock: string;
    home_score: number;
    away_score: number;
    play_data: {
        id?: string | number;
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
    away_ml: number | null;
    spread: number | null;
    spreadOdds: number | null;
    provider: string | null;
    isScoreChange: boolean;
}

interface ForecastHistoryTableProps {
    matchId: string;
    leagueId?: string;
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

function findOddsBySequence(playSequence: number, minSequence: number, maxSequence: number, odds: OddsSnapshot[]): OddsSnapshot | null {
    if (!odds.length) return null;
    if (maxSequence <= minSequence) return odds[odds.length - 1] ?? null;
    const progress = (playSequence - minSequence) / (maxSequence - minSequence);
    const clamped = Math.max(0, Math.min(1, progress));
    const idx = Math.round(clamped * (odds.length - 1));
    return odds[Math.max(0, Math.min(odds.length - 1, idx))] ?? null;
}

function hasReliablePlayTimestamps(rows: PlayEvent[]): boolean {
    if (rows.length < 6) return true;
    const uniqueTimestamps = new Set(rows.map((row) => row.created_at)).size;
    const uniqueRatio = uniqueTimestamps / rows.length;
    return uniqueTimestamps >= 8 && uniqueRatio >= 0.25;
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
    if (val && typeof val === 'object') {
        if (typeof val.american === 'string' || typeof val.american === 'number') {
            const n = parseInt(String(val.american).replace('+', ''), 10);
            return isNaN(n) ? null : n;
        }
        if (typeof val.value === 'number') return val.value;
        if (typeof val.value === 'string') return parseSafeNum(val.value);
        if (typeof val.price === 'number' || typeof val.price === 'string') return parseSafeNum(val.price);
        if (typeof val.odds === 'number' || typeof val.odds === 'string') return parseSafeNum(val.odds);
        if (typeof val.ml === 'number' || typeof val.ml === 'string') return parseSafeNum(val.ml);
        if (typeof val.moneyline === 'number' || typeof val.moneyline === 'string') return parseSafeNum(val.moneyline);
    }
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

function parseSafeTotal(val: any): number | null {
    if (val === null || val === undefined) return null;
    if (typeof val === 'number') return Number.isFinite(val) ? val : null;
    if (typeof val === 'string') {
        const n = parseFloat(val);
        return Number.isFinite(n) ? n : null;
    }
    if (val && typeof val.line === 'number') return Number.isFinite(val.line) ? val.line : null;
    if (val && typeof val.value === 'number') return Number.isFinite(val.value) ? val.value : null;
    return null;
}

function playKey(play: PlayEvent): string {
    const extId = play.play_data?.id ? String(play.play_data.id) : '';
    return extId ? `play:${extId}` : `seq:${play.sequence}`;
}

function normalizePlayRow(row: any): PlayEvent | null {
    if (!row) return null;
    const sequence = Number(row.sequence);
    if (!Number.isFinite(sequence)) return null;
    const createdAt = row.created_at ? String(row.created_at) : new Date().toISOString();
    return {
        id: row.id ? String(row.id) : `${sequence}:${createdAt}`,
        match_id: row.match_id ? String(row.match_id) : undefined,
        sequence,
        period: Number.isFinite(Number(row.period)) ? Number(row.period) : 0,
        clock: row.clock ? String(row.clock) : '—',
        home_score: Number.isFinite(Number(row.home_score)) ? Number(row.home_score) : 0,
        away_score: Number.isFinite(Number(row.away_score)) ? Number(row.away_score) : 0,
        play_data: (row.play_data && typeof row.play_data === 'object') ? row.play_data : { text: '' },
        created_at: createdAt,
    };
}

function mergePlayRows(rows: PlayEvent[]): PlayEvent[] {
    const map = new Map<string, PlayEvent>();
    for (const play of rows) {
        map.set(playKey(play), play);
    }
    return Array.from(map.values()).sort((a, b) => {
        if (a.sequence !== b.sequence) return a.sequence - b.sequence;
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
}

function normalizeCoreOddsRow(row: any): OddsSnapshot | null {
    const live = row?.odds_live;
    const total = parseSafeTotal(live?.total);
    if (total === null) return null;
    return {
        total,
        overOdds: parseSafeNum(live?.overOdds ?? live?.over_odds),
        underOdds: parseSafeNum(live?.underOdds ?? live?.under_odds),
        home_ml: parseSafeNum(live?.home_ml ?? live?.moneylineHome ?? live?.homeWin ?? live?.homeML),
        away_ml: parseSafeNum(live?.away_ml ?? live?.moneylineAway ?? live?.awayWin ?? live?.awayML),
        spread_home: parseSafeSpread(live?.homeSpread ?? live?.home_spread ?? live?.spread_home ?? live?.spread),
        spreadOdds: parseSafeNum(live?.homeSpreadOdds ?? live?.home_spread_odds ?? live?.spread_home_odds),
        provider: live?.provider || null,
        captured_at: live?.captured_at || row?.created_at || new Date().toISOString(),
    };
}

function normalizeLiveOddsRow(row: any): OddsSnapshot | null {
    if (!row || row.market_type !== 'main' || !row.is_live) return null;
    const total = parseSafeTotal(row.total);
    if (total === null) return null;
    return {
        total,
        overOdds: null,
        underOdds: null,
        home_ml: parseSafeNum(row.home_ml ?? row.moneyline_home ?? row.moneylineHome),
        away_ml: parseSafeNum(row.away_ml ?? row.moneyline_away ?? row.moneylineAway),
        spread_home: parseSafeSpread(row.spread_home ?? row.home_spread),
        spreadOdds: null,
        provider: null,
        captured_at: row.captured_at || row.created_at || new Date().toISOString(),
    };
}

function mergeOddsSnapshots(rows: OddsSnapshot[]): OddsSnapshot[] {
    const map = new Map<string, OddsSnapshot>();
    for (const odds of rows) {
        const key = [
            odds.captured_at,
            odds.provider ?? '',
            odds.total ?? '',
            odds.home_ml ?? '',
            odds.away_ml ?? '',
            odds.spread_home ?? '',
        ].join('|');
        map.set(key, odds);
    }
    return Array.from(map.values()).sort(
        (a, b) => new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime()
    );
}

function withTimeout<T>(promise: PromiseLike<T>, timeoutMs: number): Promise<T | null> {
    return new Promise<T | null>((resolve) => {
        const timer = window.setTimeout(() => resolve(null), timeoutMs);
        Promise.resolve(promise)
            .then((value) => {
                window.clearTimeout(timer);
                resolve(value);
            })
            .catch(() => {
                window.clearTimeout(timer);
                resolve(null);
            });
    });
}

// ─── Component ───────────────────────────────────────────────
export const ForecastHistoryTable: React.FC<ForecastHistoryTableProps> = ({ matchId, leagueId }) => {
    const [plays, setPlays] = useState<PlayEvent[]>([]);
    const [odds, setOdds] = useState<OddsSnapshot[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAll, setShowAll] = useState(false);
    const canonicalMatchId = useMemo(
        () => getDbMatchId(matchId, leagueId?.toLowerCase() || ''),
        [matchId, leagueId]
    );
    const resolvedMatchIds = useMemo(
        () => Array.from(new Set([matchId, canonicalMatchId].filter(Boolean))),
        [matchId, canonicalMatchId]
    );
    const resolvedMatchKey = useMemo(() => resolvedMatchIds.join('|'), [resolvedMatchIds]);

    useEffect(() => {
        let isActive = true;
        let fetchInFlight = false;

        const fetchData = async () => {
            if (fetchInFlight) return;
            fetchInFlight = true;
            try {
                const playPromise = supabase
                    .from('game_events')
                    .select('id, match_id, sequence, period, clock, home_score, away_score, play_data, created_at')
                    .in('match_id', resolvedMatchIds)
                    .eq('event_type', 'play')
                    .order('sequence', { ascending: true });

                const primaryOddsPromise = supabase
                    .from('live_odds_snapshots')
                    .select('total, home_ml, away_ml, spread_home, market_type, is_live, captured_at')
                    .in('match_id', resolvedMatchIds)
                    .eq('market_type', 'main')
                    .eq('is_live', true)
                    .not('total', 'is', null)
                    .order('captured_at', { ascending: true });

                const coreOddsPromise = supabase
                    .from('game_events')
                    .select('odds_live, created_at')
                    .in('match_id', resolvedMatchIds)
                    .eq('event_type', 'odds_snapshot')
                    .not('odds_live', 'is', null)
                    .order('sequence', { ascending: true });

                const playRes = await withTimeout(playPromise, 8000);

                if (!isActive) return;

                const normalizedPlays = mergePlayRows(
                    (playRes?.data ?? [])
                        .map(normalizePlayRow)
                        .filter((row): row is PlayEvent => row !== null)
                );
                setPlays(normalizedPlays);
                setLoading(false);

                const [primaryOddsRes, coreOddsRes] = await Promise.all([
                    withTimeout(primaryOddsPromise, 8000),
                    withTimeout(coreOddsPromise, 8000),
                ]);

                if (!isActive) return;

                const coreOdds = (coreOddsRes?.data ?? [])
                    .map(normalizeCoreOddsRow)
                    .filter((row): row is OddsSnapshot => row !== null);

                const primaryOdds = (primaryOddsRes?.data ?? [])
                    .map(normalizeLiveOddsRow)
                    .filter((row): row is OddsSnapshot => row !== null);

                // Always merge both feeds: core snapshots can be sparse/partial while
                // live_odds_snapshots carries richer line movement for timeline display.
                setOdds(mergeOddsSnapshots([...primaryOdds, ...coreOdds]));
            } finally {
                fetchInFlight = false;
                if (isActive) setLoading(false);
            }
        };

        setLoading(true);
        void fetchData();
        const pollTimer = window.setInterval(() => { void fetchData(); }, 15000);

        const gameEventChannels = resolvedMatchIds.map((id) => (
            supabase
                .channel(`pbp_game_events:${id}`)
                .on(
                    'postgres_changes',
                    {
                        event: '*',
                        schema: 'public',
                        table: 'game_events',
                        filter: `match_id=eq.${id}`
                    },
                    (payload) => {
                        const row = (payload.new ?? payload.old) as any;
                        if (!row) return;
                        if (row.event_type === 'play') {
                            const normalized = normalizePlayRow(row);
                            if (!normalized) return;
                            setPlays(prev => mergePlayRows([...prev, normalized]));
                        } else if (row.event_type === 'odds_snapshot') {
                            const normalized = normalizeCoreOddsRow(row);
                            if (!normalized) return;
                            setOdds(prev => mergeOddsSnapshots([...prev, normalized]));
                        }
                    }
                )
                .subscribe()
        ));

        const liveOddsChannels = resolvedMatchIds.map((id) => (
            supabase
                .channel(`pbp_live_odds:${id}`)
                .on(
                    'postgres_changes',
                    {
                        event: '*',
                        schema: 'public',
                        table: 'live_odds_snapshots',
                        filter: `match_id=eq.${id}`
                    },
                    (payload) => {
                        const row = (payload.new ?? payload.old) as any;
                        const normalized = normalizeLiveOddsRow(row);
                        if (!normalized) return;
                        setOdds(prev => mergeOddsSnapshots([...prev, normalized]));
                    }
                )
                .subscribe()
        ));

        return () => {
            isActive = false;
            window.clearInterval(pollTimer);
            [...gameEventChannels, ...liveOddsChannels].forEach((channel) => {
                supabase.removeChannel(channel);
            });
        };
    }, [resolvedMatchKey]);

    // Build merged timeline
    const timeline: TimelineRow[] = useMemo(() => {
        if (!plays.length) return [];

        const useSequenceMapping = !hasReliablePlayTimestamps(plays);
        const minSequence = plays[0]?.sequence ?? 0;
        const maxSequence = plays[plays.length - 1]?.sequence ?? minSequence;
        let prevHome = -1;
        let prevAway = -1;

        return plays.map(p => {
            const nearest = useSequenceMapping
                ? findOddsBySequence(p.sequence, minSequence, maxSequence, odds)
                : findNearestOdds(p.created_at, odds);
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
                away_ml: nearest?.away_ml ?? null,
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
                                        {(() => {
                                            const mlValue = r.home_ml ?? r.away_ml;
                                            return (
                                                <span className={cn(
                                            "text-xs font-mono tabular-nums",
                                            mlValue !== null && mlValue < 0 ? "font-medium text-emerald-600" :
                                            mlValue !== null && mlValue > 0 ? "font-medium text-rose-600" :
                                            "text-zinc-600"
                                        )}>
                                            {formatAmerican(mlValue)}
                                        </span>
                                            );
                                        })()}
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
