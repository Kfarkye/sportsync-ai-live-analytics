import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function investigate() {
    console.log("═══ GRADING BUG INVESTIGATION v2 ═══\n");

    // 1. Get actual column names
    console.log("--- Pregame Intel Schema (from sample row) ---");
    const { data: schema } = await supabase.from('pregame_intel').select('*').limit(1);
    if (schema?.[0]) {
        const cols = Object.keys(schema[0]);
        console.log(`  Columns (${cols.length}):`, cols.join(', '));
        console.log("\n  Full sample:");
        Object.entries(schema[0]).forEach(([k, v]) => {
            const val = typeof v === 'object' ? JSON.stringify(v)?.substring(0, 150) : String(v)?.substring(0, 150);
            console.log(`    ${k}: ${val}`);
        });
    }

    // 2. Sample LOSS picks
    console.log("\n--- 3 LOSS picks (all columns) ---");
    const { data: losses } = await supabase.from('pregame_intel').select('*').eq('pick_result', 'LOSS').limit(3);
    losses?.forEach((r, i) => {
        console.log(`\n  [LOSS ${i + 1}]`);
        Object.entries(r).forEach(([k, v]) => {
            if (v !== null && v !== '' && v !== undefined) {
                const val = typeof v === 'object' ? JSON.stringify(v)?.substring(0, 200) : String(v)?.substring(0, 200);
                console.log(`    ${k}: ${val}`);
            }
        });
    });

    // 3. Cross-check with match scores
    console.log("\n--- Cross-checking LOSS picks against match results ---");
    const { data: picks } = await supabase.from('pregame_intel').select('*').eq('pick_result', 'LOSS').limit(10);
    if (picks?.length) {
        const matchIds = [...new Set(picks.map(p => p.match_id).filter(Boolean))];
        if (matchIds.length) {
            const { data: matches } = await supabase.from('matches').select('id, home_score, away_score, status').in('id', matchIds);
            const matchMap = {};
            matches?.forEach(m => { matchMap[m.id] = m; });

            picks.forEach(p => {
                const m = matchMap[p.match_id];
                if (m) {
                    console.log(`\n  Pick: match=${p.match_id} | type=${p.pick_type} | result=${p.pick_result}`);
                    console.log(`    Match score: ${m.home_score}-${m.away_score} (${m.status})`);
                    // Print all pick-related fields
                    Object.entries(p).forEach(([k, v]) => {
                        if (k.includes('pick') || k.includes('line') || k.includes('side') || k.includes('spread') || k.includes('total') || k.includes('over') || k.includes('under')) {
                            if (v !== null && v !== undefined) console.log(`    ${k}: ${v}`);
                        }
                    });
                }
            });
        }
    }

    // 4. PENDING picks sample  
    console.log("\n--- 2 PENDING picks (to compare shape) ---");
    const { data: pending } = await supabase.from('pregame_intel').select('*').eq('pick_result', 'PENDING').limit(2);
    pending?.forEach((r, i) => {
        console.log(`\n  [PENDING ${i + 1}]`);
        Object.entries(r).forEach(([k, v]) => {
            if (v !== null && v !== '' && v !== undefined) {
                const val = typeof v === 'object' ? JSON.stringify(v)?.substring(0, 200) : String(v)?.substring(0, 200);
                console.log(`    ${k}: ${val}`);
            }
        });
    });

    console.log("\n✅ Done.");
}

investigate().catch(console.error);
