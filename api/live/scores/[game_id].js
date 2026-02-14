/* ============================================================================
   /api/live/scores/[game_id]
   Public proxy — serves live score data from Supabase live_game_state.
   Designed for Gemini URL Context: publicly accessible, minimal payload, GET only.

   HMAC: When SATELLITE_SECRET is set, [game_id] is an HMAC slug and the actual
   game ID comes from ?g= query param. Falls back to [game_id]-as-gameId when unset.
============================================================================ */
import { createClient } from "@supabase/supabase-js";
import { checkRateLimit } from "../../lib/rateLimit.js";
import { validateSatelliteSlug } from "../../lib/hmac.js";

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const GAME_ID_RE = /^[\w-]{4,128}$/;

export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({ error: "Method not allowed" });
    }
    if (!checkRateLimit(req)) {
        return res.status(429).json({ error: "Rate limit exceeded" });
    }

    const slug = req.query.game_id;
    if (!slug || typeof slug !== "string") {
        return res.status(400).json({ error: "Invalid request" });
    }

    // Resolve game ID: HMAC mode (?g=gameId) or passthrough (slug IS gameId)
    const gameId = (typeof req.query.g === "string" && req.query.g) || slug;
    if (!GAME_ID_RE.test(gameId)) {
        return res.status(400).json({ error: "Invalid game_id" });
    }

    // HMAC validation (no-op when SATELLITE_SECRET is unset)
    if (!validateSatelliteSlug(slug, gameId, "scores")) {
        return res.status(403).json({ error: "Invalid or expired slug" });
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
