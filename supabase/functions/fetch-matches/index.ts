/**
 * fetch-matches v4.2 — Final Deploy-Ready Build
 * 
 * BUGFIXES (v4.2):
 *   [x] Fixed operator precedence on closing.overUnder ?? closing.total
 *   [x] Removed greedy .includes('Q') that poisoned STATUS_SCHEDULED
 * 
 * V2 PRODUCT LOGIC RESTORED & HARDENED:
 *   [x] current_odds priority extraction (nested + flat schemas + array unwrap).
 *   [x] Game Phase priority (Final -> Closing, Live -> Current, Scheduled -> Waterfall).
 *   [x] raw current_odds passthrough to frontend (for GameInfoStrip).
 *   [x] drawML included globally (with "X" fallback).
 *   [x] Juice/Vig fields (homeSpreadOdds, overOdds, etc) included globally.
 *   [x] formatSpread('PK') properly handles existing "PK" strings and 0 values.
 *   [x] awaySpread accurately derived (-1 * homeSpread) across all fallbacks.
 *   [x] String 'EVEN' -> '+100' normalization.
 *   [x] isLive flag safely inherited through the entire fallback waterfall.
 * 
 * V3 ENTERPRISE IMPROVEMENTS RETAINED:
 *   [x] Connection Pooling + O(1) Trigram memory cache.
 *   [x] Concurrent DB fetching (Promise.allSettled) for massive TTFB drops.
 *   [x] Lazy raw_bookmakers JSON parsing (V8 Memory Saver).
 *   [x] Temporal Collision Protection (No cross-day MLB odds bleeding).
 */

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { getRequestId, jsonResponse, safeJsonBody, weakEtag, type TimingMetric } from '../_shared/http.ts';

declare const Deno: any;

// ─── CORS ────────────────────────────────────────────────────────────────────

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-client-timeout, x-trace-id',
    'Access-Control-Max-Age': '86400',
    'X-Content-Type-Options': 'nosniff',
};

// ─── LEAGUE CONFIG ───────────────────────────────────────────────────────────

const LEAGUE_ODDS_MAP: Record<string, string> = {
    'nfl': 'americanfootball_nfl',
    'nba': 'basketball_nba',
    'mlb': 'baseball_mlb',
    'nhl': 'icehockey_nhl',
    'college-football': 'americanfootball_ncaaf',
    'mens-college-basketball': 'basketball_ncaab',
    'eng.1': 'soccer_epl',
    'epl': 'soccer_epl',
    'usa.1': 'soccer_usa_mls',
    'mls': 'soccer_usa_mls',
    'ita.1': 'soccer_italy_serie_a',
    'seriea': 'soccer_italy_serie_a',
    'esp.1': 'soccer_spain_la_liga',
    'laliga': 'soccer_spain_la_liga',
    'ger.1': 'soccer_germany_bundesliga',
    'bundesliga': 'soccer_germany_bundesliga',
    'fra.1': 'soccer_france_ligue_one',
    'ligue1': 'soccer_france_ligue_one',
    'ned.1': 'soccer_netherlands_eredivisie',
    'por.1': 'soccer_portugal_primeira_liga',
    'bel.1': 'soccer_belgium_first_div',
    'tur.1': 'soccer_turkey_super_league',
    'bra.1': 'soccer_brazil_campeonato',
    'arg.1': 'soccer_argentina_primera_division',
    'sco.1': 'soccer_spl',
    'uefa.champions': 'soccer_uefa_champs_league',
    'ucl': 'soccer_uefa_champs_league',
    'uefa.europa': 'soccer_uefa_europa_league',
    'uel': 'soccer_uefa_europa_league',
    'mex.1': 'soccer_mexico_ligamx',
};

const LEAGUE_SPORT_MAP: Record<string, string> = {
    'nfl': 'NFL', 'nba': 'NBA', 'mlb': 'BASEBALL', 'nhl': 'HOCKEY',
    'college-football': 'COLLEGE_FOOTBALL', 'mens-college-basketball': 'COLLEGE_BASKETBALL',
    'eng.1': 'SOCCER', 'epl': 'SOCCER', 'ita.1': 'SOCCER', 'seriea': 'SOCCER', 'esp.1': 'SOCCER', 'laliga': 'SOCCER', 'ger.1': 'SOCCER', 'bundesliga': 'SOCCER',
    'usa.1': 'SOCCER', 'mls': 'SOCCER', 'fra.1': 'SOCCER', 'ligue1': 'SOCCER', 'mex.1': 'SOCCER', 'uefa.champions': 'SOCCER', 'ucl': 'SOCCER', 'uefa.europa': 'SOCCER', 'uel': 'SOCCER',
    'ned.1': 'SOCCER', 'por.1': 'SOCCER', 'bel.1': 'SOCCER', 'tur.1': 'SOCCER',
    'bra.1': 'SOCCER', 'arg.1': 'SOCCER', 'sco.1': 'SOCCER',
    'wnba': 'WNBA', 'ufc': 'MMA', 'pga': 'GOLF', 'atp': 'TENNIS', 'wta': 'TENNIS'
};

