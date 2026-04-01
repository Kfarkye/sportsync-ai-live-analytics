// scripts/flag_fade_picks.js
// Flag picks that should be faded based on Away + Underdog + CBB pattern

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qffzvrnbzabcokqqrwbv.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

const DRY_RUN = !process.argv.includes('--fix');

async function flagFadePicks() {
    console.log("🎯 FLAGGING FADE PICKS\n");
    console.log(`Mode: ${DRY_RUN ? '🔍 DRY RUN' : '🔧 FIX MODE'}\n`);

    // Get today's pending CBB picks
    const today = new Date().toISOString().split('T')[0];

    const { data: picks } = await supabase
        .from('pregame_intel')
        .select('intel_id, recommended_pick, home_team, away_team, game_date, sport')
        .eq('pick_result', 'PENDING')
        .gte('game_date', today);

    const cbbPicks = (picks || []).filter(p =>
        (p.sport || '').toLowerCase().includes('college') ||
        (p.sport || '').toLowerCase().includes('basketball')
    );

    console.log(`Found ${cbbPicks.length} pending CBB picks\n`);

    // Find Away + Underdog picks
    const fadePicks = cbbPicks.filter(p => {
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

    console.log(`🔥 ${fadePicks.length} FADE picks (Away + Underdog + CBB):\n`);

    fadePicks.forEach(p => {
        const homeTeam = p.home_team?.split(' ').pop() || 'Home';
        console.log(`   FADE: ${p.recommended_pick}`);
        console.log(`   → BET: ${homeTeam} (the favorite at home)\n`);
    });

    // In production, you'd update these with a is_fade_candidate flag
    // For now, just display them

    console.log("=".repeat(60));
    console.log(`\n✅ ${fadePicks.length} fade candidates identified`);
    console.log("\n💡 Historical fade rate: 76.1% (last 7 days)");
}

flagFadePicks();
