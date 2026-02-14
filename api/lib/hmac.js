/**
 * HMAC-signed satellite URL generation & validation.
 * Used by /api/live/* proxy endpoints and api/chat.js.
 *
 * Slug = sha256(gameId:endpoint:ttlBucket).slice(0, 16)
 * TTL bucket = 1 minute. Validates current + previous bucket for boundary crossings.
 *
 * When SATELLITE_SECRET is unset, falls back to passthrough (game ID as slug).
 */
import { createHmac } from "crypto";

const SECRET = process.env.SATELLITE_SECRET;

/**
 * Generate a time-limited HMAC slug for a satellite URL.
 * @param {string} gameId
 * @param {string} endpoint - "scores" | "odds" | "pbp"
 * @returns {string} 16-char hex slug
 */
export function generateSatelliteSlug(gameId, endpoint) {
    if (!SECRET) return gameId; // passthrough when unconfigured
    const ttlBucket = Math.floor(Date.now() / 60_000);
    const payload = `${gameId}:${endpoint}:${ttlBucket}`;
    return createHmac("sha256", SECRET)
        .update(payload)
        .digest("hex")
        .slice(0, 16);
}

/**
 * Validate an HMAC slug against a game ID + endpoint.
 * Checks current and previous TTL bucket (handles boundary crossings).
 * @param {string} slug - The slug from the URL path
 * @param {string} gameId - The game ID from ?g= query param
 * @param {string} endpoint - "scores" | "odds" | "pbp"
 * @returns {boolean}
 */
export function validateSatelliteSlug(slug, gameId, endpoint) {
    if (!SECRET) return true; // passthrough when unconfigured
    const now = Math.floor(Date.now() / 60_000);
    for (const bucket of [now, now - 1]) {
        const payload = `${gameId}:${endpoint}:${bucket}`;
        const expected = createHmac("sha256", SECRET)
            .update(payload)
            .digest("hex")
            .slice(0, 16);
        if (slug === expected) return true;
    }
    return false;
}
