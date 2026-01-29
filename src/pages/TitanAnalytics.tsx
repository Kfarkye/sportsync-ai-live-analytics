import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

// ============================================================================
// TYPES (Matching SQL View Output Exactly)
// ============================================================================

interface TitanSummary {
    total_picks: number | null;
    total_wins: number | null;
    total_losses: number | null;
    global_win_rate: number | null;
    best_category_win_rate: number | null;
    best_category: string | null;
}

interface TitanLeague {
    league_id: string;
    total_picks: number | null;
    wins: number | null;
    losses: number | null;
    pushes: number | null;
    win_rate: number | null;
}

interface TitanBucket {
    bucket_id: string;
    total_picks: number | null;
    wins: number | null;
    losses: number | null;
    win_rate: number | null;
}

interface TitanHeatmap {
    category: string;
    total_picks: number | null;
    wins: number | null;
    losses: number | null;
    win_rate: number | null;
    color_class: string | null;
}

interface TitanTrend {
    game_date: string;
    daily_picks: number | null;
    daily_wins: number | null;
    daily_losses: number | null;
    daily_pushes: number | null;
    cumulative_wins: number | null;
    cumulative_losses: number | null;
    daily_win_rate: number | null;
}

interface TitanPayload {
    executive: TitanSummary | null;
    leagues: TitanLeague[] | null;
    buckets: TitanBucket[] | null;
    heatmap: TitanHeatmap[] | null;
    trends: TitanTrend[] | null;
}

// ============================================================================
// SAFE FORMATTERS (Production-Grade Null Safety)
// ============================================================================

const fmt = {
    /** Format as units with sign. Handles null/undefined. */
    units: (n: number | null | undefined): string => {
        if (n === null || n === undefined || isNaN(n)) return '—';
        const val = Number(n);
        return `${val >= 0 ? '+' : ''}${val.toFixed(2)}u`;
    },
    /** Format as percentage. Handles null/undefined. */
    pct: (n: number | null | undefined): string => {
        if (n === null || n === undefined || isNaN(n)) return '—';
        return `${Number(n).toFixed(1)}%`;
    },
    /** Format as integer with locale separators. Handles null/undefined. */
    int: (n: number | null | undefined): string => {
        if (n === null || n === undefined || isNaN(n)) return '0';
        return Math.round(Number(n)).toLocaleString();
    },
    /** Format W-L record. Handles null/undefined. */
    record: (wins: number | null | undefined, losses: number | null | undefined): string => {
        const w = wins ?? 0;
        const l = losses ?? 0;
        return `${w}-${l}`;
    },
};

/** Returns tailwind class for positive/negative coloring */
const cls = (n: number | null | undefined): string => {
    if (n === null || n === undefined || isNaN(n)) return 'text-zinc-500';
    return n >= 0 ? 'text-emerald-400' : 'text-rose-400';
};

/** Simple sparkline SVG */
function Sparkline({ data, color }: { data: number[]; color: string }) {
    if (!data || data.length < 2) return <div className="w-full h-full bg-zinc-900/50 rounded" />;

    const validData = data.filter(d => d !== null && !isNaN(d));
    if (validData.length < 2) return <div className="w-full h-full bg-zinc-900/50 rounded" />;

    const min = Math.min(...validData);
    const max = Math.max(...validData);
    const range = max - min || 1;
    const points = validData.map((d, i) => {
        const x = (i / (validData.length - 1)) * 100;
        const y = 100 - ((d - min) / range) * 100;
        return `${x},${y}`;
    }).join(' ');

    return (
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full">
            <polyline points={points} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
    );
}

// ============================================================================
// LEAGUE MAPPINGS
// ============================================================================

