/* ============================================================================
   /api/live/scores/[slug]
   HMAC-signed public proxy — serves live score data from Supabase live_game_state.
   Designed for Gemini URL Context: publicly accessible, minimal payload, GET only.

   Route: /api/live/scores/{hmac_slug}?g={gameId}
   The slug is validated server-side against the gameId + "scores" endpoint.
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

    // Validate slug format
    if (!slug || typeof slug !== "string" || !SLUG_RE.test(slug)) {
        return res.status(400).json({ error: "Invalid slug" });
    }

    // Validate game_id format
    if (!gameId || typeof gameId !== "string" || !GAME_ID_RE.test(gameId)) {
        return res.status(400).json({ error: "Invalid game_id" });
    }

    // Validate nonce format
    if (!nonce || typeof nonce !== "string" || !NONCE_RE.test(nonce)) {
        return res.status(400).json({ error: "Invalid nonce" });
    }

    // HMAC validation
    if (!validateSatelliteSlug(slug, gameId, "scores", nonce)) {
        return res.status(403).json({ error: "Forbidden" });
    }

    try {
        const { data, error } = await supabase
            .from("live_game_state")
            .select("id, game_status, period, display_clock, home_team, away_team, home_score, away_score, updated_at")
            .eq("id", gameId)
            .maybeSingle();

        if (error) throw error;
        if (!data) return res.status(404).json({ error: "Game not found" });

        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "public, max-age=15, stale-while-revalidate=30");
        return res.status(200).json({
            game_id: data.id,
            status: data.game_status,
            clock: data.display_clock,
            period: data.period,
            home: { team: data.home_team, score: data.home_score },
            away: { team: data.away_team, score: data.away_score },
            updated_at: data.updated_at
        });
    } catch (e) {
        console.error("[Live Scores]", e.message);
        return res.status(500).json({ error: "Internal error" });
    }
}
