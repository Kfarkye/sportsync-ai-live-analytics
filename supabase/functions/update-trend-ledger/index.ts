import { createClient } from "npm:@supabase/supabase-js@2";
import { assertLedgerInvariant, calculateUnitProfit } from "../shared/ledger.ts";

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json",
};

/**
 * Recalculates push-safe ROI and validates accounting invariants for all active trends.
 * Writes an atomic snapshot into the `trend_ledger`.
 */
async function processTrendLedger() {
    const supabase = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
        { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: trends, error: trendsErr } = await supabase
        .from("trend_definitions")
        .select("*")
        .eq("is_active", true);

    if (trendsErr) throw new Error(`Fetch trends error: ${trendsErr.message}`);
    if (!trends || trends.length === 0) return { status: 'no_trends_found' };

    const results = [];

    for (const trend of trends) {
        let sqlQuery = '';
        let rpcFunction = '';

        // Route logic based on trend key
        if (trend.trend_key === 'epl_draw_value') {
            rpcFunction = 'calc_epl_draw_ledger';
        } else if (trend.trend_key === 'serie_a_away_fav_ats') {
            rpcFunction = 'calc_serie_a_away_fav_ledger';
        } else if (trend.trend_key === 'epl_high_total_under') {
            rpcFunction = 'calc_epl_high_total_ledger';
        } else {
            console.warn(`[Skip] Unmapped trend key: ${trend.trend_key}`);
            continue;
        }

        // Call Supabase RPC to evaluate historical games for this trend
        const { data: rawData, error: rpcErr } = await supabase.rpc(rpcFunction);
        if (rpcErr) {
            console.error(`[RPC Error] ${trend.trend_key}:`, rpcErr);
            continue;
        }

        // In local execution where RPC might not exist yet, we mock data or fetch direct
        // For this rewrite, we will calculate directly via JS if RPC fails to ensure it works
        const summary = await calculateTrendSnapshot(supabase, trend);

        if (summary) {
            try {
                // Run strict accounting checks
                assertLedgerInvariant(summary);

                // Write snapshot
                const { error: insertErr } = await supabase.from('trend_ledger').insert({
                    trend_key: trend.trend_key,
                    games_sample: summary.gamesSample,
                    wins: summary.wins,
                    losses: summary.losses,
                    pushes: summary.pushes,
                    draws: summary.draws,
                    units_risked: summary.unitsRisked,
                    units_profit: summary.unitsProfit,
                    roi: summary.roi,
                    hit_rate: (summary.wins / summary.gamesSample) * 100,
                    accounting_ok: true,
                    invariant_note: 'passed',
                    source_window: {
                        latest_settlement_ts: new Date().toISOString()
                    }
                });

                if (insertErr) throw insertErr;
                results.push({ trend_key: trend.trend_key, status: 'success', summary });
            } catch (e: any) {
                console.error(`[Ledger Invariant] ${trend.trend_key} Failed:`, e.message);
                results.push({ trend_key: trend.trend_key, status: 'invariant_error', message: e.message });

                await supabase.from('trend_ledger').insert({
                    trend_key: trend.trend_key,
                    games_sample: summary.gamesSample,
                    wins: summary.wins,
                    losses: summary.losses,
                    pushes: summary.pushes,
                    draws: summary.draws,
                    units_risked: summary.unitsRisked,
                    units_profit: summary.unitsProfit,
                    roi: summary.roi,
                    hit_rate: summary.gamesSample > 0 ? (summary.wins / summary.gamesSample) * 100 : 0,
                    accounting_ok: false,
                    invariant_note: e.message,
                    source_window: {
                        latest_settlement_ts: new Date().toISOString()
                    }
                });
            }
        }
    }

    return { status: 'COMPLETE', results };
}

/**
 * JS fallback calculator for trend stats without custom RPCs
 */
async function calculateTrendSnapshot(supabase: any, trend: any) {
    const { data: games, error } = await supabase.from('soccer_postgame').select('*');
    if (error || !games) return null;

    let summary = {
        wins: 0, losses: 0, pushes: 0, draws: 0,
        gamesSample: 0, unitsRisked: 0, unitsProfit: 0, roi: 0
    };

    if (trend.trend_key === 'epl_draw_value') {
        const validGames = games.filter((g: any) => g.league_id === 'epl' && g.dk_draw_ml !== null);
        summary.gamesSample = validGames.length;
        for (const g of validGames) {
            if (g.home_score === g.away_score) {
                summary.wins++;
                summary.unitsProfit += calculateUnitProfit(g.dk_draw_ml);
            } else {
                summary.losses++;
                summary.unitsProfit -= 1;
            }
        }
    } else if (trend.trend_key === 'serie_a_away_fav_ats') {
        const validGames = games.filter((g: any) => g.league_id === 'seriea' && g.dk_spread > 0 && g.dk_away_spread_price !== null);
        summary.gamesSample = validGames.length;
        for (const g of validGames) {
            const ats_margin = (g.home_score - g.away_score) + g.dk_spread;
            if (ats_margin < 0) {
                summary.wins++;
                summary.unitsProfit += calculateUnitProfit(g.dk_away_spread_price);
            } else if (ats_margin > 0) {
                summary.losses++;
                summary.unitsProfit -= 1;
            } else {
                summary.pushes++;
            }
        }
    } else if (trend.trend_key === 'epl_high_total_under') {
        const threshold = trend.config?.total_threshold || 2.5;
        const validGames = games.filter((g: any) => g.league_id === 'epl' && g.dk_total > threshold && g.dk_under_price !== null);
        summary.gamesSample = validGames.length;
        for (const g of validGames) {
            const totalGoals = g.home_score + g.away_score;
            if (totalGoals < g.dk_total) {
                summary.wins++;
                summary.unitsProfit += calculateUnitProfit(g.dk_under_price);
            } else if (totalGoals > g.dk_total) {
                summary.losses++;
                summary.unitsProfit -= 1;
            } else {
                summary.pushes++;
            }
        }
    }

    if (summary.gamesSample === 0) return summary;

    // Calculate standard stats
    summary.unitsRisked = summary.gamesSample - summary.pushes; // 1 unit risk per non-push

    if (summary.unitsRisked > 0) {
        // Math.round trick for 6 digits
        summary.roi = Math.round((summary.unitsProfit / summary.unitsRisked) * 100 * 100000) / 100000;
    }

    return summary;
}

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

    try {
        const authHeader = req.headers.get('Authorization');
        if (authHeader !== `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS_HEADERS });
        }

        const result = await processTrendLedger();
        return new Response(JSON.stringify(result), { headers: CORS_HEADERS });
    } catch (error: any) {
        console.error("[update-trend-ledger] Fatal:", error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: CORS_HEADERS });
    }
});
