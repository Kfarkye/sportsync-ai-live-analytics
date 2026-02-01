// scripts/yesterday_stats.js
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getYesterdayStats() {
    const yesterday = '2026-01-31';

    const { data, error } = await supabase
        .from('pregame_intel')
        .select('sport, league_id, recommended_pick, grade, grading_metadata')
        .eq('game_date', yesterday)
        .not('grade', 'is', null);

    if (error) {
        console.error('Error:', error.message);
        return;
    }

    if (!data || data.length === 0) {
        console.log('No graded picks found for', yesterday);
        return;
    }

    // Group by sport
    const bySport = {};
    data.forEach(pick => {
        const sport = pick.sport || pick.league_id || 'unknown';
        if (!bySport[sport]) bySport[sport] = { wins: 0, losses: 0, pushes: 0, total: 0 };
        bySport[sport].total++;
        if (pick.grade === 'WIN') bySport[sport].wins++;
        else if (pick.grade === 'LOSS') bySport[sport].losses++;
        else if (pick.grade === 'PUSH') bySport[sport].pushes++;
    });

    console.log('\n=== YESTERDAY (Jan 31) PICK RESULTS ===\n');
    let totalWins = 0, totalLosses = 0, totalPushes = 0;

    Object.entries(bySport).sort((a, b) => b[1].total - a[1].total).forEach(([sport, stats]) => {
        const winPct = (stats.wins + stats.losses) > 0 ? ((stats.wins / (stats.wins + stats.losses)) * 100).toFixed(1) : 'N/A';
        console.log(sport.toUpperCase().padEnd(15),
            'W:', String(stats.wins).padStart(2),
            'L:', String(stats.losses).padStart(2),
            'P:', String(stats.pushes).padStart(2),
            '| Win%:', winPct + '%');
        totalWins += stats.wins;
        totalLosses += stats.losses;
        totalPushes += stats.pushes;
    });

    const overallPct = (totalWins + totalLosses) > 0 ? ((totalWins / (totalWins + totalLosses)) * 100).toFixed(1) : 'N/A';
    console.log('\n' + '─'.repeat(45));
    console.log('TOTAL'.padEnd(15),
        'W:', String(totalWins).padStart(2),
        'L:', String(totalLosses).padStart(2),
        'P:', String(totalPushes).padStart(2),
        '| Win%:', overallPct + '%');
}

getYesterdayStats();