const ALL_LEAGUE_IDS = Array.from(
    new Set([...Object.keys(LEAGUE_SPORT_MAP), ...Object.keys(LEAGUE_ODDS_MAP)])
);
const MAX_PAGE_SIZE = 300;
const DEFAULT_PAGE_SIZE = 140;
const MATCH_SELECT_COLUMNS = [
    'id',
    'league_id',
    'leagueId',
    'sport',
    'start_time',
    'startTime',
    'status',
    'display_clock',
    'period',
    'home_score',
    'away_score',
    'homeTeam',
    'awayTeam',
    'home_team',
    'away_team',
    'home_team_id',
    'away_team_id',
    'ai_signals',
    'current_odds',
    'odds_home_ml_safe',
    'odds_away_ml_safe',
    'odds_draw_ml_safe',
    'odds_home_spread_safe',
    'odds_total_safe',
    'last_odds_update',
].join(',');

// ─── GLOBALS (WARM START POOLING) ────────────────────────────────────────────

let supabaseClient: SupabaseClient | null = null;
const GLOBAL_TRIGRAM_CACHE = new Map<string, Set<string>>();

function getSupabase(): SupabaseClient {
    if (!supabaseClient) {
        const url = Deno.env.get('SUPABASE_URL');
        const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
        if (!url || !key) throw new Error('Missing Supabase configuration');
        supabaseClient = createClient(url, key, { auth: { persistSession: false } });
    }
    return supabaseClient;
}

// ─── DATE UTILITIES ──────────────────────────────────────────────────────────

function parseDateSafely(dateStr: any): string {
    if (typeof dateStr === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim())) {
        return dateStr.trim();
    }
    return new Date().toISOString().split('T')[0];
}

function toBettingSlateDate(safeDate: string): { windowStart: string; windowEnd: string } {
    const [year, month, day] = safeDate.split('-').map(Number);
    const windowStart = new Date(Date.UTC(year, month - 1, day, 10, 0, 0));
    const windowEnd = new Date(Date.UTC(year, month - 1, day + 1, 10, 0, 0));
    return { windowStart: windowStart.toISOString(), windowEnd: windowEnd.toISOString() };
}

function toFootballWeekWindow(safeDate: string): { windowStart: string; windowEnd: string } {
    const d = new Date(safeDate + 'T12:00:00Z');
    const daysFromThursday = (d.getDay() + 7 - 4) % 7;
    const thursday = new Date(d);
    thursday.setDate(d.getDate() - daysFromThursday);
    thursday.setUTCHours(10, 0, 0, 0);
    const wednesday = new Date(thursday);
    wednesday.setDate(thursday.getDate() + 7);
    return { windowStart: thursday.toISOString(), windowEnd: wednesday.toISOString() };
}

// ─── V2 ODDS FORMATTING & LOGIC RESTORATION ──────────────────────────────────

function safeJsonParse(data: any, fallback: any = null): any {
    if (typeof data === 'object' && data !== null) return data;
    try {
        const parsed = typeof data === 'string' ? JSON.parse(data) : fallback;
        if (Array.isArray(parsed) && parsed.length === 0) return null;
        return parsed;
    }
    catch { return fallback; }
}

function formatPrice(p: any): string | null {
    if (p === undefined || p === null || p === '') return null;
    if (typeof p === 'string' && p.toUpperCase() === 'EVEN') return '+100';
    const num = Number(p);
    if (Number.isNaN(num) || !Number.isFinite(num)) return null;
    if (Math.abs(num) >= 100) return num > 0 ? `+${Math.round(num)}` : `${Math.round(num)}`;
    return num >= 2.0 ? `+${Math.round((num - 1) * 100)}` : `${Math.round(-100 / (num - 1))}`;
}

function formatSpread(val: any): string | null {
    if (val === undefined || val === null || val === '') return null;
    if (typeof val === 'string' && val.toUpperCase() === 'PK') return 'PK';
    const num = Number(val);
    if (Number.isNaN(num) || !Number.isFinite(num)) return null;
    if (num === 0 || num === -0) return 'PK';
    return num > 0 ? `+${num}` : `${num}`;
}

function invertSpread(val: any): number | string | null {
    if (val === undefined || val === null || val === '') return null;
    if (typeof val === 'string' && val.toUpperCase() === 'PK') return 'PK';
    const num = Number(val);
    if (Number.isNaN(num) || !Number.isFinite(num)) return null;
    return num === 0 ? 0 : -num;
}

