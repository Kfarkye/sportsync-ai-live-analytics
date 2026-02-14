/* ============================================================================
   /api/live/odds/[game_id]
   Public proxy — serves live odds data from Supabase live_game_state.
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
            .select("id, odds, t60_snapshot, t0_snapshot, updated_at")
            .eq("id", game_id)
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
