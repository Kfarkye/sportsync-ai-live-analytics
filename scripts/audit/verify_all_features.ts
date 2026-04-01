
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing Supabase credentials.');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function verifyAllFeatures() {
    console.log('🚀 Comprehensive Intel Verification...\n');

    const { data: intel, error } = await supabase
        .from('pregame_intel')
        .select('match_id, home_team, away_team, headline, recommended_pick, cards, briefing, sources, kernel_trace, spread_juice, generated_at')
        .eq('match_id', 'test_final_soft')
        .single();

    if (error) {
        console.error('❌ Error:', error.message);
        return;
    }

    console.log(`📌 ${intel.away_team} @ ${intel.home_team}\n`);

    console.log('📊 STRUCTURED FIELDS:');
    console.log(`   headline: ${intel.headline ? '✅ ' + intel.headline : '❌ NULL'}`);
    console.log(`   recommended_pick: ${intel.recommended_pick ? '✅ ' + intel.recommended_pick : '❌ NULL'}`);
    console.log(`   cards: ${intel.cards ? '✅ ' + (Array.isArray(intel.cards) ? intel.cards.length : JSON.parse(intel.cards).length) + ' cards' : '❌ NULL'}`);
    console.log(`   briefing: ${intel.briefing ? '✅ ' + intel.briefing.substring(0, 50) + '...' : '❌ NULL'}`);
    console.log(`   spread_juice: ${intel.spread_juice ? '✅ ' + intel.spread_juice : '❌ NULL'}`);

    console.log('\n🔍 GROUNDING (Web Search):');
    const sources = intel.sources ? (typeof intel.sources === 'string' ? JSON.parse(intel.sources) : intel.sources) : [];
    console.log(`   sources: ${sources.length > 0 ? '✅ ' + sources.length + ' sources' : '❌ EMPTY'}`);
    if (sources.length > 0) {
        sources.slice(0, 3).forEach((s: any, i: number) => console.log(`     [${i + 1}] ${s.title || s.uri?.substring(0, 50)}`));
    }

    console.log('\n🧠 DEEP THINKING:');
    const trace = intel.kernel_trace || '';
    console.log(`   kernel_trace: ${trace.length > 50 ? '✅ ' + trace.length + ' chars' : (trace.length > 0 ? '⚠️ Only ' + trace.length + ' chars' : '❌ EMPTY')}`);
    if (trace.length > 50) {
        console.log(`   Preview: ${trace.substring(0, 200)}...`);
    }

    console.log('\n--- FEATURE SUMMARY ---');
    const structuredOk = intel.headline && intel.recommended_pick && intel.cards && intel.briefing;
    const groundingOk = sources.length > 0;
    const thinkingOk = trace.length > 50;

    console.log(`Structured JSON: ${structuredOk ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Web Search Grounding: ${groundingOk ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Deep Thinking Trace: ${thinkingOk ? '✅ PASS' : '❌ FAIL'}`);

    if (structuredOk && groundingOk && thinkingOk) {
        console.log('\n🎉 ALL FEATURES WORKING! Soft-Schema Strategy Successful.');
    } else {
        console.log('\n⚠️ Some features need attention.');
    }
}

verifyAllFeatures().catch(console.error);
