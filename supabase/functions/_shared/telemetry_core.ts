
// supabase/functions/_shared/telemetry_core.ts

import { createClient, SupabaseClient } from '@supabase/supabase-js'

// Types
export interface OddsTick {
    game_id: string;
    sport: string;
    market: string;
    side: string;
    book: string;
    line: number;
    price: number;
    ts: string; // ISO String
}

export interface ConsensusEvent {
    game_id: string;
    market: string;
    side: string;
    consensus_line: number;
    active_books: number;
    ts: string;
}

export const CONSENSUS_RULESET = 'v2.0-median';
export const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 Minutes

/**
 * Core Telemetry Engine
 * - Ingests Ticks (Idempotent)
 * - Updates Live State
 * - Calculus Consensus (Median)
 * - Emits Events
 */
export class TelemetryEngine {
    private supabase: SupabaseClient;

    constructor(supabaseUrl: string, supabaseKey: string) {
        this.supabase = createClient(supabaseUrl, supabaseKey);
    }

    /**
     * Ingest a single tick.
     * Transactional-like logic (though Supabase REST is stateless, we order ops carefully).
     */
    async ingestTick(tick: OddsTick) {
        // 1. Append to Raw Log (Idempotent via Unique Constraint)
        const { error: logErr } = await this.supabase
            .from('raw_odds_log')
            .insert({
                game_id: tick.game_id,
                sport: tick.sport,
                market: tick.market,
                side: tick.side,
                book: tick.book,
                line: tick.line,
                price: tick.price,
                ts: tick.ts
            })
            .select()
            .single();

        // 409 Conflict is GOOD (Idempotency), ignore it.
        if (logErr && logErr.code !== '23505') {
            console.error('[Telemetry] Log Error:', logErr);
            throw logErr;
        }

        // 2. Update Live State (Mutable)
        const { error: stateErr } = await this.supabase
            .from('live_market_state')
            .upsert({
                game_id: tick.game_id,
                market: tick.market,
                side: tick.side,
                book: tick.book,
                line: tick.line,
                price: tick.price,
                last_update_ts: tick.ts
            });

        if (stateErr) throw stateErr;

        // 3. Calculate Consensus
        await this.calculateConsensus(tick.game_id, tick.market, tick.side, tick.ts);
    }

