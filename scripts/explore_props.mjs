import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function explore() {
    console.log("═══ PLAYER PROPS EXPLORATION ═══\n");

    // 1. Get column names from a sample row
    console.log("--- Sample Row (all columns) ---");
    const { data: sample, error } = await supabase.from('player_prop_bets').select('*').limit(1);
    if (error) { console.error("Error:", error.message); return; }
    if (sample?.[0]) {
        const cols = Object.keys(sample[0]);
        console.log(`  Columns (${cols.length}):`, cols.join(', '));
        console.log("\n  Full sample row:");
        Object.entries(sample[0]).forEach(([k, v]) => {
            const val = typeof v === 'object' ? JSON.stringify(v) : String(v);
            console.log(`    ${k}: ${val?.substring(0, 120)}`);
        });
    }

    // 2. Breakdown by market type
    console.log("\n--- Props by Market Type ---");
    const { data: allProps } = await supabase.from('player_prop_bets').select('market, sport');
    if (allProps) {
        const markets = {};
        const sports = {};
        allProps.forEach(r => {
            markets[r.market || 'UNKNOWN'] = (markets[r.market || 'UNKNOWN'] || 0) + 1;
            sports[r.sport || 'UNKNOWN'] = (sports[r.sport || 'UNKNOWN'] || 0) + 1;
        });
        console.log("\n  By Market:");
        Object.entries(markets).sort(([, a], [, b]) => b - a).forEach(([k, v]) => console.log(`    ${k}: ${v.toLocaleString()}`));
        console.log("\n  By Sport:");
        Object.entries(sports).sort(([, a], [, b]) => b - a).forEach(([k, v]) => console.log(`    ${k}: ${v.toLocaleString()}`));
    }

    // 3. Date range
    console.log("\n--- Date Range ---");
    const { data: earliest } = await supabase.from('player_prop_bets').select('created_at').order('created_at', { ascending: true }).limit(1).maybeSingle();
    const { data: latest } = await supabase.from('player_prop_bets').select('created_at').order('created_at', { ascending: false }).limit(1).maybeSingle();
    console.log(`  Earliest: ${earliest?.created_at || 'N/A'}`);
    console.log(`  Latest:   ${latest?.created_at || 'N/A'}`);

    // 4. Sample of 5 diverse rows
    console.log("\n--- 5 Diverse Sample Rows ---");
    const { data: diverse } = await supabase.from('player_prop_bets').select('*').limit(5);
    diverse?.forEach((r, i) => {
        console.log(`\n  [${i + 1}] ${r.player_name || r.playerName || 'Unknown'} | ${r.market || 'N/A'} | ${r.sport || 'N/A'}`);
        console.log(`      Line: ${r.line ?? r.prop_line ?? 'N/A'} | Over: ${r.over_price ?? r.overPrice ?? 'N/A'} | Under: ${r.under_price ?? r.underPrice ?? 'N/A'}`);
        console.log(`      Match: ${r.match_id || 'N/A'} | Team: ${r.team || r.team_name || 'N/A'}`);
    });

    console.log("\n✅ Props exploration complete.");
}

explore().catch(console.error);
