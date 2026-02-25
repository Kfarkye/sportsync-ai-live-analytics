/* ============================================================================
   api/lib/satellite.js
   HMAC-signed slug generation & validation for satellite proxy endpoints.

   Satellite URLs use HMAC-SHA512(gameId + endpoint + timeBucket + nonce + secret)
   as the slug. Non-guessable. Validated server-side on every request.
   Expires with TTL. Prevents enumeration by non-Google crawlers.

   Auth properties:
     - Algorithm:  HMAC-SHA512 (upgrade from SHA-256)
     - Entropy:    256-bit slug (64 hex chars, truncated from 512-bit digest)
     - Replay:     Per-request nonce + 1-minute time-bucket TTL
     - Comparison:  Constant-time (crypto.timingSafeEqual)
============================================================================ */
import { createHmac, randomBytes, timingSafeEqual } from "crypto";

const SATELLITE_SECRET = process.env.SATELLITE_SECRET;
if (!SATELLITE_SECRET) {
    console.warn("WARNING: SATELLITE_SECRET is missing. URLs generated will be invalid.");
}

/**
 * Generate an HMAC-signed slug + nonce for a satellite endpoint.
 * @param {string} gameId   - The game identifier
 * @param {string} endpoint - The endpoint type: "scores" | "odds" | "pbp"
 * @returns {{ slug: string, nonce: string }} 64-char hex slug + 32-char hex nonce
 */
export function generateSatelliteSlug(gameId, endpoint) {
    const nonce = randomBytes(16).toString("hex"); // 32 hex chars
    const ttlBucket = Math.floor(Date.now() / 60_000); // 1-min buckets
    const payload = `${gameId}:${endpoint}:${ttlBucket}:${nonce}`;
    const slug = createHmac("sha512", SATELLITE_SECRET)
        .update(payload)
        .digest("hex")
        .slice(0, 64); // 256-bit effective entropy
    return { slug, nonce };
}

/**
 * Validate an HMAC-signed slug against the expected game/endpoint/nonce tuple.
 * Checks current bucket and previous bucket to handle boundary crossings.
 * Uses constant-time comparison to prevent timing side-channels.
 * @param {string} slug     - The slug to validate (64 hex chars)
 * @param {string} gameId   - The game identifier
 * @param {string} endpoint - The endpoint type: "scores" | "odds" | "pbp"
 * @param {string} nonce    - The per-request nonce (32 hex chars)
 * @returns {boolean} true if valid
 */
export function validateSatelliteSlug(slug, gameId, endpoint, nonce) {
    if (!slug || !gameId || !endpoint || !nonce || !SATELLITE_SECRET) return false;
    const now = Math.floor(Date.now() / 60_000);
    // Check current bucket and previous (handles boundary crossings)
    for (const bucket of [now, now - 1]) {
        const payload = `${gameId}:${endpoint}:${bucket}:${nonce}`;
        const expected = createHmac("sha512", SATELLITE_SECRET)
            .update(payload)
            .digest("hex")
            .slice(0, 64);
        // Constant-time comparison — prevent timing side-channel
        if (slug.length === expected.length) {
            const a = Buffer.from(slug, "hex");
            const b = Buffer.from(expected, "hex");
            if (a.length === b.length && timingSafeEqual(a, b)) return true;
        }
    }
    return false;
}
