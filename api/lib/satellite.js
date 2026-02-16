/* ============================================================================
   api/lib/satellite.js
   HMAC-signed slug generation & validation for satellite proxy endpoints.

   Satellite URLs use sha256(gameId + endpoint + timeBucket + secret) as the slug.
   Non-guessable. Validated server-side on every request. Expires with TTL.
   Prevents enumeration by non-Google crawlers.
============================================================================ */
import { createHmac } from "crypto";

const SATELLITE_SECRET = process.env.SATELLITE_SECRET || "";

/**
 * Generate an HMAC-signed slug for a satellite endpoint.
 * @param {string} gameId - The game identifier
 * @param {string} endpoint - The endpoint type: "scores" | "odds" | "pbp"
 * @returns {string} 32-character hex slug (128-bit entropy)
 */
export function generateSatelliteSlug(gameId, endpoint) {
    const ttlBucket = Math.floor(Date.now() / 60_000); // 1-min buckets
    const payload = `${gameId}:${endpoint}:${ttlBucket}`;
    return createHmac("sha256", SATELLITE_SECRET)
        .update(payload)
        .digest("hex")
        .slice(0, 32);
}

/**
 * Validate an HMAC-signed slug against the expected game/endpoint pair.
 * Checks current bucket and previous bucket to handle boundary crossings.
 * @param {string} slug - The slug to validate
 * @param {string} gameId - The game identifier
 * @param {string} endpoint - The endpoint type: "scores" | "odds" | "pbp"
 * @returns {boolean} true if valid
 */
export function validateSatelliteSlug(slug, gameId, endpoint) {
    if (!slug || !gameId || !endpoint || !SATELLITE_SECRET) return false;
    const now = Math.floor(Date.now() / 60_000);
    // Check current bucket and previous (handles boundary crossings)
    for (const bucket of [now, now - 1]) {
        const payload = `${gameId}:${endpoint}:${bucket}`;
        const expected = createHmac("sha256", SATELLITE_SECRET)
            .update(payload)
            .digest("hex")
            .slice(0, 32);
        if (slug === expected) return true;
    }
    return false;
}