/** Map league_id to parent sport for aggregation */
const leagueToSport: Record<string, string> = {
    // Basketball
    'nba': 'Basketball',
    'mens-college-basketball': 'Basketball',
    'wnba': 'Basketball',
    'womens-college-basketball': 'Basketball',
    // Football
    'nfl': 'Football',
    'college-football': 'Football',
    'cfl': 'Football',
    'xfl': 'Football',
    'ufl': 'Football',
    // Hockey
    'nhl': 'Hockey',
    // Tennis
    'atp': 'Tennis',
    'wta': 'Tennis',
    'tennis': 'Tennis',
    // Baseball
    'mlb': 'Baseball',
    // Soccer - Major Leagues
    'eng.1': 'Soccer',
    'esp.1': 'Soccer',
    'ger.1': 'Soccer',
    'ita.1': 'Soccer',
    'fra.1': 'Soccer',
    'mls': 'Soccer',
    'liga-mx': 'Soccer',
    'epl': 'Soccer',
    'bundesliga': 'Soccer',
    'ligue1': 'Soccer',
    'serie-a': 'Soccer',
    'la-liga': 'Soccer',
    // Soccer - Cups/Tournaments
    'uefa.champions': 'Soccer',
    'uefa.europa': 'Soccer',
    'uefa.nations': 'Soccer',
    'caf.nations': 'Soccer',
    'world-cup': 'Soccer',
    'euro': 'Soccer',
    // MMA
    'ufc': 'MMA',
    'mma': 'MMA',
    // Golf
    'pga': 'Golf',
    'golf': 'Golf',
};

/** Map league_id to human-readable display name */
const leagueDisplayName: Record<string, string> = {
    // Basketball
    'nba': 'NBA',
    'mens-college-basketball': 'NCAAB',
    'wnba': 'WNBA',
    'womens-college-basketball': 'NCAAW',
    // Football
    'nfl': 'NFL',
    'college-football': 'NCAAF',
    'cfl': 'CFL',
    'xfl': 'XFL',
    'ufl': 'UFL',
    // Hockey
    'nhl': 'NHL',
    // Tennis
    'atp': 'ATP',
    'wta': 'WTA',
    'tennis': 'Tennis',
    // Baseball
    'mlb': 'MLB',
    // Soccer
    'eng.1': 'Premier League',
    'esp.1': 'La Liga',
    'ger.1': 'Bundesliga',
    'ita.1': 'Serie A',
    'fra.1': 'Ligue 1',
    'mls': 'MLS',
    'liga-mx': 'Liga MX',
    'epl': 'Premier League',
    'bundesliga': 'Bundesliga',
    'ligue1': 'Ligue 1',
    'serie-a': 'Serie A',
    'la-liga': 'La Liga',
    'uefa.champions': 'Champions League',
    'uefa.europa': 'Europa League',
    'uefa.nations': 'Nations League',
    'caf.nations': 'AFCON',
    'world-cup': 'World Cup',
    'euro': 'Euro',
    // MMA
    'ufc': 'UFC',
    'mma': 'MMA',
    // Golf
    'pga': 'PGA',
    'golf': 'Golf',
};

