import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

declare const Deno: any;

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOOKAHEAD_HOURS = 36;
const CONCURRENCY = 5;
const CACHE_MAX_AGE = 12 * 60 * 60 * 1000;

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
        const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
        const supabase = createClient(supabaseUrl, supabaseKey);

        console.log("[Nightly Alpha Sync] Syncing upcoming anchors...");

        const now = new Date();
        const lookahead = new Date(now.getTime() + LOOKAHEAD_HOURS * 60 * 60 * 1000);

        const { data: matches, error: matchError } = await supabase
            .from("matches")
            .select("*")
            .gte("start_time", now.toISOString())
            .lt("start_time", lookahead.toISOString())
            .order("start_time", { ascending: true });

        if (matchError) throw matchError;
        if (!matches || matches.length === 0) return new Response(JSON.stringify({ message: "No upcoming matches." }), { headers: corsHeaders });

        const { data: existingNews } = await supabase
            .from("match_news")
            .select("match_id, generated_at, status")
            .in("match_id", matches.map((m: any) => m.id));

        const newsMap = new Map(existingNews?.map((n: any) => [n.match_id, n]));

        const gaps = matches.filter((match: any) => {
            const news = newsMap.get(match.id);
            if (!news || (news as any).status !== 'ready') return true;
            const lastGen = (news as any)?.generated_at;
            const reportAge = now.getTime() - new Date(lastGen).getTime();
            return reportAge > CACHE_MAX_AGE;
        });

        console.log(`[Nightly Alpha Sync] Identified ${gaps.length} gaps for synthesis.`);

        const results = [];
        for (let i = 0; i < gaps.length; i += CONCURRENCY) {
            const batch = gaps.slice(i, i + CONCURRENCY);
            const batchPromises = batch.map(async (match: any) => {
                try {
                    const { error } = await supabase.functions.invoke('analyze-match', {
                        body: {
                            match_id: match.id,
                            sport: match.league_id,
                            snapshot: {
                                away_team: match.away_team,
                                home_team: match.home_team,
                                market_total: match.odds_total_safe || 0
                            }
                        }
                    });
                    return { id: match.id, status: error ? "error" : "success" };
                } catch (err: any) {
                    return { id: match.id, status: "exception", error: err.message };
                }
            });
            results.push(...(await Promise.all(batchPromises)));
        }

        return new Response(JSON.stringify({ success: true, results }), { headers: corsHeaders });
    } catch (error: any) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
    }
});
