/**
 * DEBUG VOLATILITY GUARD
 * Calculates the current 'Delta' for all upcoming games to see if they would trigger re-analysis.
 */

import { createClient } from "@supabase/supabase-js";

const PROJECT_URL = 'https://qffzvrnbzabcokqqrwbv.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NTM1NzY2OCwiZXhwIjoyMDcwOTMzNjY4fQ.jytFbYNCZVeMOM8dB7CDmfd5kEDkrIyc_eY9lKSrJjk';

const VOLATILITY_THRESHOLDS: Record<string, { spread: number, total: number }> = {
    'nba': { spread: 1.0, total: 2.0 },
    'nfl': { spread: 0.5, total: 1.0 },
    'mlb': { spread: 0.5, total: 0.5 },
    'default': { spread: 1.0, total: 1.5 }
};

async function auditVolatility() {
    console.log("🛰️ [Discovery] Fetching Upcoming Intel & Market Lines...");

    const supabase = createClient(PROJECT_URL, SERVICE_ROLE_KEY);

    // 1. Get recent pregame_intel
    const { data: intelRecords, error: intelErr } = await supabase
        .from('pregame_intel')
        .select('match_id, analyzed_spread, analyzed_total, generated_at')
        .order('generated_at', { ascending: false })
        .limit(10);

    if (intelErr) {
        console.error("❌ [Intel Error]:", intelErr.message);
        return;
    }

    if (!intelRecords?.length) {
        console.log("ℹ️ No intel records found.");
        return;
    }

    // 2. Hydrate matches data manually
    const matchIds = intelRecords.map(r => r.match_id);
    const { data: matches, error: matchErr } = await supabase
        .from('matches')
        .select('id, home_team, away_team, league_id, odds_home_spread_safe, odds_total_safe')
        .in('id', matchIds);

    if (matchErr) {
        console.error("❌ [Match Error]:", matchErr.message);
        return;
    }

    const matchMap = new Map(matches?.map(m => [m.id, m]));

    console.log("\n📊 [Volatility Audit] (Last 10 Records):");
    console.log("--------------------------------------------------------------------------------");

    intelRecords.forEach((rec: any) => {
        const match = matchMap.get(rec.match_id);
        if (!match) return;

        const league = (match.league_id || 'default').toLowerCase();
        const thresholds = VOLATILITY_THRESHOLDS[league] || VOLATILITY_THRESHOLDS['default'];

        const spreadDelta = Math.abs((match.odds_home_spread_safe || 0) - (rec.analyzed_spread || 0));
        const totalDelta = Math.abs((match.odds_total_safe || 0) - (rec.analyzed_total || 0));

        const triggerSpread = spreadDelta > thresholds.spread;
        const triggerTotal = totalDelta > thresholds.total;

        console.log(`${match.away_team} @ ${match.home_team} (${league.toUpperCase()})`);
        console.log(`  └─ SPREAD: Analyzed=${rec.analyzed_spread} | Current=${match.odds_home_spread_safe} | Δ=${spreadDelta.toFixed(1)} ${triggerSpread ? '🔴 [VOLATILE]' : '🟢 [STABLE]'}`);
        console.log(`  └─ TOTAL:  Analyzed=${rec.analyzed_total} | Current=${match.odds_total_safe} | Δ=${totalDelta.toFixed(1)} ${triggerTotal ? '🔴 [VOLATILE]' : '🟢 [STABLE]'}`);
        console.log("--------------------------------------------------------------------------------");
    });
}

auditVolatility();
