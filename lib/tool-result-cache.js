const TTL_MS = {
  get_schedule: 6e4,
  // 1 minute — schedule rarely changes
  get_team_injuries: 12e4,
  // 2 minutes — injuries can update
  get_team_tempo: 3e5,
  // 5 minutes — season-level metrics
  get_live_odds: 3e4,
  // 30 seconds — odds move fast
  get_live_game_state: 15e3,
  // 15 seconds — live scores
  search_knowledge_base: 3e5
  // 5 minutes — static content
};
const MAX_ENTRIES = 256;
class ToolResultCache {
  constructor() {
    this.cache = /* @__PURE__ */ new Map();
  }
  /**
   * Build a canonical cache key from tool name and args.
   * Uses stableStringify to ensure key determinism regardless of property order.
   */
  getCacheKey(tool, args) {
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
  get(tool, args) {
    const key = this.getCacheKey(tool, args);
    const entry = this.cache.get(key);
    if (!entry) return null;
    const ttl = TTL_MS[tool] || 6e4;
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
  set(tool, args, result) {
    if (this.cache.size >= MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== void 0) this.cache.delete(oldest);
    }
    this.cache.set(this.getCacheKey(tool, args), {
      result,
      timestamp: Date.now()
    });
  }
  /** Clear all cached entries. */
  clear() {
    this.cache.clear();
  }
  /** Get current cache size (for telemetry). */
  get size() {
    return this.cache.size;
  }
}
function stableStringify(obj) {
  if (obj === null || obj === void 0) return JSON.stringify(obj);
  if (typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return "[" + obj.map(stableStringify).join(",") + "]";
  }
  const record = obj;
  const sorted = Object.keys(record).sort();
  return "{" + sorted.map((k) => JSON.stringify(k) + ":" + stableStringify(record[k])).join(",") + "}";
}
export {
  ToolResultCache,
  stableStringify
};
