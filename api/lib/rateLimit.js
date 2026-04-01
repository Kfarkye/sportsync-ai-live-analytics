/**
 * Sliding-window rate limiter with automatic eviction.
 * Shared across all /api/live/* proxy endpoints.
 *
 * - Evicts stale entries every EVICT_INTERVAL to prevent unbounded Map growth.
 * - Returns true if the request is within limits, false if rate-limited.
 */
const hits = new Map();
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 60;
const EVICT_INTERVAL_MS = 5 * 60_000; // Purge stale entries every 5 minutes

let lastEviction = Date.now();

function evictStale() {
    const now = Date.now();
    if (now - lastEviction < EVICT_INTERVAL_MS) return;
    lastEviction = now;
    for (const [ip, record] of hits) {
        if (now - record.start > RATE_WINDOW_MS) hits.delete(ip);
    }
}

/**
 * Extract the real client IP. Prefer x-real-ip (set by Vercel from the actual
 * connection) over x-forwarded-for (which clients can spoof by prepending entries).
 * @param {import('http').IncomingMessage} req
 * @returns {string}
 */
function getClientIp(req) {
    // Vercel sets x-real-ip from the actual TCP connection — not spoofable
    const realIp = req.headers?.["x-real-ip"];
    if (realIp) return realIp.trim();
    // Fallback: take the *last* entry in x-forwarded-for (closest to the edge)
    const xff = req.headers?.["x-forwarded-for"];
    if (xff) {
        const parts = xff.split(",").map(s => s.trim()).filter(Boolean);
        return parts[parts.length - 1] || "unknown";
    }
    return req.socket?.remoteAddress || "unknown";
}

/**
 * @param {import('http').IncomingMessage} req
 * @returns {boolean} true if allowed, false if rate-limited
 */
export function checkRateLimit(req) {
    evictStale();
    const ip = getClientIp(req);
    const now = Date.now();
    const record = hits.get(ip);
    if (!record || now - record.start > RATE_WINDOW_MS) {
        hits.set(ip, { start: now, count: 1 });
        return true;
    }
    record.count++;
    return record.count <= RATE_LIMIT;
}