    /**
     * Ingest a batch of ticks (Optimized for high throughput).
     */
    async ingestBatch(ticks: OddsTick[]) {
        if (!ticks || ticks.length === 0) return;

        // 1. Batch Insert Raw Log (Ignore duplicates)
        const { error: logErr } = await this.supabase
            .from('raw_odds_log')
            .insert(ticks.map(t => ({
                game_id: t.game_id,
                sport: t.sport,
                market: t.market,
                side: t.side,
                book: t.book,
                line: t.line,
                price: t.price,
                ts: t.ts
            })))
            .select(); // Need to see what was inserted? (optional)

        // Ignore 409 conflict on batch (Postgres drivers usually handle unique violations per row or abort transaction)
        // With Supabase REST, it might fail the whole batch if one conflicts unless we use ignore duplicates?
        // Actually, Supabase .insert() has default implicit "abort on conflict".
        // To ignore duplicates, we'd need onConflict: '... ignore'.
        // But for raw logs, we want to proceed.
        if (logErr) {
            // If we can't do exact "ignore" easily in batch without upsert, let's use Upsert with ignore-like behavior?
            // Or better: Use upsert because it's idempotent.
            // But raw_odds_log is append only log.
            // Actually, "insert ignore" is tricky in standard Supabase JS without RPC.
            // Let's use Upsert with onConflict on the unique key, doing nothing on update.
            // Essentially: Insert or Update (where update is no-op or same values).
            const { error: upsertLogErr } = await this.supabase
                .from('raw_odds_log')
                .upsert(ticks.map(t => ({
                    game_id: t.game_id,
                    sport: t.sport,
                    market: t.market,
                    side: t.side,
                    book: t.book,
                    line: t.line,
                    price: t.price,
                    ts: t.ts
                })), { onConflict: 'game_id,market,side,book,ts', ignoreDuplicates: true });

            if (upsertLogErr) console.error('[Telemetry] Batch Log Error:', upsertLogErr);
        }

        // 2. Batch Update Live State
        // Group by unique keys? .upsert() handles batches fine.
        const { error: stateErr } = await this.supabase
            .from('live_market_state')
            .upsert(ticks.map(t => ({
                game_id: t.game_id,
                market: t.market,
                side: t.side,
                book: t.book,
                line: t.line,
                price: t.price,
                last_update_ts: t.ts
            })));

        if (stateErr) console.error('[Telemetry] Batch State Error:', stateErr);

        // 3. Batched Consensus Calc
        // Identify unique (game, market, side) tuples that were touched
        const uniqueKeys = new Set<string>();
        const latestTsMap = new Map<string, string>(); // Key -> Latest TS

        for (const t of ticks) {
            const key = `${t.game_id}|${t.market}|${t.side}`;
            uniqueKeys.add(key);

            const existingTs = latestTsMap.get(key);
            if (!existingTs || new Date(t.ts) > new Date(existingTs)) {
                latestTsMap.set(key, t.ts);
            }
        }

        // Process consensus for each affected slice
        // Run in parallel with limit
        await Promise.all(Array.from(uniqueKeys).map(async (key) => {
            const [gameId, market, side] = key.split('|');
            const ts = latestTsMap.get(key)!;
            await this.calculateConsensus(gameId, market, side, ts);
        }));
    }

    /**
     * Compute Consensus for a specific market slice.
     * Uses Median Logic.
     */
    private async calculateConsensus(gameId: string, market: string, side: string, eventTs: string) {
        // A. Fetch all active books for this slice
        const { data: books, error: fetchErr } = await this.supabase
            .from('live_market_state')
            .select('*')
            .eq('game_id', gameId)
            .eq('market', market)
            .eq('side', side);

        if (fetchErr || !books || books.length === 0) return;

        // B. Filter Stale
        const now = new Date(eventTs).getTime();
        const active = books.filter(b => {
            // If book hasn't updated in 5 mins relative to this event, it's stale
            // Note: eventTs is the timestamp of the incoming tick. 
            // We compare book.last_update_ts to eventTs or just specific stale check?
            // Since this is real-time, eventTs ~ Now.
            const lastUpdate = new Date(b.last_update_ts).getTime();
            return (now - lastUpdate) <= STALE_THRESHOLD_MS;
        });

        if (active.length === 0) return;

        // C. Calc Median
        // Sort by Line first, then Price
        active.sort((a, b) => {
            if (a.line !== b.line) return a.line - b.line;
            return a.price - b.price;
        });

        const mid = Math.floor(active.length / 2);
        const medianLine = active.length % 2 !== 0
            ? active[mid].line
            : (active[mid - 1].line + active[mid].line) / 2;

        // D. Check Last Consensus (to detect change)
        const { data: lastEvent } = await this.supabase
            .from('derived_consensus_log')
            .select('consensus_line')
            .eq('game_id', gameId)
            .eq('market', market)
            .eq('side', side)
            .order('ts', { ascending: false })
            .limit(1)
            .single();

        // E. Emit Event if Changed
        if (!lastEvent || lastEvent.consensus_line !== medianLine) {
            // console.log(`[Consensus Flip] ${gameId} ${market} ${side}: ${lastEvent?.consensus_line} -> ${medianLine}`);

            await this.supabase
                .from('derived_consensus_log')
                .insert({
                    game_id: gameId,
                    market: market,
                    side: side,
                    consensus_line: medianLine,
                    active_books: active.length,
                    ruleset_version: CONSENSUS_RULESET,
                    ts: eventTs
                });
        }
    }
}
