// scripts/spot_check_day.js
// Spot check a specific day's CBB picks to verify fade signal

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qffzvrnbzabcokqqrwbv.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

const checkDate = process.argv[2] || '2026-01-21';

async function spotCheck() {
    console.log(`📊 SPOT CHECK: ${checkDate}\n`);
    console.log("=".repeat(80));

    const { data: picks } = await supabase
        .from('pregame_intel')
        .select('*')
        .eq('game_date', checkDate)
        .order('sport', { ascending: true });

    console.log(`\nTotal picks on ${checkDate}: ${picks?.length || 0}\n`);

    // Filter to CBB
    const cbbPicks = (picks || []).filter(p =>
        (p.sport || '').toLowerCase().includes('college') ||
        (p.sport || '').toLowerCase().includes('basketball')
    );

    console.log(`CBB picks: ${cbbPicks.length}\n`);
    console.log("=".repeat(80));

    // Classify each pick
    let fadeWins = 0, fadeLosses = 0;
    let baseWins = 0, baseLosses = 0;

    cbbPicks.forEach((p, i) => {
        const pick = (p.recommended_pick || '');
        const spreadMatch = pick.match(/([+-]\d+\.?\d*)/);
        const spread = spreadMatch ? parseFloat(spreadMatch[1]) : null;

        // Determine if underdog
        const isUnderdog = spread !== null && spread > 0;

        // Determine if away team
        const awayTeam = (p.away_team || '').toLowerCase();
        const pickTeam = pick.split(/[+-]/)[0].trim().toLowerCase();
        const awayLastWord = awayTeam.split(' ').pop();
        const isAway = pickTeam.includes(awayLastWord) && awayLastWord.length >= 3;

        const isFadeCandidate = isUnderdog && isAway;

        const resultEmoji = p.pick_result === 'WIN' ? '✅' :
            p.pick_result === 'LOSS' ? '❌' :
                p.pick_result === 'PUSH' ? '➖' : '⏳';

        const fadeLabel = isFadeCandidate ? '🎯 FADE' : '    BASE';

        console.log(`${i + 1}. ${resultEmoji} ${fadeLabel} | ${pick}`);
        console.log(`   ${p.away_team} @ ${p.home_team}`);
        console.log(`   Underdog: ${isUnderdog ? 'YES' : 'NO'} | Away: ${isAway ? 'YES' : 'NO'}`);
        console.log(`   Result: ${p.pick_result}\n`);

        if (isFadeCandidate) {
            if (p.pick_result === 'WIN') fadeLosses++; // Model won = fade lost
            if (p.pick_result === 'LOSS') fadeWins++;  // Model lost = fade won
        } else {
            if (p.pick_result === 'WIN') baseWins++;
            if (p.pick_result === 'LOSS') baseLosses++;
        }
    });

    console.log("=".repeat(80));
    console.log("\n📊 SUMMARY:\n");
    console.log(`   FADE candidates: ${fadeWins + fadeLosses} picks`);
    console.log(`   FADE performance: ${fadeWins}-${fadeLosses} (${fadeWins + fadeLosses > 0 ? ((fadeWins / (fadeWins + fadeLosses)) * 100).toFixed(1) : 0}%)`);
    console.log(`\n   BASE picks: ${baseWins + baseLosses} picks`);
    console.log(`   BASE performance: ${baseWins}-${baseLosses} (${baseWins + baseLosses > 0 ? ((baseWins / (baseWins + baseLosses)) * 100).toFixed(1) : 0}%)`);
}

spotCheck();