function extractFromCurrentOdds(co: any, isLive: boolean = false): any | null {
    if (!co) return null;
    let data = typeof co === 'string' ? safeJsonParse(co) : co;
    if (Array.isArray(data)) data = data.length > 0 ? data[0] : null;
    if (!data || typeof data !== 'object') return null;

    const res: any = { provider: data.provider?.name || data.provider || 'Consensus', isLive };
    let hasData = false;

    const isNestedSchema = (data.moneyline && typeof data.moneyline === 'object') ||
        (data.spread && typeof data.spread === 'object') ||
        (data.total && typeof data.total === 'object');

    if (isNestedSchema) {
        if (data.moneyline && typeof data.moneyline === 'object') {
            res.homeML = formatPrice(data.moneyline.home);
            res.awayML = formatPrice(data.moneyline.away);
            res.drawML = formatPrice(data.moneyline.draw);
            hasData = true;
        }
        if (data.spread && typeof data.spread === 'object') {
            res.homeSpread = formatSpread(data.spread.home);
            const as = data.spread.away ?? invertSpread(data.spread.home);
            res.awaySpread = formatSpread(as);
            res.homeSpreadOdds = formatPrice(data.spread.homeOdds);
            res.awaySpreadOdds = formatPrice(data.spread.awayOdds);
            hasData = true;
        }
        if (data.total && typeof data.total === 'object') {
            const ou = data.total.over ?? data.total.under ?? data.total.overUnder;
            res.overUnder = ou != null ? `${ou}` : null;
            res.overOdds = formatPrice(data.total.overOdds);
            res.underOdds = formatPrice(data.total.underOdds);
            hasData = true;
        }
    }

    if (!hasData) {
        res.homeML = formatPrice(data.homeML ?? data.home_ml ?? data.moneylineHome);
        res.awayML = formatPrice(data.awayML ?? data.away_ml ?? data.moneylineAway);
        res.drawML = formatPrice(data.drawML ?? data.draw_ml ?? data.moneylineDraw);

        const hs = data.homeSpread ?? data.home_spread ?? data.spreadHome ?? data.spread;
        res.homeSpread = formatSpread(hs);
        const as = data.awaySpread ?? data.away_spread ?? data.spreadAway ?? invertSpread(hs);
        res.awaySpread = formatSpread(as);

        res.homeSpreadOdds = formatPrice(data.homeSpreadOdds ?? data.home_spread_odds);
        res.awaySpreadOdds = formatPrice(data.awaySpreadOdds ?? data.away_spread_odds);

        const ou = data.overUnder ?? data.over_under ?? data.total;
        res.overUnder = ou != null ? `${ou}` : null;
        res.overOdds = formatPrice(data.overOdds ?? data.over_odds);
        res.underOdds = formatPrice(data.underOdds ?? data.under_odds);

        if (res.homeML != null || res.homeSpread != null || res.overUnder != null) hasData = true;
    }

    res.moneylineHome = res.homeML;
    res.moneylineAway = res.awayML;
    res.lastUpdated = data.lastUpdated ?? data.last_update ?? null;

    return hasData ? { hasOdds: true, ...res } : null;
}

// ─── TRIGRAM MATCHING (O(1) OPTIMIZED) ───────────────────────────────────────

