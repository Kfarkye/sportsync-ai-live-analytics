import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function verify() {
    const tests = ['final_test_cavs_76ers', 'final_test_bulls_nets'];

    for (const matchId of tests) {
        const { data } = await supabase.from('pregame_intel')
            .select('match_id, home_team, away_team, headline, recommended_pick, cards, sources')
            .eq('match_id', matchId)
            .single();

        if (!data) { console.log('\n❌ No data for', matchId); continue; }

        const cards = typeof data.cards === 'string' ? JSON.parse(data.cards) : data.cards || [];
        const sources = typeof data.sources === 'string' ? JSON.parse(data.sources) : data.sources || [];

        console.log('\n═══════════════════════════════════════');
        console.log(`📌 ${data.away_team} @ ${data.home_team}`);
        console.log('═══════════════════════════════════════');
        console.log('headline:', data.headline || '❌ NULL');
        console.log('pick:', data.recommended_pick || '❌ NULL');
        console.log('cards:', cards.length > 0 ? cards.length + ' cards ✅' : '❌ EMPTY');
        console.log('sources:', sources.length > 0 ? sources.length + ' sources ✅' : '❌ EMPTY');
        if (sources.length > 0) {
            sources.forEach((s: any, i: number) => console.log(`  [${i + 1}]`, s.title || s.uri?.substring(0, 50)));
        }
    }
    console.log('\n🎉 FINAL VERIFICATION COMPLETE');
}

verify().catch(console.error);
