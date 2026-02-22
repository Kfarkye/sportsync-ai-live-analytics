/* ============================================================================
   /api/live/odds/[slug]
   HMAC-signed public proxy — serves live odds data from Supabase live_game_state.
   Designed for Gemini URL Context: publicly accessible, minimal payload, GET only.

   Route: /api/live/odds/{hmac_slug}?g={gameId}
   The slug is validated server-side against the gameId + "odds" endpoint.
============================================================================ */
import { createClient } from "@supabase/supabase-js";
import { checkRateLimit } from "../../lib/rateLimit.js";
import { validateSatelliteSlug } from "../../lib/satellite.js";

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const GAME_ID_RE = /^[\w-]{4,128}$/;
const SLUG_RE = /^[0-9a-f]{64}$/;
const NONCE_RE = /^[0-9a-f]{32}$/;

export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({ error: "Method not allowed" });
    }
    if (!checkRateLimit(req)) {
        return res.status(429).json({ error: "Rate limit exceeded" });
    }

    const { slug, g: gameId, n: nonce } = req.query;

    if (!slug || typeof slug !== "string" || !SLUG_RE.test(slug)) {
        return res.status(400).json({ error: "Invalid slug" });
    }
    if (!gameId || typeof gameId !== "string" || !GAME_ID_RE.test(gameId)) {
        return res.status(400).json({ error: "Invalid game_id" });
    }
    if (!nonce || typeof nonce !== "string" || !NONCE_RE.test(nonce)) {
        return res.status(400).json({ error: "Invalid nonce" });
    }
    if (!validateSatelliteSlug(slug, gameId, "odds", nonce)) {
        return res.status(403).json({ error: "Forbidden" });
    }

    try {
        const { data, error } = await supabase
            .from("live_game_state")
            .select("id, odds, t60_snapshot, t0_snapshot, updated_at")
            .eq("id", gameId)
            .maybeSingle();

        if (error) throw error;
        if (!data) return res.status(404).json({ error: "Game not found" });

        const current = data.odds || {};
        const opening = data.t60_snapshot?.odds || data.t0_snapshot?.odds || {};

        // Build movement timeline from snapshots
        const movement = [];
        if (data.t0_snapshot?.odds?.spread !== undefined) {
            movement.push({ label: "open", spread: data.t0_snapshot.odds.spread, total: data.t0_snapshot.odds.total });
        }
        if (data.t60_snapshot?.odds?.spread !== undefined) {
            movement.push({ label: "t-60", spread: data.t60_snapshot.odds.spread, total: data.t60_snapshot.odds.total });
        }
        if (current.spread !== undefined) {
            movement.push({ label: "current", spread: current.spread, total: current.total });
        }

        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
        return res.status(200).json({
            game_id: data.id,
            consensus: {
                spread: current.spread,
                total: current.total,
                moneyline_home: current.moneyline_home ?? current.moneylineHome,
                moneyline_away: current.moneyline_away ?? current.moneylineAway
            },
            opening: {
                spread: opening.spread,
                total: opening.total
            },
            movement,
            updated_at: data.updated_at
        });
    } catch (e) {
        console.error("[Live Odds]", e.message);
        return res.status(500).json({ error: "Internal error" });
    }
}
