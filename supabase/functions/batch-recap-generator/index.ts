// Fix: Add Deno global declaration for TypeScript compatibility
declare const Deno: any;

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Configuration
const LOOKBACK_HOURS = 48; // Extended to 48 hours to catch more games
const BATCH_SIZE = 5; // Sequential processing to manage AI quota

// All possible final status variants
const FINAL_STATUSES = [
    'STATUS_FINAL',
    'STATUS_FULL_TIME'
];

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
        const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
        const supabase = createClient(supabaseUrl, supabaseKey);

        console.log("[Batch Recap] Scanning for finalized games...");
        console.log(`[Batch Recap] Looking back ${LOOKBACK_HOURS} hours...`);

        // 1. Fetch recently finalized matches (last 48h)
        const now = new Date();
        const lookback = new Date(now.getTime() - LOOKBACK_HOURS * 60 * 60 * 1000);

        // Query for ALL final status variants
        const { data: finalizedMatches, error: matchError } = await supabase
            .from("matches")
            .select("id, home_team, away_team, status, league_id, last_updated, home_score, away_score, current_odds")
            .in("status", FINAL_STATUSES)
            .gte("last_updated", lookback.toISOString())
            .order("last_updated", { ascending: false });

        if (matchError) {
            console.error("[Batch Recap] Match query error:", matchError);
            throw matchError;
        }

        console.log(`[Batch Recap] Query returned ${finalizedMatches?.length || 0} finalized matches`);

        if (!finalizedMatches || finalizedMatches.length === 0) {
            return new Response(JSON.stringify({
                success: true,
                message: "No recently finalized matches found.",
                lookback_hours: LOOKBACK_HOURS,
                checked_statuses: FINAL_STATUSES
            }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        // 2. Cross-reference with match_news to find games missing recaps
        // Filter out games that already have a 'ready' recap
        const matchIds = finalizedMatches.map((m: any) => m.id);
        const { data: existingRecaps } = await supabase
            .from("match_news")
            .select("match_id, status, sharp_data")
            .in("match_id", matchIds);

        const processedIds = new Set(
            existingRecaps
                ?.filter((r: any) => r.status === 'ready' && r.sharp_data !== null)
                .map((r: any) => r.match_id) || []
        );
        const pendingMatches = finalizedMatches.filter((m: any) => !processedIds.has(m.id)).slice(0, BATCH_SIZE);

        console.log(`[Batch Recap] Found ${finalizedMatches.length} final games. ${pendingMatches.length} pending processing.`);

        const results = [];

        // 3. Sequential invocation of analyze-match in RECAP mode
        for (const match of pendingMatches) {
            try {
                console.log(`[Batch Recap] Triggering recap for ${match.away_team} @ ${match.home_team} (${match.id})...`);

                const { data, error } = await supabase.functions.invoke('analyze-match', {
                    body: {
                        match: {
                            id: match.id,
                            home_team: match.home_team,
                            away_team: match.away_team,
                            sport: match.league_id || (match as any).sport_type || 'generic',
                            home_score: match.home_score,
                            away_score: match.away_score,
                            odds: match.current_odds
                        },
                        mode: 'RECAP'
                    }
                });

                if (error) {
                    console.error(`[Batch Recap] Failure for ${match.id}:`, error);
                    results.push({ id: match.id, status: "error", error });
                } else {
                    console.log(`[Batch Recap] Success for ${match.id}`);
                    results.push({ id: match.id, status: "success" });
                }

                // Add minor delay to respect rate limits if needed
                await new Promise(r => setTimeout(r, 1000));

            } catch (err: any) {
                console.error(`[Batch Recap] Exception for ${match.id}:`, err);
                results.push({ id: match.id, status: "exception", error: err.message });
            }
        }

        return new Response(JSON.stringify({
            success: true,
            total_found: finalizedMatches.length,
            batch_processed: pendingMatches.length,
            results
        }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
        });

    } catch (error: any) {
        console.error("[Batch Recap] Critical Failure:", error);
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 500
        });
    }
});
