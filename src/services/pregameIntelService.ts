// ===================================================================
// Pregame Intel Service (Google SRE Hardened v7.0)
// Features: Strict Timezones, Idle-Time Persistence, AbortController
// ===================================================================

import { supabase } from '../lib/supabase';
import { getDbMatchId } from '../utils/matchUtils';
import { getCanonicalMatchId, generateCanonicalGameId } from '../utils/matchRegistry';

// ===================================================================
// Domain Types (Strict)
// ===================================================================

export interface IntelSource {
    title: string;
    url: string;
    domain: string;
}

export interface IntelCard {
    id: string;
    category:
    | 'CONTRARIAN' | 'PLAYER_TREND'
    | 'INJURY' | 'ATS_TRENDS' | 'SCHEDULE' | 'LINE_MOVEMENT' | 'SHARP_ACTION'
    | 'WEATHER' | 'REFEREE' | 'SITUATIONAL' | 'STORYLINE'
    | 'LINEUP' | 'TREND' | 'HEAD_TO_HEAD' | 'MARKET';
    icon: string;
    thesis: string;
    market_implication: string;
    impact: 'HIGH' | 'MEDIUM' | 'LOW' | 'NEUTRAL';
    confidence_score?: number;
    source_verified?: boolean;
    source?: {
        title: string;
        url: string;
        domain: string;
    };
    title?: string;
    summary?: string;
    details?: string[];
}

export interface PregameIntelResponse {
    match_id: string;
    generated_at: string;
    headline: string;
    briefing?: string;
    recommended_pick?: string;
    cards: IntelCard[];
    sources: IntelSource[];
    logic_authority?: string;
    freshness: 'LIVE' | 'RECENT' | 'STALE';
    confidence_score?: number;
    is_edge_of_day?: boolean;
    analyzed_spread?: number;
    analyzed_total?: number;
    grading_metadata?: {
        side: 'HOME' | 'AWAY' | 'OVER' | 'UNDER';
        type: 'SPREAD' | 'TOTAL' | 'MONEYLINE';
        selection: string;
    };
}

// ===================================================================
// ⚙️ SRE Configuration
// ===================================================================

const CACHE_CONFIG = {
    TTL_FRESH_BASE: 15 * 60 * 1000,
    TTL_STALE: 24 * 60 * 60 * 1000, // Extended to 24h for offline resilience
    MAX_ITEMS: 50,                  // Reduced to 50 to respect LocalStorage quotas (5MB)
    FETCH_TIMEOUT: 25000,           // Tightened to 25s (Fail fast is better than hanging)
    STORAGE_KEY: 'SHARPEDGE_INTEL_V2'
};

type Subscriber = (data: PregameIntelResponse) => void;

type CacheEntry = {
    data: PregameIntelResponse;
    timestamp: number;
    freshUntil: number;
    staleUntil: number;
};

// ===================================================================
// 🛡️ Optimized Cache Manager (Non-Blocking + Observable)
// ===================================================================

class IntelCacheManager {
    private cache = new Map<string, CacheEntry>();
    private inflight = new Map<string, Promise<PregameIntelResponse | null>>();
    private subscribers = new Map<string, Set<Subscriber>>();
    private hydrationPromise: Promise<void>;

    constructor() {
        // SRE Fix: Hydrate asynchronously to prevent blocking Main Thread on boot
        this.hydrationPromise = this.hydrateAsync();
    }

    private async hydrateAsync() {
        if (typeof window === 'undefined') return;
        await new Promise(r => setTimeout(r, 0)); // Yield to event loop

        try {
            const raw = localStorage.getItem(CACHE_CONFIG.STORAGE_KEY);
            if (raw) {
                const data = JSON.parse(raw) as Record<string, CacheEntry>;
                const now = Date.now();
                Object.entries(data).forEach(([key, entry]) => {
                    // LRU/TTL Pruning on load
                    if (entry && typeof entry.staleUntil === 'number' && entry.staleUntil > now) {
                        this.cache.set(key, entry);
                    }
                });
            }
        } catch (e) {
            console.warn('[IntelCache] Corrupt storage wiped');
            localStorage.removeItem(CACHE_CONFIG.STORAGE_KEY);
        }
    }

