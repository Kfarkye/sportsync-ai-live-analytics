
import { createClient } from '@supabase/supabase-js';

// Hardcoded URL from existing scripts (seed_master_schedule.ts)
const DEFAULT_URL = 'https://qffzvrnbzabcokqqrwbv.supabase.co';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || DEFAULT_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_KEY) {
    console.error("\n❌ MISSING CREDENTIALS");
    console.error("---------------------------------------------------");
    console.error("Please create a .env file with your SUPABASE_SERVICE_ROLE_KEY");
    console.error("OR run this script with the key inline:");
    console.error("\nSUPABASE_SERVICE_ROLE_KEY=your_key_here npx tsx scripts/verify_tennis_fix.ts");
    console.error("---------------------------------------------------\n");
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function verify() {
    console.log("🎾 Verifying Tennis Fix in vw_titan_master...");
    console.log(`Connecting to: ${SUPABASE_URL}`);

    // 1. Get RAW Counts (Truth)
    const { data: picks, error } = await supabase
        .from('pregame_intel')
        .select('intel_id, grading_metadata, analyzed_spread')
        .in('league_id', ['atp', 'wta', 'tennis'])
        .in('pick_result', ['WIN', 'LOSS', 'PUSH']);

    if (error) {
        console.error("❌ Base Query Failed:", error.message);
        return;
    }

    // 2. Get VIEW Counts (What users see)
    const { data: viewData, error: viewError } = await supabase
        .from('vw_titan_master')
        .select('intel_id, pick_side, category, spread, is_underdog, pick_result')
        .in('league_id', ['atp', 'wta', 'tennis'])
        .in('pick_result', ['WIN', 'LOSS', 'PUSH']);

    if (viewError) {
        console.error("❌ View Query Failed:", viewError.message);
        return;
    }

    const totalRaw = picks.length;
    const totalView = viewData.length;
    const missingInView = totalRaw - totalView;

    // 3. Analyze Quality
    const uncategorized = viewData.filter(p => p.category === 'UNCATEGORIZED').length;
    const categorized = totalView - uncategorized;

    console.log(`\n📊 TENNIS DATA QUALITY REPORT`);
    console.log(`==============================`);
    console.log(`Raw Graded Picks:     ${totalRaw}  (Truth)`);
    console.log(`Visible in Dashboard: ${totalView}  (Master View)`);
    console.log(`------------------------------`);
    console.log(`✅ Fully Categorized: ${categorized}`);
    console.log(`❌ Uncategorized:     ${uncategorized}`);
    console.log(`⚠️ Missing from View: ${missingInView}`);

    if (missingInView === 0 && uncategorized === 0 && totalRaw > 0) {
        console.log(`\n✅ SUCCESS! Logic is fixed. Tennis is analyzing correctly.`);
    } else {
        console.log(`\n❌ FAIL. Logic Gap Detected.`);
        console.log(`   - We are missing ${missingInView} picks completely.`);
        console.log(`   - We have ${uncategorized} picks visible but invalid.`);
        console.log(`\n👉 ACTION: Please apply 'supabase/migrations/20260128000004_fix_tennis_analytics.sql'`);
    }
}

verify();
