/* ============================================================================
   tool-result-cache.ts
   Hybrid Tool-Calling Architecture — Request-Scoped Tool Result Cache

   Implements: Spec Section 4.4

   CRITICAL DESIGN DECISIONS:
   - Request-scoped: instantiated per request, NOT module-level.
     Each request gets its own cache. No cross-request contamination.
   - stableStringify() for canonical cache keys (sorted object keys).
   - Per-tool TTLs (live odds expire faster than tempo data).
   - MAX_ENTRIES = 256 with oldest-entry eviction.
   - NO getLatestByTool() method. Any code that would call it is a bug.
     Always use get() with explicit args for match-scoped retrieval.
============================================================================ */

import type { ToolResult } from "./tool-handlers.js";

/** Per-tool TTLs in milliseconds. Tools with more volatile data expire faster. */
const TTL_MS: Record<string, number> = {
    get_schedule: 60_000,        // 1 minute — schedule rarely changes
    get_team_injuries: 120_000,  // 2 minutes — injuries can update
    get_team_tempo: 300_000,     // 5 minutes — season-level metrics
    get_live_odds: 30_000,       // 30 seconds — odds move fast
    get_live_game_state: 15_000, // 15 seconds — live scores
    search_knowledge_base: 300_000, // 5 minutes — static content
};

/** Maximum cache entries before oldest-entry eviction. */
const MAX_ENTRIES = 256;

/**
 * Request-scoped cache for tool results.
 * 
 * Instantiate ONE per request. Never at module scope.
 * Uses stable key serialization so `{a:1,b:2}` and `{b:2,a:1}` produce the same key.
 * 
 * @example
 * ```typescript
 * const toolCache = new ToolResultCache(); // At request start
 * const odds = toolCache.get("get_live_odds", { match_id: "abc-123" });
 * ```
 */
export class ToolResultCache {
    private cache = new Map<string, { result: ToolResult; timestamp: number }>();

    /**
     * Build a canonical cache key from tool name and args.
     * Uses stableStringify to ensure key determinism regardless of property order.
     */
    private getCacheKey(tool: string, args: Record<string, unknown>): string {
        return `${tool}:${stableStringify(args)}`;
    }

    /**
     * Retrieve a cached tool result.
     * Returns null if not found or expired (per-tool TTL).
     * 
     * IMPORTANT: Always pass explicit args. Never "get latest."
     * Match-scoped retrieval only. If you need odds for a specific match,
     * pass { match_id: "..." } — do not omit args.
     * 
     * @param tool - Tool name (e.g., "get_live_odds")
     * @param args - Exact args the tool was called with
     * @returns Cached ToolResult or null
     */
    get(tool: string, args: Record<string, unknown>): ToolResult | null {
        const key = this.getCacheKey(tool, args);
        const entry = this.cache.get(key);
        if (!entry) return null;

        const ttl = TTL_MS[tool] || 60_000;
        if (Date.now() - entry.timestamp > ttl) {
            this.cache.delete(key);
            return null;
        }

        return entry.result;
    }

    /**
     * Store a tool result in the cache.
     * Evicts the oldest entry if MAX_ENTRIES is reached.
     * 
     * @param tool - Tool name
     * @param args - Exact args the tool was called with
     * @param result - The tool execution result
     */
    set(tool: string, args: Record<string, unknown>, result: ToolResult): void {
        if (this.cache.size >= MAX_ENTRIES) {
            // Evict oldest entry (Map preserves insertion order)
            const oldest = this.cache.keys().next().value;
            if (oldest !== undefined) this.cache.delete(oldest);
        }
        this.cache.set(this.getCacheKey(tool, args), {
            result,
            timestamp: Date.now(),
        });
    }

    /** Clear all cached entries. */
    clear(): void {
        this.cache.clear();
    }

    /** Get current cache size (for telemetry). */
    get size(): number {
        return this.cache.size;
    }
}

// ── Stable Stringify ─────────────────────────────────────────────────────

/**
 * Deterministic JSON serialization with sorted object keys.
 * Ensures `{a:1, b:2}` and `{b:2, a:1}` produce identical strings.
 * Used for cache key generation.
 */
export function stableStringify(obj: unknown): string {
    if (obj === null || obj === undefined) return JSON.stringify(obj);
    if (typeof obj !== "object") return JSON.stringify(obj);
    if (Array.isArray(obj)) {
        return "[" + obj.map(stableStringify).join(",") + "]";
    }
    const record = obj as Record<string, unknown>;
    const sorted = Object.keys(record).sort();
    return (
        "{" +
        sorted
            .map((k) => JSON.stringify(k) + ":" + stableStringify(record[k]))
            .join(",") +
        "}"
    );
}