/** Map internal category names to user-friendly display names */
const categoryDisplayName: Record<string, string> = {
    // Spread bets
    'HOME_FAV': 'Home Spread (Fav)',
    'HOME_DOG': 'Home Spread (Dog)',
    'ROAD_FAV': 'Away Spread (Fav)',
    'ROAD_DOG': 'Away Spread (Dog)',
    // Tennis
    'FAVORITE': 'Tennis (Fav)',
    'UNDERDOG': 'Tennis (Dog)',
    // Totals
    'OVER': 'Total Over',
    'UNDER': 'Total Under',
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function TitanAnalytics() {
    const [data, setData] = useState<TitanPayload | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function fetchData() {
            try {
                const { data: res, error: queryError } = await supabase
                    .from('vw_titan_api_gateway')
                    .select('payload')
                    .single();

                if (queryError) {
                    console.error('[TITAN] Query error:', queryError);
                    setError(queryError.message);
                    return;
                }

                if (res?.payload) {
                    setData(res.payload as TitanPayload);
                    setError(null);
                }
            } catch (e) {
                console.error('[TITAN] Fetch error:', e);
                setError(e instanceof Error ? e.message : 'Unknown error');
            } finally {
                setLoading(false);
            }
        }

        fetchData();
        const interval = setInterval(fetchData, 30000);
        return () => clearInterval(interval);
    }, []);

    // Loading state
    if (loading) {
        return (
            <div className="min-h-screen bg-[#050505] text-white flex items-center justify-center font-mono text-xs">
                LOADING TITAN V3...
            </div>
        );
    }

    // Error state
    if (error) {
        return (
            <div className="min-h-screen bg-[#050505] text-white flex flex-col items-center justify-center gap-4 font-mono text-xs">
                <div className="text-rose-400">ERROR: {error}</div>
                <button
                    onClick={() => window.location.reload()}
                    className="px-4 py-2 bg-zinc-800 rounded hover:bg-zinc-700"
                >
                    RETRY
                </button>
            </div>
        );
    }

    // No data state
    if (!data) {
        return (
            <div className="min-h-screen bg-[#050505] text-white flex items-center justify-center font-mono text-xs text-zinc-500">
                NO DATA AVAILABLE
            </div>
        );
    }

    // Safe data extraction with defaults
    const exec: TitanSummary = data.executive ?? {
        total_picks: null,
        total_wins: null,
        total_losses: null,
        global_win_rate: null,
        best_category_win_rate: null,
        best_category: null,
    };
    const leagues = data.leagues ?? [];
    const buckets = data.buckets ?? [];
    const heatmap = data.heatmap ?? [];
    const trends = data.trends ?? [];

    // Extract cumulative trend data for sparklines (daily win rates)
    const dailyWinRates = trends.map(t => t.daily_win_rate ?? 50);

    // Get latest cumulative record
    const latestTrend = trends.length > 0 ? trends[0] : null;
    const cumulativeRecord = latestTrend
        ? fmt.record(latestTrend.cumulative_wins, latestTrend.cumulative_losses)
        : '—';

    // Calculate Today, Yesterday, This Week records (using LOCAL timezone)
    const formatLocalDate = (date: Date): string => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    const now = new Date();
    const today = formatLocalDate(now);

    const yesterdayDate = new Date(now);
    yesterdayDate.setDate(now.getDate() - 1);
    const yesterday = formatLocalDate(yesterdayDate);

    // Get start of week (Sunday) in local time
    const dayOfWeek = now.getDay();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - dayOfWeek);
    const weekStartStr = formatLocalDate(weekStart);

    const todayData = trends.find(t => t.game_date === today);
    const yesterdayData = trends.find(t => t.game_date === yesterday);
    const weekData = trends.filter(t => t.game_date >= weekStartStr);

    const todayRecord = todayData
        ? fmt.record(todayData.daily_wins, todayData.daily_losses)
        : '—';
    const yesterdayRecord = yesterdayData
        ? fmt.record(yesterdayData.daily_wins, yesterdayData.daily_losses)
        : '—';
    const weekWins = weekData.reduce((sum, t) => sum + (t.daily_wins ?? 0), 0);
    const weekLosses = weekData.reduce((sum, t) => sum + (t.daily_losses ?? 0), 0);
    const weekRecord = weekData.length > 0 ? fmt.record(weekWins, weekLosses) : '—';

    return (
        <div className="min-h-screen bg-[#050505] text-[#EDEDED] font-sans p-8 overflow-y-auto">
            <div className="max-w-7xl mx-auto pb-24">

                {/* Header */}
                <header className="flex justify-between items-end border-b border-[#222] pb-6 mb-8">
                    <h1 className="text-sm font-bold tracking-tight">PICK PERFORMANCE</h1>
                    <div className="font-mono text-[11px] text-zinc-500">LIVE // {new Date().toLocaleTimeString()}</div>
                </header>

                {/* KPI Grid */}
                <div className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-3 pl-1">Executive Summary</div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-[1px] bg-[#222] border border-[#222] rounded-lg overflow-hidden mb-8">

                    <div className="bg-[#0A0A0A] p-5 h-28 flex flex-col justify-between">
                        <div className="text-[11px] font-semibold text-zinc-500">TOTAL PICKS</div>
                        <div className="text-2xl font-medium tracking-tight tabular-nums">{fmt.int(exec.total_picks)}</div>
                        <div className="font-mono text-xs text-zinc-500">GRADED</div>
                    </div>

                    <div className="bg-[#0A0A0A] p-5 h-28 flex flex-col justify-between">
                        <div className="text-[11px] font-semibold text-zinc-500">RECORD</div>
                        <div className="text-2xl font-medium tracking-tight tabular-nums">
                            {fmt.record(exec.total_wins, exec.total_losses)}
                        </div>
                        <div className="font-mono text-xs text-zinc-500">W-L</div>
                    </div>

                    <div className="bg-[#0A0A0A] p-5 h-28 flex flex-col justify-between">
                        <div className="text-[11px] font-semibold text-zinc-500">ALL PICKS WIN RATE</div>
                        <div className={`text-2xl font-medium tracking-tight tabular-nums ${(exec.global_win_rate ?? 0) >= 52.4 ? 'text-emerald-400' : 'text-zinc-300'}`}>
                            {fmt.pct(exec.global_win_rate)}
                        </div>
                        <div className="font-mono text-xs text-zinc-500">Break-even: 52.4%</div>
                    </div>

                    <div className="bg-[#0A0A0A] p-5 h-28 flex flex-col justify-between">
                        <div className="text-[11px] font-semibold text-zinc-500">BEST CATEGORY</div>
                        <div className="text-lg font-medium tracking-tight">
                            {categoryDisplayName[exec.best_category ?? ''] ?? exec.best_category ?? '—'}
                        </div>
                        <div className="font-mono text-xs text-emerald-400">{fmt.pct(exec.best_category_win_rate)}</div>
                    </div>

                </div>

                {/* Quick Records: Today / Yesterday / Week */}
                <div className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-3 pl-1">Quick View</div>
                <div className="grid grid-cols-3 gap-3 mb-8">
                    <div className="bg-[#0A0A0A] border border-[#222] rounded-lg p-4">
                        <div className="text-[11px] font-semibold text-zinc-500 mb-2">TODAY</div>
                        <div className="text-2xl font-medium tabular-nums">{todayRecord}</div>
                    </div>
                    <div className="bg-[#0A0A0A] border border-[#222] rounded-lg p-4">
                        <div className="text-[11px] font-semibold text-zinc-500 mb-2">YESTERDAY</div>
                        <div className="text-2xl font-medium tabular-nums">{yesterdayRecord}</div>
                    </div>
                    <div className="bg-[#0A0A0A] border border-[#222] rounded-lg p-4">
                        <div className="text-[11px] font-semibold text-zinc-500 mb-2">THIS WEEK</div>
                        <div className="text-2xl font-medium tabular-nums">{weekRecord}</div>
                    </div>
                </div>

                {/* Record by Sport (Aggregated) */}
                {leagues.length > 0 && (() => {
                    // Aggregate leagues into sports
                    const sportStats: Record<string, { wins: number; losses: number; picks: number }> = {};

                    leagues.forEach(l => {
                        const leagueId = (l.league_id ?? '').toLowerCase();
                        const sport = leagueToSport[leagueId] || 'Other';

                        if (!sportStats[sport]) {
                            sportStats[sport] = { wins: 0, losses: 0, picks: 0 };
                        }
                        sportStats[sport].wins += l.wins ?? 0;
                        sportStats[sport].losses += l.losses ?? 0;
                        sportStats[sport].picks += l.total_picks ?? 0;
                    });

                    // Convert to array and sort by volume
                    const sportArray = Object.entries(sportStats)
                        .map(([sport, stats]) => ({
                            sport,
                            ...stats,
                            winRate: stats.wins + stats.losses > 0
                                ? (stats.wins / (stats.wins + stats.losses)) * 100
                                : 0
                        }))
                        .filter(s => s.picks >= 10)
                        .sort((a, b) => b.picks - a.picks);

                    return (
                        <>
                            <div className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-3 pl-1">Record by Sport</div>
                            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-8">
                                {sportArray.map((s) => (
                                    <div key={s.sport} className="bg-[#0A0A0A] border border-[#222] rounded-lg p-4">
                                        <div className="text-[10px] font-semibold text-zinc-500 mb-1 truncate uppercase">
                                            {s.sport}
                                        </div>
                                        <div className="text-lg font-medium tabular-nums">
                                            {fmt.record(s.wins, s.losses)}
                                        </div>
                                        <div className={`text-xs font-mono ${s.winRate >= 52.4 ? 'text-emerald-400' : 'text-zinc-500'}`}>
                                            {fmt.pct(s.winRate)}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </>
                    );
                })()}

                {/* Splits */}
                <div className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-3 pl-1">Performance Splits</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">

                    {/* Category Heatmap - Aggregated by category */}
                    <div className="bg-[#0A0A0A] border border-[#222] rounded-lg overflow-hidden">
                        <div className="px-4 py-3 bg-[#111] border-b border-[#222] text-[11px] font-semibold text-zinc-500">
                            CATEGORY
                        </div>
                        {heatmap.length === 0 ? (
                            <div className="px-4 py-6 text-xs text-zinc-600 text-center">No data</div>
                        ) : (() => {
                            // Aggregate heatmap by category (combine all buckets)
                            const categoryStats: Record<string, { wins: number; losses: number }> = {};
                            heatmap.forEach((h) => {
                                const cat = h.category;
                                if (!categoryStats[cat]) {
                                    categoryStats[cat] = { wins: 0, losses: 0 };
                                }
                                categoryStats[cat].wins += h.wins ?? 0;
                                categoryStats[cat].losses += h.losses ?? 0;
                            });

                            // Convert to array, calculate win rate, sort by volume
                            const aggregated = Object.entries(categoryStats)
                                .map(([category, stats]) => ({
                                    category,
                                    ...stats,
                                    winRate: stats.wins + stats.losses > 0
                                        ? (stats.wins / (stats.wins + stats.losses)) * 100
                                        : 0,
                                }))
                                .sort((a, b) => (b.wins + b.losses) - (a.wins + a.losses));

                            return aggregated.map((h) => (
                                <div key={h.category} className="flex justify-between px-4 py-3 border-b border-[#222] last:border-0 hover:bg-white/[0.02]">
                                    <span className="text-xs font-medium">
                                        {categoryDisplayName[h.category] || h.category}
                                    </span>
                                    <div className="text-xs font-mono flex gap-4 min-w-[140px] justify-end">
                                        <span className="text-zinc-400">{fmt.record(h.wins, h.losses)}</span>
                                        <span className={h.winRate >= 52.4 ? 'text-emerald-400' : 'text-zinc-400'}>
                                            {fmt.pct(h.winRate)}
                                        </span>
                                    </div>
                                </div>
                            ));
                        })()}
                    </div>

                    {/* Leagues */}
                    <div className="bg-[#0A0A0A] border border-[#222] rounded-lg overflow-hidden">
                        <div className="px-4 py-3 bg-[#111] border-b border-[#222] text-[11px] font-semibold text-zinc-500">
                            LEAGUE
                        </div>
                        {leagues.length === 0 ? (
                            <div className="px-4 py-6 text-xs text-zinc-600 text-center">No data</div>
                        ) : (
                            leagues
                                .filter(l => (l.total_picks ?? 0) >= 5) // Min 5 picks to show
                                .sort((a, b) => (b.total_picks ?? 0) - (a.total_picks ?? 0))
                                .slice(0, 12)
                                .map((l) => {
                                    const leagueId = (l.league_id ?? '').toLowerCase();
                                    const displayName = leagueDisplayName[leagueId] || (l.league_id ?? '').toUpperCase();
                                    return (
                                        <div key={l.league_id} className="flex justify-between px-4 py-3 border-b border-[#222] last:border-0 hover:bg-white/[0.02]">
                                            <span className="text-xs font-medium">{displayName}</span>
                                            <div className="text-xs font-mono flex gap-4 min-w-[160px] justify-end">
                                                <span className="text-zinc-400">{fmt.record(l.wins, l.losses)}</span>
                                                <span className={(l.win_rate ?? 0) >= 52.4 ? 'text-emerald-400' : 'text-zinc-400'}>
                                                    {fmt.pct(l.win_rate)}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })
                        )}
                    </div>

                </div>

                {/* Spread Buckets */}
                <div className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-3 pl-1">Spread Buckets</div>
                <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                    {buckets.length === 0 ? (
                        <div className="col-span-5 text-xs text-zinc-600 text-center py-6">No bucket data</div>
                    ) : (
                        buckets.map((b) => (
                            <div key={b.bucket_id} className="bg-[#0A0A0A] border border-[#222] rounded-lg p-4">
                                <div className="text-[11px] font-semibold text-zinc-500 mb-3">{b.bucket_id}</div>
                                <div className="flex justify-between text-xs mb-2">
                                    <span className="text-zinc-400">Volume</span>
                                    <span className="font-mono">{fmt.int(b.total_picks)}</span>
                                </div>
                                <div className="flex justify-between text-xs mb-2">
                                    <span className="text-zinc-400">Record</span>
                                    <span className="font-mono">{fmt.record(b.wins, b.losses)}</span>
                                </div>
                                <div className="flex justify-between text-xs">
                                    <span className="text-zinc-400">Win %</span>
                                    <span className={`font-mono ${(b.win_rate ?? 0) >= 52.4 ? 'text-emerald-400' : 'text-zinc-400'}`}>
                                        {fmt.pct(b.win_rate)}
                                    </span>
                                </div>
                            </div>
                        ))
                    )}
                </div>

            </div>
        </div>
    );
}
