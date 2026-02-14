/* ============================================================================
   /api/live/odds/[game_id]
   Public proxy — serves live odds data from Supabase live_game_state.
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
