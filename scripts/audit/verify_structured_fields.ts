
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing Supabase credentials.');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function verifyStructuredFields() {
    console.log('🚀 Verifying Structured Intel Fields...\n');

    // Fetch the most recent pregame_intel entries
    const { data: intel, error } = await supabase
        .from('pregame_intel')
        .select('match_id, home_team, away_team, headline, recommended_pick, cards, briefing, spread_juice, generated_at')
        .order('generated_at', { ascending: false })
        .limit(3);

    if (error) {
        console.error('❌ Error:', error.message);
        return;
    }

    if (!intel || intel.length === 0) {
        console.log('⚠️ No pregame_intel entries found.');
        return;
    }

    console.log(`📊 Found ${intel.length} recent entries:\n`);

    for (const entry of intel) {
        console.log(`📌 ${entry.away_team} @ ${entry.home_team}`);
        console.log(`   Match ID: ${entry.match_id}`);
        console.log(`   headline: ${entry.headline || '❌ NULL'}`);
        console.log(`   recommended_pick: ${entry.recommended_pick || '❌ NULL'}`);
        console.log(`   cards: ${entry.cards ? (Array.isArray(entry.cards) ? entry.cards.length + ' cards' : entry.cards.substring(0, 50)) : '❌ NULL'}`);
        console.log(`   briefing: ${entry.briefing ? entry.briefing.substring(0, 50) + '...' : '❌ NULL'}`);
        console.log(`   spread_juice: ${entry.spread_juice || '❌ NULL'}`);
        console.log(`   Generated: ${entry.generated_at}`);
        console.log('');
    }

    console.log('--- END VERIFICATION ---');
}

verifyStructuredFields().catch(console.error);
