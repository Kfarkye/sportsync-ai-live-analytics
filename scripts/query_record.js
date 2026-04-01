const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://qffzvrnbzabcokqqrwbv.supabase.co', process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
    const { data, error } = await supabase
        .from('pregame_intel')
        .select('sport, league_id, pick_result, game_date')
        .in('pick_result', ['WIN', 'LOSS', 'PUSH']);

    if (error) { console.error(error); return; }

    const wins = data.filter(p => p.pick_result === 'WIN').length;
    const losses = data.filter(p => p.pick_result === 'LOSS').length;
    const pushes = data.filter(p => p.pick_result === 'PUSH').length;
    const total = wins + losses;

    console.log('\n📊 OVERALL RECORD (All Time)\n');
    console.log('W-L-P:', wins + '-' + losses + '-' + pushes);
    console.log('Win Rate:', ((wins / total) * 100).toFixed(1) + '%');
    console.log('Total Graded:', total + pushes, '\n');

    const bySport = {};
    data.forEach(p => {
        const sport = (p.sport || p.league_id || 'unknown').toLowerCase();
        if (!bySport[sport]) bySport[sport] = { wins: 0, losses: 0, pushes: 0 };
        if (p.pick_result === 'WIN') bySport[sport].wins++;
        if (p.pick_result === 'LOSS') bySport[sport].losses++;
        if (p.pick_result === 'PUSH') bySport[sport].pushes++;
    });

    console.log('BY SPORT:');
    Object.entries(bySport).sort((a, b) => (b[1].wins + b[1].losses) - (a[1].wins + a[1].losses)).forEach(([sport, r]) => {
        const t = r.wins + r.losses;
        const pct = t > 0 ? ((r.wins / t) * 100).toFixed(1) : '0.0';
        console.log(sport.toUpperCase().padEnd(12), r.wins + '-' + r.losses + '-' + r.pushes, '(' + pct + '%)');
    });

    console.log('\nLAST 7 DAYS:');
    const byDate = {};
    data.forEach(p => {
        if (!byDate[p.game_date]) byDate[p.game_date] = { wins: 0, losses: 0, pushes: 0 };
        if (p.pick_result === 'WIN') byDate[p.game_date].wins++;
        if (p.pick_result === 'LOSS') byDate[p.game_date].losses++;
        if (p.pick_result === 'PUSH') byDate[p.game_date].pushes++;
    });
    Object.entries(byDate).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 7).forEach(([date, r]) => {
        const t = r.wins + r.losses;
        const pct = t > 0 ? ((r.wins / t) * 100).toFixed(1) : '0.0';
        console.log(date, r.wins + '-' + r.losses + '-' + r.pushes, '(' + pct + '%)');
    });
})();
