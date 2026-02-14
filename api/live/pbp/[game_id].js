/* ============================================================================
   /api/live/pbp/[game_id]
   Public proxy — serves play-by-play + stat leaders from ESPN API.
   Designed for Gemini URL Context: publicly accessible, minimal payload, GET only.
============================================================================ */
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

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

// In-memory cache: 15-second TTL
const pbpCache = new Map();
const PBP_CACHE_TTL_MS = 15_000;

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

    // Check cache
    const cached = pbpCache.get(game_id);
    if (cached && Date.now() - cached.ts < PBP_CACHE_TTL_MS) {
        res.setHeader("Cache-Control", "public, max-age=15, stale-while-revalidate=30");
        return res.status(200).json(cached.data);
    }

    try {
        // Fetch game state to get ESPN event ID and league
        const { data: game, error } = await supabase
            .from("live_game_state")
            .select("id, espn_id, league, home_team, away_team, home_score, away_score, leaders, play_by_play, updated_at")
            .eq("id", game_id)
            .maybeSingle();

        if (error) throw error;
        if (!game) return res.status(404).json({ error: "Game not found" });

        // Use stored leaders/PBP from live_game_state if available
        const leaders = game.leaders || {};
        const recentPlays = Array.isArray(game.play_by_play)
            ? game.play_by_play.slice(-10)
            : [];

        const result = {
            game_id: game.id,
            leaders,
            recent_plays: recentPlays,
            score: { home: game.home_score, away: game.away_score },
            updated_at: game.updated_at
        };

        pbpCache.set(game_id, { data: result, ts: Date.now() });

        res.setHeader("Cache-Control", "public, max-age=15, stale-while-revalidate=30");
        return res.status(200).json(result);
    } catch (e) {
        console.error("[Live PBP]", e.message);
        return res.status(500).json({ error: "Internal error" });
    }
}
