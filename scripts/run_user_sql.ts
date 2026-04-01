import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qffzvrnbzabcokqqrwbv.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUzNTc2NjgsImV4cCI6MjA3MDkzMzY2OH0.PCSnC5E7sG7FvasHy_9DdwiN61xW0GzFROLzZ0bTVnc';
const supabase = createClient(supabaseUrl, supabaseKey);

async function runDiagnosis() {
    console.log('=== 2) QUANTIFY THE EXACT FAILURE MODE (NULL vs ZERO SPREADS) ===\n');

    // Using pregame_intel as source
    const { data: picks, error } = await supabase
        .from('pregame_intel')
        .select('spread_line, pick_result')
        .in('league_id', ['atp', 'wta'])
        // Simulate "PICK_EM" condition: where spread is missing or zero
        .or('spread_line.is.null,spread_line.eq.0');

    if (error) {
        console.error('Error:', error);
        return;
    }

    const stats = {
        NULL: { count: 0, wins: 0, losses: 0, pushes: 0 },
        ZERO: { count: 0, wins: 0, losses: 0, pushes: 0 },
        OTHER: { count: 0, wins: 0, losses: 0, pushes: 0 }
    };

    picks?.forEach(p => {
        let type = 'OTHER';
        if (p.spread_line === null) type = 'NULL';
        else if (p.spread_line === 0) type = 'ZERO';

        stats[type].count++;
        if (p.pick_result === 'WIN') stats[type].wins++;
        if (p.pick_result === 'LOSS') stats[type].losses++;
        if (p.pick_result === 'PUSH') stats[type].pushes++;
    });

    console.log('spread_state | picks | wins | losses | pushes | win_rate_pct');
    console.log('------------ | ----- | ---- | ------ | ------ | ------------');

    for (const [type, d] of Object.entries(stats)) {
        if (d.count === 0 && type !== 'NULL' && type !== 'ZERO') continue;
        const decisions = d.wins + d.losses;
        const rate = decisions > 0 ? ((d.wins / decisions) * 100).toFixed(1) : '0.0';
        console.log(`${type.padEnd(12)} | ${d.count.toString().padEnd(5)} | ${d.wins.toString().padEnd(4)} | ${d.losses.toString().padEnd(6)} | ${d.pushes.toString().padEnd(6)} | ${rate}%`);
    }

    console.log('\n=== 3) SHOW IMPLIED CATEGORIZATION (ODDS PROXY) ===\n');

    const { data: examples } = await supabase
        .from('pregame_intel')
        .select('intel_id, home_team, away_team, spread_line, pick_result, pick_odds')
        .in('league_id', ['atp', 'wta'])
        .or('spread_line.is.null,spread_line.eq.0')
        .not('pick_odds', 'is', null) // Only show ones with odds
        .limit(10);

    console.log('spread | pick_result | pick_odds | implied_side');
    console.log('------ | ----------- | --------- | ------------');

    examples?.forEach(p => {
        const implied = p.pick_odds < 0 ? 'FAVORITE_PROXY' : 'UNDERDOG_PROXY';
        console.log(`${String(p.spread_line).padEnd(6)} | ${String(p.pick_result).padEnd(11)} | ${String(p.pick_odds).padEnd(9)} | ${implied}`);
    });
}

runDiagnosis();
