import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qffzvrnbzabcokqqrwbv.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUzNTc2NjgsImV4cCI6MjA3MDkzMzY2OH0.PCSnC5E7sG7FvasHy_9DdwiN61xW0GzFROLzZ0bTVnc';
const supabase = createClient(supabaseUrl, supabaseKey);

async function verifyMoneylineOdds() {
    console.log('=== VERIFYING MONEYLINE PICKS AGAINST ACTUAL ODDS ===\n');

    // Get all MONEYLINE type picks
    const { data: uncatView } = await supabase
        .from('vw_titan_master')
        .select('intel_id')
        .eq('category', 'UNCATEGORIZED')
        .in('pick_result', ['WIN', 'LOSS', 'PUSH']);

    const { data: picks } = await supabase
        .from('pregame_intel')
        .select('intel_id, match_id, league_id, home_team, away_team, recommended_pick, grading_metadata, pick_result')
        .in('intel_id', uncatView?.map(p => p.intel_id) || []);

    const mlPicks = picks?.filter(p => p.grading_metadata?.type === 'MONEYLINE') || [];

    console.log(`Total MONEYLINE type picks: ${mlPicks.length}\n`);

    for (const p of mlPicks) {
        console.log(`---`);
        console.log(`Pick: "${p.recommended_pick}"`);
        console.log(`Game: ${p.away_team} @ ${p.home_team}`);
        console.log(`League: ${p.league_id}`);
        console.log(`Result: ${p.pick_result}`);
        console.log(`Grading metadata: ${JSON.stringify(p.grading_metadata)}`);

        // Get match odds
        const { data: match } = await supabase
            .from('matches')
            .select('current_odds, odds_home_spread_safe')
            .eq('id', p.match_id)
            .single();

        if (match) {
            console.log(`Current odds (now):`);
            console.log(`  homeWin (ML): ${match.current_odds?.homeWin}`);
            console.log(`  awayWin (ML): ${match.current_odds?.awayWin}`);
            console.log(`  homeSpread: ${match.current_odds?.homeSpread}`);
            console.log(`  odds_home_spread_safe: ${match.odds_home_spread_safe}`);
        } else {
            console.log(`  NO MATCH DATA FOUND`);
        }
        console.log('');
    }
}

verifyMoneylineOdds();
