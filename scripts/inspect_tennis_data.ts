
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("❌ Missing Supabase Creds.");
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function inspect() {
    console.log("🔍 Inspecting Tennis Picks Data Structure...");

    // Fetch up to 5 raw tennis picks that are graded
    const { data: picks, error } = await supabase
        .from('pregame_intel')
        .select('intel_id, grading_metadata, analyzed_spread, pick_result')
        .in('league_id', ['atp', 'wta', 'tennis'])
        .in('pick_result', ['WIN', 'LOSS', 'PUSH'])
        .limit(5);

    if (error) {
        console.error("❌ DB Error:", error);
        return;
    }

    if (!picks || picks.length === 0) {
        console.log("No tennis picks found.");
        return;
    }

    console.log("\n📋 SAMPLE TENNIS PICK DATA:");
    picks.forEach((p, i) => {
        console.log(`\n--- Pick ${i + 1} ---`);
        console.log(`ID: ${p.intel_id}`);
        console.log(`Analyzed Spread: ${p.analyzed_spread} (Type: ${typeof p.analyzed_spread})`);
        console.log(`Grading Metadata:`, JSON.stringify(p.grading_metadata, null, 2));
    });
}

inspect();
