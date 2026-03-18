
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing Supabase credentials.');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function verifyJuiceColumns() {
    console.log('🚀 Verifying Juice Columns in pregame_intel...\n');

    // Fetch the most recent pregame_intel entries
    const { data: intel, error } = await supabase
        .from('pregame_intel')
        .select('match_id, home_team, away_team, recommended_pick, spread_juice, total_juice, home_ml, away_ml, analyzed_spread, generated_at')
        .order('generated_at', { ascending: false })
        .limit(5);

    if (error) {
        console.error('❌ Error:', error.message);
        return;
    }

    if (!intel || intel.length === 0) {
        console.log('⚠️ No pregame_intel entries found.');
        return;
    }

    console.log(`📊 Found ${intel.length} recent entries:\n`);

    let hasJuice = false;
    for (const entry of intel) {
        console.log(`📌 ${entry.away_team} @ ${entry.home_team}`);
        console.log(`   Pick: ${entry.recommended_pick || 'N/A'}`);
        console.log(`   Spread: ${entry.analyzed_spread || 'N/A'}`);
        console.log(`   spread_juice: ${entry.spread_juice || '❌ NULL'}`);
        console.log(`   total_juice: ${entry.total_juice || '❌ NULL'}`);
        console.log(`   home_ml: ${entry.home_ml || '❌ NULL'}`);
        console.log(`   away_ml: ${entry.away_ml || '❌ NULL'}`);
        console.log(`   Generated: ${entry.generated_at}`);
        console.log('');

        if (entry.spread_juice) hasJuice = true;
    }

    if (hasJuice) {
        console.log('✅ SUCCESS: Juice columns are being populated!');
    } else {
        console.log('⚠️ Note: No juice data found yet. This is expected for entries generated BEFORE the fix.');
        console.log('   Trigger a fresh worker run with force=true for new data.');
    }

    console.log('\n--- END VERIFICATION ---');
}

verifyJuiceColumns().catch(console.error);
