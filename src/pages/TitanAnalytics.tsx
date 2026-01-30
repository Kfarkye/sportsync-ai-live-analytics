"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

// ============================================================================
// TYPES
// ============================================================================

interface TitanSummary {
    total_picks: number | null; // Graded picks (W/L/P)
    total_wins: number | null;
    total_losses: number | null;

    // IMPORTANT: UI expects 0–100 (%). DB views often return 0–1.
    global_win_rate: number | null;

    // Same unit ambiguity.
    best_category_win_rate: number | null;
    best_category: string | null;

    // Optional (recommended): add to vw_titan_summary for clean accounting.
    // total_pushes?: number | null;
}

interface TitanLeague {
    league_id: string;
    total_picks: number | null;
    wins: number | null;
    losses: number | null;
    pushes: number | null;
    win_rate: number | null; // ambiguous unit; we recompute from W/L for display
}

interface TitanBucket {
    bucket_id: string;
    total_picks: number | null;
    wins: number | null;
    losses: number | null;
    win_rate: number | null; // ambiguous unit; we recompute from W/L for display
}

interface TitanHeatmap {
    category: string;
    wins: number | null;
    losses: number | null;
    win_rate: number | null;
}

interface TitanTrend {
    game_date: string; // expected YYYY-MM-DD
    daily_picks: number | null;
    daily_wins: number | null;
    daily_losses: number | null;
    daily_pushes: number | null;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const BASELINE = 50; // % baseline used for coloring

const CATEGORY_LABELS: Record<string, string> = {
    FAVORITE: "Favorites",
    UNDERDOG: "Underdogs",
    HOME_FAV: "Home Spread (Fav)",
    HOME_DOG: "Home Spread (Dog)",
    ROAD_FAV: "Away Spread (Fav)",
    ROAD_DOG: "Away Spread (Dog)",
    OVER: "Total Over",
    UNDER: "Total Under",
    // Hidden from KPIs but labeled if shown
    INTEGRITY_ARTIFACT: "Ingestion Artifact",
};

const BUCKET_LABELS: Record<string, string> = {
    "0_Total": "Totals (O/U)",
    "1_Tight (0-3)": "Tight (0-3)",
    "2_Key (3.5-7)": "Key Number (3.5-7)",
    "3_Medium (7.5-10)": "Medium (7.5-10)",
    "4_Blowout (10+)": "Blowout (10+)",
    "5_NoSpread": "No Spread Data",
};

const LEAGUE_LABELS: Record<string, string> = {
    // Basketball
    nba: "NBA",
    "mens-college-basketball": "NCAAB",
    wnba: "WNBA",
    "womens-college-basketball": "NCAAW",
    // Football
    nfl: "NFL",
    "college-football": "NCAAF",
    cfl: "CFL",
    xfl: "XFL",
    ufl: "UFL",
    // Hockey
    nhl: "NHL",
    // Tennis
    atp: "ATP",
    wta: "WTA",
    tennis: "Tennis",
    // Baseball
    mlb: "MLB",
    // Soccer
    "eng.1": "Premier League",
    "esp.1": "La Liga",
    "ger.1": "Bundesliga",
    "ita.1": "Serie A",
    "fra.1": "Ligue 1",
    mls: "MLS",
    "liga-mx": "Liga MX",
    epl: "Premier League",
    bundesliga: "Bundesliga",
    ligue1: "Ligue 1",
    "serie-a": "Serie A",
    "la-liga": "La Liga",
    // UEFA
    "uefa.champions": "Champions League",
    "uefa.europa": "Europa League",
    "uefa.nations": "Nations League",
    // Other
    "caf.nations": "AFCON",
    "world-cup": "World Cup",
    euro: "Euro",
    ufc: "UFC",
    mma: "MMA",
    pga: "PGA",
    golf: "Golf",
};

// ============================================================================
// HELPERS
// ============================================================================

const safe = (n: number | null | undefined): number =>
    n === null || n === undefined || Number.isNaN(n) ? 0 : n;

// Treat 0–1 as fraction, 0–100 as percent.
// This removes the most common “100× wrong” dashboard failure.
const normalizePct = (n: number | null | undefined): number => {
    const v = safe(n);
    if (v <= 1 && v > 0) return v * 100;
    return v;
};

const winRatePct = (w: number, l: number): number => {
    const denom = w + l;
    return denom > 0 ? (w / denom) * 100 : 0;
};

const formatPct = (n: number): string => `${n.toFixed(1)}%`;
const formatRecord = (w: number, l: number): string => `${w}-${l}`;

const rateClass = (ratePct: number): string =>
    ratePct > BASELINE ? "text-emerald-400" : "text-zinc-400";

const barClass = (ratePct: number): string =>
    ratePct > BASELINE
        ? "bg-gradient-to-r from-emerald-500 to-cyan-400"
        : "bg-gradient-to-r from-rose-500 to-orange-400";

const formatLocalYYYYMMDD = (date: Date): string => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
};

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
    const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);

    useEffect(() => {
        let alive = true;

        async function fetchData() {
            try {
                const [summaryRes, leaguesRes, bucketsRes, heatmapRes, trendsRes] = await Promise.all([
                    supabase.from("vw_titan_summary").select("*").single(),
                    supabase.from("vw_titan_leagues").select("*"),
                    supabase.from("vw_titan_buckets").select("*"),
                    supabase.from("vw_titan_heatmap").select("*"),
                    supabase.from("vw_titan_trends").select("*"),
                ]);

                if (summaryRes.error) throw summaryRes.error;
                if (leaguesRes.error) throw leaguesRes.error;
                if (bucketsRes.error) throw bucketsRes.error;
                if (heatmapRes.error) throw heatmapRes.error;
                if (trendsRes.error) throw trendsRes.error;

                if (!alive) return;

                setSummary(summaryRes.data);
                setLeagues(leaguesRes.data || []);
                setBuckets(bucketsRes.data || []);
                setHeatmap(heatmapRes.data || []);
                setTrends(trendsRes.data || []);
                setError(null);
                setLastUpdatedAt(new Date());
            } catch (e) {
                console.error("[TITAN] Fetch error:", e);
                if (!alive) return;
                setError(e instanceof Error ? e.message : "Unknown error");
            } finally {
                if (!alive) return;
                setLoading(false);
            }
        }

        fetchData();
        const interval = setInterval(fetchData, 30000);

        return () => {
            alive = false;
            clearInterval(interval);
        };
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

    // ========================================================================
    // DERIVED METRICS (memoized)
    // ========================================================================

    const totalWins = safe(summary?.total_wins);
    const totalLosses = safe(summary?.total_losses);
    const totalPicks = safe(summary?.total_picks);

    // Pushes derived from totals (clamped) to prevent negative display.
    const totalPushes = Math.max(0, totalPicks - (totalWins + totalLosses));

    // Normalize summary rates to %.
    const globalRatePct = normalizePct(summary?.global_win_rate);
    const bestCategoryRatePct = normalizePct(summary?.best_category_win_rate);

    const delta = globalRatePct - BASELINE;

    const categories = useMemo(() => {
        // Categories to hide from performance KPIs
        const HIDDEN_CATEGORIES = ['INTEGRITY_ARTIFACT', 'PICK_EM', 'MONEYLINE', 'UNCATEGORIZED'];
        const categoryMap: Record<string, { wins: number; losses: number }> = {};

        for (const row of heatmap) {
            const cat = row.category;
            // Skip hidden categories
            if (HIDDEN_CATEGORIES.includes(cat)) continue;
            if (!categoryMap[cat]) categoryMap[cat] = { wins: 0, losses: 0 };
            categoryMap[cat].wins += safe(row.wins);
            categoryMap[cat].losses += safe(row.losses);
        }

        return Object.entries(categoryMap)
            .map(([cat, stats]) => {
                const rate = winRatePct(stats.wins, stats.losses);
                return {
                    key: cat,
                    name: CATEGORY_LABELS[cat] || cat,
                    w: stats.wins,
                    l: stats.losses,
                    rate,
                };
            })
            .sort((a, b) => b.rate - a.rate);
    }, [heatmap]);

    const quickView = useMemo(() => {
        const now = new Date();
        const today = formatLocalYYYYMMDD(now);

        const yesterdayDate = new Date(now);
        yesterdayDate.setDate(now.getDate() - 1);
        const yesterday = formatLocalYYYYMMDD(yesterdayDate);

        // Week start (Sunday). If you want Monday start, shift logic here.
        const dayOfWeek = now.getDay();
        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() - dayOfWeek);
        const weekStartStr = formatLocalYYYYMMDD(weekStart);

        const todayData = trends.find((t) => t.game_date === today);
        const yesterdayData = trends.find((t) => t.game_date === yesterday);
        const weekData = trends.filter((t) => t.game_date >= weekStartStr);

        const todayRecord = todayData
            ? formatRecord(safe(todayData.daily_wins), safe(todayData.daily_losses))
            : "—";

        const yesterdayRecord = yesterdayData
            ? formatRecord(safe(yesterdayData.daily_wins), safe(yesterdayData.daily_losses))
            : "—";

        const weekWins = weekData.reduce((sum, t) => sum + safe(t.daily_wins), 0);
        const weekLosses = weekData.reduce((sum, t) => sum + safe(t.daily_losses), 0);
        const weekRecord = weekData.length > 0 ? formatRecord(weekWins, weekLosses) : "—";

        return { todayRecord, yesterdayRecord, weekRecord };
    }, [trends]);

    // ========================================================================
    // RENDER
    // ========================================================================

    const lastUpdatedLabel =
        lastUpdatedAt?.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) || "—";

    const bestCategoryLabel =
        CATEGORY_LABELS[summary?.best_category || ""] || summary?.best_category || "—";

    const showIntegrityNotice = totalPicks !== totalWins + totalLosses; // pushes or mismatch

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-white">
            {/* Noise texture */}
            <div
                className="fixed inset-0 pointer-events-none opacity-[0.02] z-50"
                style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
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
                        <span className="text-xs font-medium bg-purple-500/15 text-purple-300 px-2 py-1 rounded-md ml-2">
                            v3.7
                        </span>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                        <span className="text-sm text-zinc-500">Last updated: {lastUpdatedLabel}</span>
                    </div>
                </header>

                {/* Integrity Notice */}
                {showIntegrityNotice && (
                    <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 mb-6">
                        <div className="text-amber-300 text-sm font-semibold mb-1">Data Integrity Notice</div>
                        <div className="text-zinc-400 text-xs">
                            Total Picks = {totalPicks.toLocaleString()} includes pushes. Record W+L = {(totalWins + totalLosses).toLocaleString()}. Pushes ={" "}
                            {totalPushes.toLocaleString()}.
                        </div>
                    </div>
                )}

                {/* Data Quality Panel - Surface hidden ingestion artifacts */}
                {(() => {
                    // Count PICK_EM and other hidden categories from heatmap
                    const hiddenCats = heatmap.filter(r =>
                        ['PICK_EM', 'MONEYLINE', 'INTEGRITY_ARTIFACT', 'UNCATEGORIZED'].includes(r.category)
                    );
                    const totalHiddenW = hiddenCats.reduce((sum, r) => sum + safe(r.wins), 0);
                    const totalHiddenL = hiddenCats.reduce((sum, r) => sum + safe(r.losses), 0);
                    const totalHiddenCount = totalHiddenW + totalHiddenL;
                    const hiddenRate = winRatePct(totalHiddenW, totalHiddenL);

                    if (totalHiddenCount === 0) return null;

                    return (
                        <div className="bg-zinc-800/30 border border-zinc-700/50 rounded-xl p-4 mb-6">
                            <div className="text-zinc-400 text-sm font-semibold mb-1">Data Quality</div>
                            <div className="text-zinc-500 text-xs">
                                Ingestion artifacts detected: {formatRecord(totalHiddenW, totalHiddenL)} ({formatPct(hiddenRate)} win rate).
                                <span className="text-zinc-600 ml-1">
                                    These are picks with missing/invalid market data. Hidden from Category Performance.
                                </span>
                            </div>
                        </div>
                    );
                })()}

                {/* Hero Stats */}
                <div className="grid grid-cols-4 gap-px bg-zinc-800/50 rounded-2xl overflow-hidden mb-8">
                    <div className="bg-[#111] p-8 hover:bg-[#161618] transition-colors">
                        <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Total Picks</div>
                        <div className="text-4xl font-bold tracking-tight mb-1">{totalPicks.toLocaleString()}</div>
                        <div className="text-sm text-zinc-500">Graded picks (W/L/P)</div>
                    </div>

                    <div className="bg-[#111] p-8 hover:bg-[#161618] transition-colors">
                        <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Win Rate</div>
                        <div className={`text-4xl font-bold tracking-tight mb-1 ${rateClass(globalRatePct)}`}>
                            {formatPct(globalRatePct)}
                        </div>
                        <div className={`text-sm ${delta >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                            {delta >= 0 ? "+" : ""}
                            {delta.toFixed(1)}% vs baseline
                        </div>
                    </div>

                    <div className="bg-[#111] p-8 hover:bg-[#161618] transition-colors">
                        <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Record</div>
                        <div className="text-4xl font-bold tracking-tight mb-1">{formatRecord(totalWins, totalLosses)}</div>
                        <div className="text-sm text-zinc-500">W-L (excludes pushes)</div>
                    </div>

                    <div className="bg-[#111] p-8 hover:bg-[#161618] transition-colors">
                        <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Best Category</div>
                        <div className="text-4xl font-bold tracking-tight mb-1 text-emerald-400">{formatPct(bestCategoryRatePct)}</div>
                        <div className="text-sm text-zinc-500">{bestCategoryLabel}</div>
                    </div>
                </div>

                {/* Quick View */}
                <div className="mb-8">
                    <div className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-4">Quick View</div>
                    <div className="grid grid-cols-3 gap-4">
                        <div className="bg-[#111] border border-zinc-800 rounded-xl p-5">
                            <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Today</div>
                            <div className="text-2xl font-bold tabular-nums">{quickView.todayRecord}</div>
                        </div>
                        <div className="bg-[#111] border border-zinc-800 rounded-xl p-5">
                            <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Yesterday</div>
                            <div className="text-2xl font-bold tabular-nums">{quickView.yesterdayRecord}</div>
                        </div>
                        <div className="bg-[#111] border border-zinc-800 rounded-xl p-5">
                            <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">This Week</div>
                            <div className="text-2xl font-bold tabular-nums">{quickView.weekRecord}</div>
                        </div>
                    </div>
                </div>

                {/* Category Performance */}
                <div className="mb-8">
                    <div className="flex items-center justify-between mb-5">
                        <span className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Category Performance</span>
                        <span className="text-xs text-zinc-600">Win rate by pick type</span>
                    </div>

                    <div className="bg-zinc-800/30 rounded-xl overflow-hidden">
                        <div className="grid grid-cols-[1fr_220px_92px] items-center px-6 py-3 bg-white/[0.02] border-b border-zinc-800">
                            <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Category</span>
                            <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Record</span>
                            <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider text-right">Win Rate</span>
                        </div>

                        {categories.map((c) => (
                            <div
                                key={c.key}
                                className="grid grid-cols-[1fr_220px_92px] items-center px-6 py-5 border-b border-zinc-800/50 last:border-0 hover:bg-white/[0.02] transition-colors"
                            >
                                <span className="text-[15px] font-medium">{c.name}</span>

                                <div className="flex items-center gap-3">
                                    <span className="text-sm text-zinc-400 tabular-nums w-16">{formatRecord(c.w, c.l)}</span>
                                    <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                                        <div
                                            className={`h-full rounded-full transition-all duration-700 ${barClass(c.rate)}`}
                                            style={{ width: `${Math.min(100, Math.max(0, c.rate))}%` }}
                                        />
                                    </div>
                                </div>

                                <span className={`text-sm font-semibold tabular-nums text-right ${rateClass(c.rate)}`}>{formatPct(c.rate)}</span>
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
                                .slice()
                                .sort((a, b) => (a.bucket_id || "").localeCompare(b.bucket_id || ""))
                                .map((b) => {
                                    const w = safe(b.wins);
                                    const l = safe(b.losses);
                                    const rate = winRatePct(w, l);
                                    return (
                                        <div
                                            key={b.bucket_id}
                                            className="grid grid-cols-[1fr_100px_70px] items-center px-6 py-4 border-b border-zinc-800/50 last:border-0"
                                        >
                                            <span className="text-sm font-medium">{BUCKET_LABELS[b.bucket_id] || b.bucket_id}</span>
                                            <span className="text-sm text-zinc-400 tabular-nums">{formatRecord(w, l)}</span>
                                            <span className={`text-sm font-semibold tabular-nums text-right ${rateClass(rate)}`}>{formatPct(rate)}</span>
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
                                .slice()
                                .sort((a, b) => safe(b.total_picks) - safe(a.total_picks))
                                .map((lg) => {
                                    const w = safe(lg.wins);
                                    const l = safe(lg.losses);
                                    const rate = winRatePct(w, l);

                                    const leagueId = (lg.league_id || "").toLowerCase();
                                    const name = LEAGUE_LABELS[leagueId] || (lg.league_id ? lg.league_id.toUpperCase() : "UNKNOWN");

                                    return (
                                        <div
                                            key={lg.league_id}
                                            className="flex items-center gap-2 px-4 py-2.5 bg-white/[0.04] border border-zinc-800 rounded-lg hover:bg-white/[0.08] hover:border-zinc-700 transition-all"
                                            title={`Picks: ${safe(lg.total_picks)} | Pushes: ${safe(lg.pushes)}`}
                                        >
                                            <span className="text-sm font-medium uppercase">{name}</span>
                                            <span className="text-xs text-zinc-500">{formatRecord(w, l)}</span>
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
