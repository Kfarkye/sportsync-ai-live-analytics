/* ============================================================================
   /api/live/scores/[game_id]
   Public proxy — serves live score data from Supabase live_game_state.
   Designed for Gemini URL Context: publicly accessible, minimal payload, GET only.
============================================================================ */
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Simple in-memory rate limiter: 60 req/min per IP
const hits = new Map();
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 60;

function rateLimit(ip) {
    const now = Date.now();
    const record = hits.get(ip);
    if (!record || now - record.start > RATE_WINDOW_MS) {
        hits.set(ip, { start: now, count: 1 });
        return true;
    }
    record.count++;
    return record.count <= RATE_LIMIT;
}

export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || "unknown";
    if (!rateLimit(ip)) {
        return res.status(429).json({ error: "Rate limit exceeded" });
    }

    const { game_id } = req.query;
    if (!game_id || typeof game_id !== "string") {
        return res.status(400).json({ error: "Missing game_id" });
    }

    try {
        const { data, error } = await supabase
            .from("live_game_state")
            .select("id, game_status, period, display_clock, home_team, away_team, home_score, away_score, updated_at")
            .eq("id", game_id)
            .maybeSingle();

        if (error) throw error;
        if (!data) return res.status(404).json({ error: "Game not found" });

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
