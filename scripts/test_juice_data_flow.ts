
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing Supabase credentials. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testJuiceDataFlow() {
    console.log('🚀 Testing Juice Data Flow...\n');

    // 1. Fetch a recent NHL game from matches with current_odds
    console.log('📡 Fetching NHL game with current_odds...');
    const { data: match, error: matchErr } = await supabase
        .from('matches')
        .select('id, home_team, away_team, current_odds, odds_home_spread_safe, odds_total_safe')
        .eq('league_id', 'nhl')
        .not('current_odds', 'is', null)
        .order('start_time', { ascending: true })
        .limit(1)
        .single();

    if (matchErr || !match) {
        console.error('❌ No NHL match found with current_odds:', matchErr?.message);
        return;
    }

    console.log(`✅ Found: ${match.away_team} @ ${match.home_team}`);
    console.log(`   Match ID: ${match.id}`);
    console.log(`   Spread (Safe): ${match.odds_home_spread_safe}`);
    console.log(`   Total (Safe): ${match.odds_total_safe}`);

    // 2. Check current_odds structure
    const odds = match.current_odds || {};
    console.log('\n📊 Inspecting current_odds structure:');
    console.log(`   Provider: ${odds.provider || 'N/A'}`);
    console.log(`   home_ml: ${odds.home_ml || 'N/A'}`);
    console.log(`   away_ml: ${odds.away_ml || 'N/A'}`);
    console.log(`   spread_home: ${odds.spread_home || 'N/A'}`);
    console.log(`   spread_best?.home?.price: ${odds.spread_best?.home?.price || 'N/A'}`);
    console.log(`   total_best?.over?.price: ${odds.total_best?.over?.price || 'N/A'}`);

    // 3. Fetch pregame_intel for this match
    console.log(`\n📜 Fetching pregame_intel for match ${match.id}...`);
    const { data: intel, error: intelErr } = await supabase
        .from('pregame_intel')
        .select('match_id, spread_juice, total_juice, home_ml, away_ml, recommended_pick, analyzed_spread')
        .eq('match_id', match.id)
        .order('generated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (intelErr) {
        console.error('❌ Error fetching pregame_intel:', intelErr.message);
    } else if (!intel) {
        console.log('⚠️ No pregame_intel found for this match. This is expected if the worker has not run for this game yet.');
        console.log('   To generate, invoke pregame-intel-cron or POST to pregame-intel-worker with this match_id.');
    } else {
        console.log('✅ Found pregame_intel:');
        console.log(`   recommended_pick: ${intel.recommended_pick || 'N/A'}`);
        console.log(`   analyzed_spread: ${intel.analyzed_spread || 'N/A'}`);
        console.log(`   spread_juice: ${intel.spread_juice || '❌ MISSING'}`);
        console.log(`   total_juice: ${intel.total_juice || '❌ MISSING'}`);
        console.log(`   home_ml: ${intel.home_ml || '❌ MISSING'}`);
        console.log(`   away_ml: ${intel.away_ml || '❌ MISSING'}`);

        if (intel.spread_juice) {
            console.log('\n✅ SUCCESS: spread_juice is being persisted!');
        } else {
            console.log('\n⚠️ WARNING: spread_juice is NULL. This intel was generated BEFORE the fix was deployed.');
            console.log('   To test the fix, trigger a fresh generation for this match using force=true.');
        }
    }

    console.log('\n--- END TEST ---');
}

testJuiceDataFlow().catch(console.error);
