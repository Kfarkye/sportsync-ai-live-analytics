// scripts/check_away_dog_cbb_week.js
// Check Away + Underdog + CBB performance for last 7 days

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qffzvrnbzabcokqqrwbv.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const startDate = sevenDaysAgo.toISOString().split('T')[0];

    console.log("📊 Away + Underdog + CBB - Last 7 Days\n");
    console.log("Start date:", startDate);

    const { data } = await supabase
        .from('pregame_intel')
        .select('pick_result, recommended_pick, home_team, away_team, game_date, sport')
        .gte('game_date', startDate)
        .neq('pick_result', 'PENDING')
        .neq('pick_result', 'NO_PICK');

    // Filter to CBB
    const cbbPicks = (data || []).filter(p =>
        (p.sport || '').toLowerCase().includes('college') ||
        (p.sport || '').toLowerCase().includes('basketball')
    );

    console.log("CBB picks last 7 days:", cbbPicks.length);

    // Filter to away underdogs
    const awayDogCBB = cbbPicks.filter(p => {
        const pick = (p.recommended_pick || '');
        const spreadMatch = pick.match(/([+-]\d+\.?\d*)/);
        if (!spreadMatch) return false;
        const spread = parseFloat(spreadMatch[1]);
        if (spread <= 0) return false; // Not underdog

        // Check if away team
        const awayTeam = (p.away_team || '').toLowerCase();
        const pickTeam = pick.split(/[+-]/)[0].trim().toLowerCase();
        const awayLastWord = awayTeam.split(' ').pop();
        return pickTeam.includes(awayLastWord) && awayLastWord.length >= 3;
    });

    const wins = awayDogCBB.filter(p => p.pick_result === 'WIN').length;
    const losses = awayDogCBB.filter(p => p.pick_result === 'LOSS').length;
    const pushes = awayDogCBB.filter(p => p.pick_result === 'PUSH').length;

    console.log("\n🎯 Away + Underdog + CBB (last 7 days):");
    console.log("   Record:", wins + "-" + losses + "-" + pushes);

    if (wins + losses > 0) {
        console.log("   Win%:", ((wins / (wins + losses)) * 100).toFixed(1) + "%");
        console.log("   Fade%:", (100 - (wins / (wins + losses)) * 100).toFixed(1) + "%");
    }

    console.log("\n📋 Sample picks:");
    awayDogCBB.slice(0, 10).forEach(p => {
        const emoji = p.pick_result === 'WIN' ? '✅' : p.pick_result === 'LOSS' ? '❌' : '➖';
        console.log(`   ${emoji} ${p.game_date?.split('T')[0]} ${p.recommended_pick?.slice(0, 50)}`);
    });
}

check();