    /**
     * SRE Fix: Use requestIdleCallback to write to disk without UI Jank
     */
    private persist() {
        if (typeof window === 'undefined') return;

        const saveTask = () => {
            try {
                // Slice to Max Items (LRU is implicit by Map insertion order)
                const entries = Array.from(this.cache.entries()).slice(-CACHE_CONFIG.MAX_ITEMS);
                localStorage.setItem(CACHE_CONFIG.STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
            } catch (e) {
                console.warn('[IntelCache] Storage Quota Exceeded');
            }
        };

        if ('requestIdleCallback' in window) {
            (window as any).requestIdleCallback(saveTask, { timeout: 2000 });
        } else {
            setTimeout(saveTask, 1000); // Fallback
        }
    }

    /**
     * SRE Fix: The Missing Link for SWR
     * Allows components to subscribe to background updates.
     */
    subscribe(key: string, callback: Subscriber) {
        if (!this.subscribers.has(key)) this.subscribers.set(key, new Set());
        this.subscribers.get(key)!.add(callback);

        return () => { // Cleanup function
            const set = this.subscribers.get(key);
            if (set) {
                set.delete(callback);
                if (set.size === 0) this.subscribers.delete(key);
            }
        };
    }

    private notify(key: string, data: PregameIntelResponse) {
        const subs = this.subscribers.get(key);
        if (subs) subs.forEach(cb => cb(data));
    }

    set(key: string, data: PregameIntelResponse | null) {
        if (!data) return; // Don't cache hard errors indefinitely

        const now = Date.now();
        this.cache.delete(key); // Re-insert to update LRU position
        this.cache.set(key, {
            data,
            timestamp: now,
            freshUntil: now + CACHE_CONFIG.TTL_FRESH_BASE,
            staleUntil: now + CACHE_CONFIG.TTL_STALE
        });

        this.persist(); // ⚡ Async Save
        this.notify(key, data); // ⚡ Update UI
    }

    get(key: string) { return this.cache.get(key); }

    async resolve(
        key: string,
        fetcher: (signal: AbortSignal) => Promise<PregameIntelResponse | null>,
        signal?: AbortSignal
    ): Promise<PregameIntelResponse | null> {
        await this.hydrationPromise; // Ensure cache is loaded before fetching

        const entry = this.get(key);
        const now = Date.now();

        // 1. CACHE HIT
        if (entry && now < entry.staleUntil) {
            // SWR Check
            if (now > entry.freshUntil) {
                console.log(`[IntelCache] 🍂 SWR Refreshing: ${key}`);
                // Background refresh (Fire & Forget)
                // The UI will be updated via 'notify()' when this finishes
                this.executeDeduplicated(key, fetcher, signal).catch(err =>
                    console.warn('[IntelCache] Background refresh failed', err)
                );
            }
            return structuredClone(entry.data);
        }

        // 2. CACHE MISS (Blocking)
        return this.executeDeduplicated(key, fetcher, signal);
    }

    private executeDeduplicated(
        key: string,
        fetcher: (signal: AbortSignal) => Promise<PregameIntelResponse | null>,
        signal?: AbortSignal
    ) {
        if (this.inflight.has(key)) return this.inflight.get(key)!;

        // Circuit Breaker: Enforce strict timeout
        const ctrl = new AbortController();
        const timeoutId = setTimeout(() => ctrl.abort(), CACHE_CONFIG.FETCH_TIMEOUT);

        // Merge user signal with timeout signal
        const finalSignal = signal || ctrl.signal;
        if (signal) signal.addEventListener('abort', () => ctrl.abort());

        const promise = fetcher(finalSignal)
            .then(data => {
                this.set(key, data);
                return data;
            })
            .finally(() => {
                clearTimeout(timeoutId);
                this.inflight.delete(key);
            });

        this.inflight.set(key, promise);
        return promise;
    }
}

const intelCache = new IntelCacheManager();

// ===================================================================
// Service Layer
// ===================================================================

/**
 * 🛡️ PRODUCTION DATE UTILITY (SRE APPROVED)
 * Uses IANA Timezones to safely calculate the "Betting Slate Date" (Pacific Time).
 * Automatically handles the 1-hour shift during Daylight Savings Time.
 */
function getBettingSlateDate(isoStringOrDate?: string | Date): string {
    const target = isoStringOrDate
        ? new Date(typeof isoStringOrDate === 'string' ? isoStringOrDate.replace(' ', 'T') : isoStringOrDate)
        : new Date();

    // Ask the browser: "What is the date in LA right now?"
    // This is the only robust way to handle DST cross-platform.
    const parts = new Intl.DateTimeFormat('en-CA', { // en-CA is YYYY-MM-DD
        timeZone: 'America/Los_Angeles',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: 'numeric', hour12: false
    }).formatToParts(target);

    // Reconstruct YYYY-MM-DD
    const find = (t: string) => parts.find(p => p.type === t)?.value;
    const dateStr = `${find('year')}-${find('month')}-${find('day')}`;
    const hour = parseInt(find('hour') || '0', 10);

    // 3 AM Rule: Games played 12AM-3AM Pacific belong to previous day's slate
    if (hour < 3) {
        const d = new Date(dateStr);
        d.setDate(d.getDate() - 1);
        return d.toISOString().split('T')[0];
    }

    return dateStr;
}

export const pregameIntelService = {
    /**
     * React Hook Helper: Subscribe to SWR updates
     */
    subscribe(matchId: string, league: string, cb: Subscriber) {
        const dbMatchId = getCanonicalMatchId(matchId, league);
        return intelCache.subscribe(`intel-${dbMatchId}`, cb);
    },

    async fetchIntel(
        matchId: string,
        homeTeam: string,
        awayTeam: string,
        sport: string,
        league: string,
        startTime?: string,
        currentSpread?: number,
        currentTotal?: number,
        signal?: AbortSignal // 🛡️ SRE: Pass signal for cancellation
    ): Promise<PregameIntelResponse | null> {

        const dbMatchId = getCanonicalMatchId(matchId, league);
        const trueNorthId = (startTime && homeTeam && awayTeam) ? generateCanonicalGameId(homeTeam, awayTeam, startTime, league) : '';
        const cacheKey = `intel-${dbMatchId}`;

        const fetcher = async (sig: AbortSignal) => {
            const gameDate = getBettingSlateDate(startTime); // ⚡ Correct Timezone logic

            // 1. DB LOOKUP (Read-Through)
            try {
                // Identity Resolution Bridge (Phase 3 Preservation)
                let resolvedTrueNorthId = trueNorthId;
                if (dbMatchId.includes('_') && !dbMatchId.startsWith('20')) {
                    const { data: mapping } = await (supabase
                        .from('entity_mappings')
                        .select('canonical_id')
                        .eq('external_id', dbMatchId)
                        .eq('provider', 'ESPN')
                        .maybeSingle() as any)
                        .abortSignal(sig);

                    if (mapping) {
                        resolvedTrueNorthId = mapping.canonical_id;
                    }
                }

                const { data: idMatch } = await (supabase
                    .from('pregame_intel')
                    .select('*')
                    .or(`match_id.eq.${dbMatchId},match_id.eq.${resolvedTrueNorthId}`)
                    .eq('game_date', gameDate)
                    .limit(1)
                    .maybeSingle() as any)
                    .abortSignal(sig);      // ⚡ Cancel DB query if user leaves

                if (idMatch) {
                    console.log('[PregameIntel] DB Cache Hit:', dbMatchId);
                    return mapDbResponse(idMatch, dbMatchId);
                }

                // 2. CLOUD GENERATION
                const { data, error } = await supabase.functions.invoke('pregame-intel', {
                    body: {
                        match_id: dbMatchId,
                        sport: (sport || 'football').toLowerCase(),
                        league: (league || '').toLowerCase(),
                        home_team: homeTeam,
                        away_team: awayTeam,
                        start_time: startTime,
                        current_spread: currentSpread,
                        current_total: currentTotal
                    },
                    headers: {},
                    method: 'POST',
                    // @ts-ignore
                    signal: sig
                });

                if (error) throw error;
                return { ...data, match_id: dbMatchId, freshness: 'LIVE' };
            } catch (e) {
                console.warn('Intel Fetch Failed', e);
                return null;
            }
        };

        return intelCache.resolve(cacheKey, fetcher, signal);
    },

    clearCache(matchId: string) {
        intelCache.set(`intel-${matchId}`, null);
    }
};

function mapDbResponse(row: Partial<PregameIntelResponse> & Record<string, unknown>, id: string): PregameIntelResponse {
    return {
        ...row,
        match_id: row.match_id || id,
        freshness: row.freshness || 'RECENT'
    } as PregameIntelResponse;
}