const normalize = (s?: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const ABBREVIATIONS: Array<[RegExp, string]> = [
    [/\b(la|l\.a\.)\b/g, 'los angeles'], [/\b(ny|n\.y\.)\b/g, 'new york'],
    [/\b(nj|n\.j\.)\b/g, 'new jersey'], [/\b(wsh|wash)\b/g, 'washington'],
    [/\b(tb)\b/g, 'tampa bay'], [/\b(sf)\b/g, 'san francisco'],
    [/\b(lv|vegas)\b/g, 'las vegas'], [/\b(kc)\b/g, 'kansas city'],
    [/\b(sd)\b/g, 'san diego'], [/\b(ne)\b/g, 'new england'],
    [/\b(no)\b/g, 'new orleans'],
];

const expandAbbreviations = (s: string): string => {
    let lower = (s || '').toLowerCase();
    for (let i = 0; i < ABBREVIATIONS.length; i++) {
        lower = lower.replace(ABBREVIATIONS[i][0], ABBREVIATIONS[i][1]);
    }
    return lower.replace(/[^a-z0-9]/g, '');
};

function getTrigrams(s: string): Set<string> {
    if (!s) return new Set();
    const cleaned = s.trim().replace(/\s+/g, ' ').toLowerCase();

    if (GLOBAL_TRIGRAM_CACHE.has(cleaned)) return GLOBAL_TRIGRAM_CACHE.get(cleaned)!;
    if (GLOBAL_TRIGRAM_CACHE.size > 2000) GLOBAL_TRIGRAM_CACHE.clear();

    const expanded = expandAbbreviations(cleaned);
    const trigrams = new Set<string>();
    const str = `  ${expanded}  `;
    for (let i = 0; i <= str.length - 3; i++) {
        trigrams.add(str.substring(i, i + 3));
    }

    GLOBAL_TRIGRAM_CACHE.set(cleaned, trigrams);
    return trigrams;
}

function calculateSimilarity(t1: Set<string>, t2: Set<string>, threshold: number = 0): number {
    if (t1.size === 0 || t2.size === 0) return 0;
    const totalSize = t1.size + t2.size;
    const maxPossibleIntersection = t1.size < t2.size ? t1.size : t2.size;
    if (threshold > 0 && (2 * maxPossibleIntersection) / totalSize < threshold) return 0;

    let intersection = 0;
    const [smaller, larger] = t1.size < t2.size ? [t1, t2] : [t2, t1];
    for (const t of smaller) {
        if (larger.has(t)) intersection++;
    }
    return (2 * intersection) / totalSize;
}

function toPageSize(raw: unknown): number {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return DEFAULT_PAGE_SIZE;
    return Math.max(1, Math.min(MAX_PAGE_SIZE, Math.floor(parsed)));
}

function isLiveStatus(status: string): boolean {
    const s = (status || '').toUpperCase();
    return s.includes('IN_PROGRESS') ||
        s.includes('HALFTIME') ||
        s === 'HT' ||
        s.includes('LIVE') ||
        s.includes('PERIOD') ||
        ['Q1', 'Q2', 'Q3', 'Q4', '1Q', '2Q', '3Q', '4Q'].some(q => s.includes(q));
}

function isFinalStatus(status: string): boolean {
    const s = (status || '').toUpperCase();
    return s.includes('FINAL') || s.includes('COMPLETED') || s === 'FT' || s.includes('POSTPONED') || s.includes('CANCELED');
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    const tStart = Date.now();
    const requestId = getRequestId(req);
    const timings: TimingMetric[] = [];

    try {
        const supabase = getSupabase();

        // ── Parse + Validate Request ─────────────────────────────────────────
        const parseStart = Date.now();
        const parsedBody = await safeJsonBody<any>(req, 64 * 1024);
        if (!parsedBody.ok) {
            return jsonResponse(
                { error: parsedBody.error, matches: [] },
                {
                    status: 400,
                    cors: corsHeaders,
                    requestId,
                    cacheControl: 'no-store',
                }
            );
        }

        const body = parsedBody.value || {};
        const urlParams = new URL(req.url).searchParams;
        const date = parseDateSafely(urlParams.get('date') || body.date);
        const pageSize = toPageSize(urlParams.get('limit') ?? body.limit);

        let leagueIds: string[] = ALL_LEAGUE_IDS;
        if (Array.isArray(body.leagues) && body.leagues.length > 0) {
            leagueIds = body.leagues
                .map((l: any) => (typeof l === 'string' ? l : l?.id))
                .filter(Boolean);
        }

        const leagueFilter = body.leagueId || urlParams.get('league');
        if (leagueFilter) leagueIds = [leagueFilter];

        leagueIds = [...new Set(leagueIds)].filter((id) => ALL_LEAGUE_IDS.includes(id));
        if (leagueIds.length === 0) leagueIds = ALL_LEAGUE_IDS;
        timings.push({ name: 'parse', dur: Date.now() - parseStart, desc: 'parse+validate' });

        // ── 1. Construct Concurrent DB Queries ───────────────────────────────
        const dbStart = Date.now();
        const footballLeagues = leagueIds.filter(id => id === 'nfl' || id === 'college-football');
        const dailyLeagues = leagueIds.filter(id => id !== 'nfl' && id !== 'college-football');
        const oddsKeys = [...new Set(leagueIds.map(id => LEAGUE_ODDS_MAP[id]).filter(Boolean))];
        const bucketCount = (dailyLeagues.length > 0 ? 1 : 0) + (footballLeagues.length > 0 ? 1 : 0);
        const bucketPageSize = Math.max(20, Math.ceil(pageSize / Math.max(1, bucketCount)));

        const dbPromises: Promise<any>[] = [];

        if (dailyLeagues.length > 0) {
            const { windowStart, windowEnd } = toBettingSlateDate(date);
            dbPromises.push(
                supabase
                    .from('matches')
                    .select(MATCH_SELECT_COLUMNS)
                    .in('league_id', dailyLeagues)
                    .gte('start_time', windowStart)
                    .lt('start_time', windowEnd)
                    .order('start_time', { ascending: true })
                    .limit(bucketPageSize)
            );
        }

        if (footballLeagues.length > 0) {
            const { windowStart, windowEnd } = toFootballWeekWindow(date);
            dbPromises.push(
                supabase
                    .from('matches')
                    .select(MATCH_SELECT_COLUMNS)
                    .in('league_id', footballLeagues)
                    .gte('start_time', windowStart)
                    .lt('start_time', windowEnd)
                    .order('start_time', { ascending: true })
                    .limit(bucketPageSize)
            );
        }

        const feedsPromise = oddsKeys.length > 0
            ? supabase
                .from('market_feeds')
                .select('match_id, home_team, away_team, raw_bookmakers, last_updated, sport_key, best_spread, best_total, best_h2h, commence_time')
                .in('sport_key', oddsKeys)
                .gte('commence_time', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
                .order('last_updated', { ascending: false })
            : Promise.resolve({ data: [], error: null });

        const settled = await Promise.allSettled([feedsPromise, ...dbPromises]);

        const feedsResult = settled[0];
        const feedsData = feedsResult.status === 'fulfilled' && feedsResult.value?.data ? feedsResult.value.data : [];

        const dbMatches: any[] = [];
        for (let i = 1; i < settled.length; i++) {
            const res = settled[i];
            if (res.status === 'fulfilled' && res.value?.data) dbMatches.push(...res.value.data);
        }

        timings.push({ name: 'db', dur: Date.now() - dbStart, desc: 'matches+feeds' });

        if (dbMatches.length === 0) {
            const elapsed = Date.now() - tStart;
            const cacheControl = 'public, max-age=10, stale-while-revalidate=20';
            const etag = weakEtag(`${date}|${leagueIds.join(',')}|0`);
            if (req.headers.get('if-none-match') === etag) {
                return new Response(null, {
                    status: 304,
                    headers: { ...corsHeaders, 'Cache-Control': cacheControl, ETag: etag, 'X-Request-Id': requestId },
                });
            }
            return jsonResponse([], {
                cors: corsHeaders,
                requestId,
                cacheControl,
                timings,
                extraHeaders: { ETag: etag, 'X-Elapsed-Ms': String(elapsed), 'X-Matches-Count': '0' },
            });
        }

        // ── 2. Process Odds Feeds (Lazy Parsing & Bucketing) ─────────────────
        const oddsStart = Date.now();
        const exactOddsMap = new Map<string, any>();
        const sportBuckets = new Map<string, any[]>();

        if (feedsData.length > 0) {
            for (const f of feedsData) {
                const payload = {
                    match_id: f.match_id,
                    home_team: f.home_team,
                    away_team: f.away_team,
                    sport_key: f.sport_key,
                    raw_bookmakers: f.raw_bookmakers,
                    best_spread: safeJsonParse(f.best_spread),
                    best_total: safeJsonParse(f.best_total),
                    best_h2h: safeJsonParse(f.best_h2h),
                    last_updated: f.last_updated,
                    commence_time_ms: f.commence_time ? Date.parse(f.commence_time) : null,
                    home_trigrams: getTrigrams(f.home_team),
                    away_trigrams: getTrigrams(f.away_team),
                };

                let bucket = sportBuckets.get(f.sport_key);
                if (!bucket) {
                    bucket = [];
                    sportBuckets.set(f.sport_key, bucket);
                }
                bucket.push(payload);

                if (f.match_id && !exactOddsMap.has(f.match_id)) exactOddsMap.set(f.match_id, payload);

                const exactKey = `${f.sport_key}|${normalize(f.home_team)}|${normalize(f.away_team)}`;
                if (!exactOddsMap.has(exactKey)) exactOddsMap.set(exactKey, payload);
            }
        }

        timings.push({ name: 'odds_map', dur: Date.now() - oddsStart, desc: 'odds lookup indexing' });

        // ── 3. Fetch Closing Lines ────────────────────────────────────────────
        const closingStart = Date.now();
        const closingMap = new Map<string, any>();
        const edgeTagMap = new Map<string, any[]>();
        const matchIds = dbMatches.map(m => m.id).filter(Boolean);

        if (matchIds.length > 0) {
            try {
                const chunkSize = 200;
                const chunkPromises = [];

                for (let i = 0; i < matchIds.length; i += chunkSize) {
                    const chunk = matchIds.slice(i, i + chunkSize);
                    chunkPromises.push(supabase.from('closing_lines')
                        .select('match_id, provider, home_spread, away_spread, total, home_ml, away_ml, draw_ml')
                        .in('match_id', chunk));
                }

                const chunkResults = await Promise.allSettled(chunkPromises);
                for (const res of chunkResults) {
                    if (res.status === 'fulfilled' && res.value?.data) {
                        for (const row of res.value.data) {
                            closingMap.set(row.match_id, {
                                provider: row.provider,
                                homeSpread: row.home_spread,
                                awaySpread: row.away_spread,
                                overUnder: row.total,
                                homeWin: row.home_ml,
                                awayWin: row.away_ml,
                                draw: row.draw_ml,
                                spread: row.home_spread,
                            });
                        }
                    }
                }
            } catch (e) {
                console.error(JSON.stringify({ level: 'warn', requestId, message: 'closing_lines_fetch_failed', error: String(e) }));
            }
        }
        timings.push({ name: 'closing', dur: Date.now() - closingStart, desc: 'closing lines join' });

        // ── 3B. Fetch Match Edge Tags (Trend Intelligence) ───────────────────
        const edgeTagStart = Date.now();
        if (matchIds.length > 0) {
            try {
                const chunkSize = 200;
                const canonicalIds = Array.from(
                    new Set(
                        matchIds.flatMap((id) => {
                            const str = String(id);
                            const stripped = str.split('_')[0];
                            return stripped && stripped !== str ? [str, stripped] : [str];
                        })
                    )
                );

                const chunkPromises = [];
                for (let i = 0; i < canonicalIds.length; i += chunkSize) {
                    const chunk = canonicalIds.slice(i, i + chunkSize);
                    chunkPromises.push(
                        supabase
                            .from('match_edge_tags')
                            .select('match_id, trend_key, tag_type, status, edge_payload, created_at')
                            .in('match_id', chunk)
                            .eq('status', 'active')
                            .order('created_at', { ascending: false })
                    );
                }

                const chunkResults = await Promise.allSettled(chunkPromises);
                for (const res of chunkResults) {
                    if (res.status !== 'fulfilled' || !res.value?.data) continue;
                    for (const row of res.value.data) {
                        const rawId = String(row.match_id || '');
                        if (!rawId) continue;
                        const strippedId = rawId.split('_')[0];
                        const keys = rawId === strippedId ? [rawId] : [rawId, strippedId];

                        for (const key of keys) {
                            if (!edgeTagMap.has(key)) edgeTagMap.set(key, []);
                            edgeTagMap.get(key)!.push({
                                trend_key: row.trend_key,
                                tag_type: row.tag_type,
                                status: row.status,
                                edge_payload: row.edge_payload || {},
                            });
                        }
                    }
                }

                // Keep payload compact and deterministic for feed performance.
                edgeTagMap.forEach((tags, key) => {
                    const unique = new Map<string, any>();
                    for (const tag of tags) {
                        const dedupeKey = `${String(tag.trend_key || '')}|${String(tag.tag_type || '')}`;
                        if (!unique.has(dedupeKey)) unique.set(dedupeKey, tag);
                    }
                    edgeTagMap.set(key, Array.from(unique.values()).slice(0, 3));
                });
            } catch (e) {
                console.error(JSON.stringify({ level: 'warn', requestId, message: 'match_edge_tags_fetch_failed', error: String(e) }));
            }
        }
        timings.push({ name: 'edge_tags', dur: Date.now() - edgeTagStart, desc: 'edge tags join' });

        // ── 4. Shape Response ────────────────────────────────────────────────
        const shapeStart = Date.now();
        const matches = dbMatches.map(m => {
            const homeObj = typeof m.homeTeam === 'object' && m.homeTeam ? m.homeTeam : { displayName: m.home_team, name: m.home_team };
            const awayObj = typeof m.awayTeam === 'object' && m.awayTeam ? m.awayTeam : { displayName: m.away_team, name: m.away_team };

            const homeDisplayName = homeObj.displayName || m.home_team || 'Unknown';
            const awayDisplayName = awayObj.displayName || m.away_team || 'Unknown';

            const match: any = {
                id: m.id,
                leagueId: m.leagueId || m.league_id,
                sport: LEAGUE_SPORT_MAP[m.leagueId || m.league_id] || m.sport || m.leagueId || m.league_id || '',
                startTime: m.startTime || m.start_time,
                status: m.status || 'STATUS_SCHEDULED',
                displayClock: m.display_clock || '0:00',
                period: m.period || 0,
                homeTeam: { ...homeObj, id: homeObj.id || m.home_team_id, name: homeObj.name || m.home_team },
                awayTeam: { ...awayObj, id: awayObj.id || m.away_team_id, name: awayObj.name || m.away_team },
                homeScore: String(m.home_score ?? homeObj.score ?? 0),
                awayScore: String(m.away_score ?? awayObj.score ?? 0),
                edge_tags: edgeTagMap.get(String(m.id)) || edgeTagMap.get(String(m.id).split('_')[0]) || [],
            };

            match.homeTeam.score = match.homeScore;
            match.awayTeam.score = match.awayScore;

            match.current_odds = safeJsonParse(m.current_odds);
            match.ai_signals = safeJsonParse(m.ai_signals);

            const closing = closingMap.get(m.id);
            if (closing) match.closing_odds = closing;

            const statusUpper = String(match.status || '').toUpperCase();
            const isFinal = isFinalStatus(statusUpper);
            const isInProgress = isLiveStatus(statusUpper);

            let resolvedOdds: any = null;

            // ── PHASE 1: FINAL GAMES ──────────────────────────────────────────
            if (isFinal && closing) {
                const hs = closing.homeSpread ?? closing.spread;
                const as = closing.awaySpread ?? invertSpread(hs);

                resolvedOdds = {
                    hasOdds: true, isClosing: true, isLive: false,
                    provider: closing.provider || 'Closing Odds',
                    homeSpread: formatSpread(hs),
                    awaySpread: formatSpread(as),
                    // FIX: Strict parentheses around null coalescing for precedence
                    overUnder: (closing.overUnder ?? closing.total) != null ? `${closing.overUnder ?? closing.total}` : null,
                    homeML: formatPrice(closing.homeWin ?? closing.home_ml),
                    awayML: formatPrice(closing.awayWin ?? closing.away_ml),
                    drawML: formatPrice(closing.draw ?? closing.draw_ml),
                    moneylineHome: formatPrice(closing.homeWin ?? closing.home_ml),
                    moneylineAway: formatPrice(closing.awayWin ?? closing.away_ml),
                    homeSpreadOdds: null, awaySpreadOdds: null, overOdds: null, underOdds: null,
                    lastUpdated: match.startTime
                };
            }
            // ── PHASE 2: LIVE GAMES ───────────────────────────────────────────
            else if (isInProgress && m.current_odds) {
                resolvedOdds = extractFromCurrentOdds(m.current_odds, true);
            }

            // ── PHASE 3: WATERFALL FALLBACKS ──────────────────────────────────
            if (!resolvedOdds || !resolvedOdds.hasOdds) {

                if (m.current_odds) {
                    resolvedOdds = extractFromCurrentOdds(m.current_odds, isInProgress);
                }

                if ((!resolvedOdds || !resolvedOdds.hasOdds) && (m.odds_home_ml_safe != null || m.odds_home_spread_safe != null || m.odds_total_safe != null)) {
                    const hs = m.odds_home_spread_safe;
                    const as = invertSpread(hs);
                    resolvedOdds = {
                        hasOdds: true, provider: 'Consensus',
                        isLive: isInProgress,
                        homeSpread: formatSpread(hs),
                        awaySpread: formatSpread(as),
                        overUnder: m.odds_total_safe != null ? `${m.odds_total_safe}` : null,
                        homeML: formatPrice(m.odds_home_ml_safe),
                        awayML: formatPrice(m.odds_away_ml_safe),
                        drawML: formatPrice(m.odds_draw_ml_safe),
                        moneylineHome: formatPrice(m.odds_home_ml_safe),
                        moneylineAway: formatPrice(m.odds_away_ml_safe),
                        homeSpreadOdds: null, awaySpreadOdds: null, overOdds: null, underOdds: null,
                        lastUpdated: m.last_odds_update,
                    };
                }

                if (!resolvedOdds || !resolvedOdds.hasOdds) {
                    const targetSport = LEAGUE_ODDS_MAP[match.leagueId];
                    let oddsMatch: any = null;

                    if (m.id && exactOddsMap.has(m.id)) oddsMatch = exactOddsMap.get(m.id);

                    if (!oddsMatch && targetSport) {
                        const exactKey = `${targetSport}|${normalize(homeDisplayName)}|${normalize(awayDisplayName)}`;
                        if (exactOddsMap.has(exactKey)) oddsMatch = exactOddsMap.get(exactKey);
                    }

                    if (!oddsMatch && targetSport && homeDisplayName && awayDisplayName) {
                        const localFeeds = sportBuckets.get(targetSport);
                        if (localFeeds && localFeeds.length > 0) {
                            let bestScore = 0;
                            const matchTimeMs = Date.parse(match.startTime);
                            const queryHomeTrigrams = getTrigrams(homeDisplayName);
                            const queryAwayTrigrams = getTrigrams(awayDisplayName);

                            for (let i = 0; i < localFeeds.length; i++) {
                                const o = localFeeds[i];
                                if (o.commence_time_ms && !Number.isNaN(matchTimeMs)) {
                                    if (Math.abs(matchTimeMs - o.commence_time_ms) > 64800000) continue;
                                }

                                const homeScore = calculateSimilarity(queryHomeTrigrams, o.home_trigrams, 0.5);
                                if (homeScore < 0.5) continue;
                                const awayScore = calculateSimilarity(queryAwayTrigrams, o.away_trigrams, 0.5);
                                if (awayScore < 0.5) continue;

                                const avgScore = (homeScore + awayScore) / 2;
                                if (avgScore > 0.65 && avgScore > bestScore) {
                                    bestScore = avgScore;
                                    oddsMatch = o;
                                }
                            }
                        }
                    }

                    if (oddsMatch) {
                        const pSpread = oddsMatch.best_spread?.home?.point;
                        const pTotal = oddsMatch.best_total?.over?.point;
                        const pHomeML = oddsMatch.best_h2h?.home?.price;

                        if (pSpread != null || pTotal != null || pHomeML != null) {
                            const hs = pSpread;
                            const as = oddsMatch.best_spread?.away?.point ?? invertSpread(hs);

                            resolvedOdds = {
                                hasOdds: true,
                                isLive: isInProgress,
                                provider: oddsMatch.best_spread?.home?.bookmaker || oddsMatch.best_total?.over?.bookmaker || oddsMatch.best_h2h?.home?.bookmaker || 'Consensus',
                                homeSpread: formatSpread(hs),
                                awaySpread: formatSpread(as),
                                overUnder: pTotal != null ? `${pTotal}` : null,
                                homeML: formatPrice(pHomeML),
                                awayML: formatPrice(oddsMatch.best_h2h?.away?.price),
                                drawML: formatPrice(oddsMatch.best_h2h?.draw?.price || oddsMatch.best_h2h?.tie?.price || oddsMatch.best_h2h?.x?.price),
                                moneylineHome: formatPrice(pHomeML),
                                moneylineAway: formatPrice(oddsMatch.best_h2h?.away?.price),
                                homeSpreadOdds: formatPrice(oddsMatch.best_spread?.home?.price),
                                awaySpreadOdds: formatPrice(oddsMatch.best_spread?.away?.price),
                                overOdds: formatPrice(oddsMatch.best_total?.over?.price),
                                underOdds: formatPrice(oddsMatch.best_total?.under?.price),
                                lastUpdated: oddsMatch.last_updated,
                            };
                        } else {
                            if (!oddsMatch.parsedBookmakers) {
                                try {
                                    oddsMatch.parsedBookmakers = typeof oddsMatch.raw_bookmakers === 'string'
                                        ? JSON.parse(oddsMatch.raw_bookmakers) : (oddsMatch.raw_bookmakers || []);
                                } catch { oddsMatch.parsedBookmakers = []; }
                            }

                            const sortedBooks = [...(oddsMatch.parsedBookmakers || [])].sort((a: any, b: any) => {
                                const timeA = Date.parse(a.last_update || '') || 0;
                                const timeB = Date.parse(b.last_update || '') || 0;
                                return timeB - timeA;
                            });

                            const freshestBook = sortedBooks[0];

                            if (freshestBook) {
                                const getOutcome = (mktKey: string, targetName: string) => {
                                    if (!targetName) return null;
                                    const mkt = freshestBook.markets?.find((x: any) => x.key === mktKey);
                                    if (!mkt || !Array.isArray(mkt.outcomes)) return null;

                                    const targetTrigrams = getTrigrams(targetName);
                                    const targetNorm = normalize(targetName);

                                    return mkt.outcomes.find((x: any) =>
                                        normalize(x.name) === targetNorm ||
                                        calculateSimilarity(getTrigrams(x.name || ''), targetTrigrams, 0.65) > 0.65
                                    ) || null;
                                };

                                const hoSpread = getOutcome('spreads', oddsMatch.home_team);
                                const awSpread = getOutcome('spreads', oddsMatch.away_team);
                                const over = getOutcome('totals', 'Over');
                                const under = getOutcome('totals', 'Under');
                                const hoML = getOutcome('h2h', oddsMatch.home_team);
                                const awML = getOutcome('h2h', oddsMatch.away_team);
                                const drML = getOutcome('h2h', 'Draw') || getOutcome('h2h', 'Tie') || getOutcome('h2h', 'X');

                                const hsNum = hoSpread?.point;
                                const asNum = awSpread?.point ?? invertSpread(hsNum);

                                resolvedOdds = {
                                    hasOdds: true,
                                    isLive: isInProgress,
                                    provider: freshestBook.title || 'Unknown',
                                    homeSpread: formatSpread(hsNum),
                                    awaySpread: formatSpread(asNum),
                                    overUnder: over?.point != null && !Number.isNaN(Number(over.point)) ? `${over.point}` : null,
                                    homeML: formatPrice(hoML?.price),
                                    awayML: formatPrice(awML?.price),
                                    drawML: formatPrice(drML?.price),
                                    moneylineHome: formatPrice(hoML?.price),
                                    moneylineAway: formatPrice(awML?.price),
                                    homeSpreadOdds: formatPrice(hoSpread?.price),
                                    awaySpreadOdds: formatPrice(awSpread?.price),
                                    overOdds: formatPrice(over?.price),
                                    underOdds: formatPrice(under?.price),
                                    lastUpdated: oddsMatch.last_updated || freshestBook.last_update || null,
                                };
                            }
                        }
                    }
                }
            }

            match.odds = resolvedOdds || { hasOdds: false, isLive: false };
            return match;
        });

        const shapedMatches = matches
            .sort((a: any, b: any) => Date.parse(a.startTime || '') - Date.parse(b.startTime || ''))
            .slice(0, pageSize);
        timings.push({ name: 'shape', dur: Date.now() - shapeStart, desc: 'response shaping' });

        // ── 5. Trigger Stale Odds Refresh ──────────────────────────────────────

        const STALE_THRESHOLD_MS = 60_000;
        const sportsToRefresh = new Set<string>();
        const nowMs = Date.now();

        const activeSports = new Set(dbMatches.map(m => LEAGUE_ODDS_MAP[m.leagueId || m.league_id]).filter(Boolean));

        for (const key of oddsKeys) {
            const feeds = sportBuckets.get(key) || [];

            if (feeds.length > 0) {
                const oldest = feeds.reduce((min, o) => {
                    const t = Date.parse(o.last_updated);
                    return Number.isNaN(t) ? min : Math.min(min, t);
                }, nowMs);

                if (oldest < nowMs - STALE_THRESHOLD_MS) {
                    sportsToRefresh.add(key);
                }
            } else if (activeSports.has(key)) {
                sportsToRefresh.add(key);
            }
        }

        if (sportsToRefresh.size > 0) {
            supabase.functions.invoke('ingest-odds-v3', {
                body: { sport_keys: Array.from(sportsToRefresh) },
                headers: { 'x-trace-id': requestId, 'x-request-id': requestId }
            }).catch((e: any) => console.error(JSON.stringify({ level: 'warn', requestId, message: 'odds_refresh_trigger_failed', error: String(e) })));
        }

        // ── 6. Return ──────────────────────────────────────────────────────────
        const elapsed = Date.now() - tStart;
        const hasLiveGames = shapedMatches.some((m: any) => isLiveStatus(String(m.status || '')));
        const cacheControl = hasLiveGames
            ? 'public, max-age=3, stale-while-revalidate=7'
            : 'public, max-age=20, stale-while-revalidate=60';
        const etag = weakEtag(`${date}|${leagueIds.join(',')}|${shapedMatches.length}|${hasLiveGames ? 'live' : 'stale'}`);

        if (req.headers.get('if-none-match') === etag) {
            return new Response(null, {
                status: 304,
                headers: {
                    ...corsHeaders,
                    'Cache-Control': cacheControl,
                    ETag: etag,
                    'X-Request-Id': requestId,
                    'X-Elapsed-Ms': String(elapsed),
                },
            });
        }

        console.log(JSON.stringify({
            level: 'info',
            requestId,
            fn: 'fetch-matches',
            date,
            leagues: leagueIds,
            count: shapedMatches.length,
            hasLiveGames,
            elapsedMs: elapsed,
        }));

        return jsonResponse(shapedMatches, {
            cors: corsHeaders,
            requestId,
            cacheControl,
            timings: [...timings, { name: 'total', dur: elapsed, desc: 'request total' }],
            extraHeaders: {
                ETag: etag,
                'X-Matches-Count': String(shapedMatches.length),
                'X-Source': 'db',
                'X-Elapsed-Ms': String(elapsed),
            },
        });

    } catch (err: any) {
        const elapsed = Date.now() - tStart;
        const message = err?.message || 'Internal Server Error';
        console.error(JSON.stringify({ level: 'error', requestId, fn: 'fetch-matches', message, elapsedMs: elapsed }));
        return jsonResponse(
            { error: message, matches: [] },
            {
                status: 500,
                cors: corsHeaders,
                requestId,
                cacheControl: 'no-store',
                timings: [...timings, { name: 'total', dur: elapsed, desc: 'request total' }],
                extraHeaders: { 'X-Elapsed-Ms': String(elapsed) },
            }
        );
    }
});
