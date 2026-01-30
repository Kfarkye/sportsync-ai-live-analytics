import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

// ============================================================================
// TYPES
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
    wins: number | null;
    losses: number | null;
    win_rate: number | null;
}

interface TitanTrend {
    game_date: string;
    daily_picks: number | null;
    daily_wins: number | null;
    daily_losses: number | null;
    daily_pushes: number | null;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const BASELINE = 50;

const CATEGORY_LABELS: Record<string, string> = {
    'FAVORITE': 'Tennis (Favorites)',
    'UNDERDOG': 'Tennis (Underdog)',
    'HOME_FAV': 'Home Spread (Fav)',
    'HOME_DOG': 'Home Spread (Dog)',
    'ROAD_FAV': 'Away Spread (Fav)',
    'ROAD_DOG': 'Away Spread (Dog)',
    'OVER': 'Total Over',
    'UNDER': 'Total Under',
    'PICK_EM': 'Moneyline',
    'MONEYLINE': 'Moneyline'
};

const BUCKET_LABELS: Record<string, string> = {
    '1_Tight (0-3)': 'Tight (0-3)',
    '2_Key (3.5-7)': 'Key Number (3.5-7)',
    '3_Medium (7.5-10)': 'Medium (7.5-10)',
    '4_Blowout (10+)': 'Blowout (10+)',
    '5_Moneyline': 'Moneyline Only'
};

const LEAGUE_LABELS: Record<string, string> = {
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
    // Soccer - Top 5 Leagues
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
    // UEFA Competitions
    'uefa.champions': 'Champions League',
    'uefa.europa': 'Europa League',
    'uefa.nations': 'Nations League',
    // Other
    'caf.nations': 'AFCON',
    'world-cup': 'World Cup',
    'euro': 'Euro',
    'ufc': 'UFC',
    'mma': 'MMA',
    'pga': 'PGA',
    'golf': 'Golf',
};

// ============================================================================
// HELPERS
// ============================================================================

const safe = (n: number | null | undefined): number =>
    n === null || n === undefined || isNaN(n) ? 0 : n;

const winRate = (w: number, l: number): number =>
    w + l > 0 ? (w / (w + l)) * 100 : 0;

const formatPct = (n: number): string => `${n.toFixed(1)}%`;

const formatRecord = (w: number, l: number): string => `${w}-${l}`;

const rateClass = (rate: number): string =>
    rate > BASELINE ? 'text-emerald-400' : 'text-zinc-400';

const barClass = (rate: number): string =>
    rate > BASELINE ? 'bg-gradient-to-r from-emerald-500 to-cyan-400' : 'bg-gradient-to-r from-rose-500 to-orange-400';

// ============================================================================
// COMPONENT
// ============================================================================

export default function TitanAnalytics() {
    const [summary, setSummary] = useState<TitanSummary | null>(null);
    const [leagues, setLeagues] = useState<TitanLeague[]>([]);
    const [buckets, setBuckets] = useState<TitanBucket[]>([]);
    const [heatmap, setHeatmap] = useState<TitanHeatmap[]>([]);
    const [trends, setTrends] = useState<TitanTrend[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function fetchData() {
            try {
                const [summaryRes, leaguesRes, bucketsRes, heatmapRes, trendsRes] = await Promise.all([
                    supabase.from('vw_titan_summary').select('*').single(),
                    supabase.from('vw_titan_leagues').select('*'),
                    supabase.from('vw_titan_buckets').select('*'),
                    supabase.from('vw_titan_heatmap').select('*'),
                    supabase.from('vw_titan_trends').select('*')
                ]);

                if (summaryRes.error) throw summaryRes.error;
                if (leaguesRes.error) throw leaguesRes.error;
                if (bucketsRes.error) throw bucketsRes.error;
                if (heatmapRes.error) throw heatmapRes.error;
                if (trendsRes.error) throw trendsRes.error;

                setSummary(summaryRes.data);
                setLeagues(leaguesRes.data || []);
                setBuckets(bucketsRes.data || []);
                setHeatmap(heatmapRes.data || []);
                setTrends(trendsRes.data || []);
                setError(null);
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

    // Loading
    if (loading) {
        return (
            <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <div className="w-10 h-10 border-2 border-zinc-700 border-t-purple-500 rounded-full animate-spin" />
                    <span className="text-zinc-500 text-sm">Loading analytics...</span>
                </div>
            </div>
        );
    }

    // Error
    if (error) {
        return (
            <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
                <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-6 max-w-md">
                    <div className="text-rose-400 font-semibold mb-2">Failed to load data</div>
                    <div className="text-zinc-400 text-sm">{error}</div>
                </div>
            </div>
        );
    }

    // Calculate aggregated categories from heatmap
    // Filter out PICK_EM/MONEYLINE - these are uncategorized garbage data
    const EXCLUDED_CATEGORIES = ['PICK_EM', 'MONEYLINE'];
    const categoryMap: Record<string, { wins: number; losses: number }> = {};
    heatmap.forEach(row => {
        const cat = row.category;
        if (EXCLUDED_CATEGORIES.includes(cat)) return; // Skip garbage categories
        if (!categoryMap[cat]) categoryMap[cat] = { wins: 0, losses: 0 };
        categoryMap[cat].wins += safe(row.wins);
        categoryMap[cat].losses += safe(row.losses);
    });

    const categories = Object.entries(categoryMap)
        .map(([cat, stats]) => ({
            name: CATEGORY_LABELS[cat] || cat,
            w: stats.wins,
            l: stats.losses,
            rate: winRate(stats.wins, stats.losses)
        }))
        .sort((a, b) => b.rate - a.rate);

    const totalWins = safe(summary?.total_wins);
    const totalLosses = safe(summary?.total_losses);
    const globalRate = safe(summary?.global_win_rate);
    const delta = globalRate - BASELINE;

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-white">
            {/* Noise texture */}
            <div
                className="fixed inset-0 pointer-events-none opacity-[0.02] z-50"
                style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`
                }}
            />

            <div className="max-w-[1400px] mx-auto px-6 py-12">
                {/* Header */}
                <header className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center font-bold text-lg">
                            T
                        </div>
                        <span className="text-xl font-semibold tracking-tight">Titan Analytics</span>
                        <span className="text-xs font-medium bg-purple-500/15 text-purple-300 px-2 py-1 rounded-md ml-2">v3.7</span>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                        <span className="text-sm text-zinc-500">
                            Last updated: {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </span>
                    </div>
                </header>

                {/* Integrity Notice */}
                {safe(summary?.total_picks) !== totalWins + totalLosses && (
                    <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 mb-6">
                        <div className="text-amber-300 text-sm font-semibold mb-1">⚠️ Data Integrity Notice</div>
                        <div className="text-zinc-400 text-xs">
                            Total Picks ({safe(summary?.total_picks)}) includes pushes. Record W+L = {totalWins + totalLosses}.
                        </div>
                    </div>
                )}

                {/* Hero Stats */}
                <div className="grid grid-cols-4 gap-px bg-zinc-800/50 rounded-2xl overflow-hidden mb-8">
                    <div className="bg-[#111] p-8 hover:bg-[#161618] transition-colors">
                        <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Total Picks</div>
                        <div className="text-4xl font-bold tracking-tight mb-1">{safe(summary?.total_picks).toLocaleString()}</div>
                        <div className="text-sm text-zinc-500">Graded picks (W/L/P)</div>
                    </div>
                    <div className="bg-[#111] p-8 hover:bg-[#161618] transition-colors">
                        <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Win Rate</div>
                        <div className={`text-4xl font-bold tracking-tight mb-1 ${rateClass(globalRate)}`}>
                            {formatPct(globalRate)}
                        </div>
                        <div className={`text-sm ${delta >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {delta >= 0 ? '+' : ''}{delta.toFixed(1)}% vs baseline
                        </div>
                    </div>
                    <div className="bg-[#111] p-8 hover:bg-[#161618] transition-colors">
                        <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Record</div>
                        <div className="text-4xl font-bold tracking-tight mb-1">
                            {formatRecord(totalWins, totalLosses)}
                        </div>
                        <div className="text-sm text-zinc-500">W-L (excludes pushes)</div>
                    </div>
                    <div className="bg-[#111] p-8 hover:bg-[#161618] transition-colors">
                        <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Best Category</div>
                        <div className="text-4xl font-bold tracking-tight mb-1 text-emerald-400">
                            {formatPct(safe(summary?.best_category_win_rate))}
                        </div>
                        <div className="text-sm text-zinc-500">
                            {CATEGORY_LABELS[summary?.best_category || ''] || summary?.best_category || '—'}
                        </div>
                    </div>
                </div>

                {/* Quick View - Today, Yesterday, This Week */}
                {(() => {
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
                    const dayOfWeek = now.getDay();
                    const weekStart = new Date(now);
                    weekStart.setDate(now.getDate() - dayOfWeek);
                    const weekStartStr = formatLocalDate(weekStart);

                    const todayData = trends.find(t => t.game_date === today);
                    const yesterdayData = trends.find(t => t.game_date === yesterday);
                    const weekData = trends.filter(t => t.game_date >= weekStartStr);

                    const todayRecord = todayData ? formatRecord(safe(todayData.daily_wins), safe(todayData.daily_losses)) : '—';
                    const yesterdayRecord = yesterdayData ? formatRecord(safe(yesterdayData.daily_wins), safe(yesterdayData.daily_losses)) : '—';
                    const weekWins = weekData.reduce((sum, t) => sum + safe(t.daily_wins), 0);
                    const weekLosses = weekData.reduce((sum, t) => sum + safe(t.daily_losses), 0);
                    const weekRecord = weekData.length > 0 ? formatRecord(weekWins, weekLosses) : '—';

                    return (
                        <div className="mb-8">
                            <div className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-4">Quick View</div>
                            <div className="grid grid-cols-3 gap-4">
                                <div className="bg-[#111] border border-zinc-800 rounded-xl p-5">
                                    <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Today</div>
                                    <div className="text-2xl font-bold tabular-nums">{todayRecord}</div>
                                </div>
                                <div className="bg-[#111] border border-zinc-800 rounded-xl p-5">
                                    <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Yesterday</div>
                                    <div className="text-2xl font-bold tabular-nums">{yesterdayRecord}</div>
                                </div>
                                <div className="bg-[#111] border border-zinc-800 rounded-xl p-5">
                                    <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">This Week</div>
                                    <div className="text-2xl font-bold tabular-nums">{weekRecord}</div>
                                </div>
                            </div>
                        </div>
                    );
                })()}

                {/* Category Performance */}
                <div className="mb-8">
                    <div className="flex items-center justify-between mb-5">
                        <span className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Category Performance</span>
                        <span className="text-xs text-zinc-600">Win rate by pick type</span>
                    </div>
                    <div className="bg-zinc-800/30 rounded-xl overflow-hidden">
                        {/* Header Row */}
                        <div className="grid grid-cols-[1fr_220px_92px] items-center px-6 py-3 bg-white/[0.02] border-b border-zinc-800">
                            <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Category</span>
                            <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Record</span>
                            <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider text-right">Win Rate</span>
                        </div>
                        {/* Data Rows */}
                        {categories.map((c) => (
                            <div
                                key={c.name}
                                className="grid grid-cols-[1fr_220px_92px] items-center px-6 py-5 border-b border-zinc-800/50 last:border-0 hover:bg-white/[0.02] transition-colors"
                            >
                                <span className="text-[15px] font-medium">{c.name}</span>
                                <div className="flex items-center gap-3">
                                    <span className="text-sm text-zinc-400 tabular-nums w-16">{formatRecord(c.w, c.l)}</span>
                                    <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                                        <div
                                            className={`h-full rounded-full transition-all duration-700 ${barClass(c.rate)}`}
                                            style={{ width: `${Math.min(100, c.rate)}%` }}
                                        />
                                    </div>
                                </div>
                                <span className={`text-sm font-semibold tabular-nums text-right ${rateClass(c.rate)}`}>
                                    {formatPct(c.rate)}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Two Column Layout */}
                <div className="grid grid-cols-2 gap-6 mb-8">
                    {/* Spread Buckets */}
                    <div className="bg-[#111] border border-zinc-800 rounded-xl overflow-hidden">
                        <div className="px-6 py-4 border-b border-zinc-800">
                            <span className="text-sm font-semibold">Spread Buckets</span>
                        </div>
                        <div>
                            {buckets
                                .filter((b) => b.bucket_id !== '5_Moneyline') // Exclude garbage bucket
                                .sort((a, b) => (a.bucket_id || '').localeCompare(b.bucket_id || ''))
                                .map((b) => {
                                    const rate = winRate(safe(b.wins), safe(b.losses));
                                    return (
                                        <div key={b.bucket_id} className="grid grid-cols-[1fr_100px_70px] items-center px-6 py-4 border-b border-zinc-800/50 last:border-0">
                                            <span className="text-sm font-medium">{BUCKET_LABELS[b.bucket_id] || b.bucket_id}</span>
                                            <span className="text-sm text-zinc-400 tabular-nums">{formatRecord(safe(b.wins), safe(b.losses))}</span>
                                            <span className={`text-sm font-semibold tabular-nums text-right ${rateClass(rate)}`}>
                                                {formatPct(rate)}
                                            </span>
                                        </div>
                                    );
                                })}
                        </div>
                    </div>

                    {/* League Performance */}
                    <div className="bg-[#111] border border-zinc-800 rounded-xl overflow-hidden">
                        <div className="px-6 py-4 border-b border-zinc-800">
                            <span className="text-sm font-semibold">League Performance</span>
                        </div>
                        <div className="flex flex-wrap gap-2 p-5">
                            {leagues
                                .sort((a, b) => safe(b.total_picks) - safe(a.total_picks))
                                .map((lg) => {
                                    const rate = winRate(safe(lg.wins), safe(lg.losses));
                                    const leagueId = (lg.league_id || '').toLowerCase();
                                    const name = LEAGUE_LABELS[leagueId] || lg.league_id?.toUpperCase() || 'Unknown';
                                    return (
                                        <div
                                            key={lg.league_id}
                                            className="flex items-center gap-2 px-4 py-2.5 bg-white/[0.04] border border-zinc-800 rounded-lg hover:bg-white/[0.08] hover:border-zinc-700 transition-all"
                                        >
                                            <span className="text-sm font-medium uppercase">{name}</span>
                                            <span className="text-xs text-zinc-500">{formatRecord(safe(lg.wins), safe(lg.losses))}</span>
                                            <span className={`text-xs font-semibold ${rateClass(rate)}`}>{formatPct(rate)}</span>
                                        </div>
                                    );
                                })}
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <footer className="mt-16 pt-8 border-t border-zinc-800 flex items-center justify-between">
                    <span className="text-xs text-zinc-600">© 2026 Titan Analytics Engine v3.5.3</span>
                    <div className="flex gap-6">
                        <span className="text-xs text-zinc-500 hover:text-zinc-300 cursor-pointer transition-colors">Documentation</span>
                        <span className="text-xs text-zinc-500 hover:text-zinc-300 cursor-pointer transition-colors">API</span>
                        <span className="text-xs text-zinc-500 hover:text-zinc-300 cursor-pointer transition-colors">Support</span>
                    </div>
                </footer>
            </div>
        </div>
    );
}
