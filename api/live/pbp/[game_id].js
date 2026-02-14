/* ============================================================================
   /api/live/pbp/[game_id]
   Public proxy — serves play-by-play + stat leaders from Supabase live_game_state.
   Designed for Gemini URL Context: publicly accessible, minimal payload, GET only.
============================================================================ */
import { createClient } from "@supabase/supabase-js";
import { checkRateLimit } from "../../lib/rateLimit.js";

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

    const { game_id } = req.query;
    if (!game_id || typeof game_id !== "string" || !GAME_ID_RE.test(game_id)) {
        return res.status(400).json({ error: "Invalid game_id" });
    }

    try {
        const { data, error } = await supabase
            .from("live_game_state")
            .select("id, home_team, away_team, home_score, away_score, leaders, play_by_play, updated_at")
            .eq("id", game_id)
            .maybeSingle();

        if (error) throw error;
        if (!data) return res.status(404).json({ error: "Game not found" });

        const leaders = data.leaders || {};
        const recentPlays = Array.isArray(data.play_by_play)
            ? data.play_by_play.slice(-10)
            : [];

        res.setHeader("Cache-Control", "public, max-age=15, stale-while-revalidate=30");
        return res.status(200).json({
            game_id: data.id,
            leaders,
            recent_plays: recentPlays,
            score: { home: data.home_score, away: data.away_score },
            updated_at: data.updated_at
        });
    } catch (e) {
        console.error("[Live PBP]", e.message);
        return res.status(500).json({ error: "Internal error" });
    }
}
