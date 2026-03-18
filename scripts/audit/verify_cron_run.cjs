/**
 * CRON RUN VERIFICATION SCRIPT
 * Verifies that pregame intel was generated successfully
 * Run: node scripts/verify_cron_run.cjs
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load .env.local manually
const envPath = path.join(__dirname, '..', '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
envContent.split('\n').forEach(line => {
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length) {
        process.env[key.trim()] = valueParts.join('=').trim();
    }
});

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function verify() {
    console.log('\n🔍 PREGAME INTEL CRON VERIFICATION\n');
    console.log('='.repeat(60));

    // 1. Check today's and tomorrow's game dates (Pacific Time)
    const now = new Date();
    const pacificDate = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(now);

    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const tomorrowDate = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(tomorrow);

    console.log(`📅 Checking dates: ${pacificDate} (today) and ${tomorrowDate} (tomorrow)\n`);

    // 2. Get intel counts by date
    const { data: todayIntel, error: todayErr } = await supabase
        .from('pregame_intel')
        .select('match_id, recommended_pick, sport, league_id, generated_at')
        .eq('game_date', pacificDate);

    const { data: tomorrowIntel, error: tmrErr } = await supabase
        .from('pregame_intel')
        .select('match_id, recommended_pick, sport, league_id, generated_at')
        .eq('game_date', tomorrowDate);

    console.log(`📊 INTEL COUNTS`);
    console.log(`   Today (${pacificDate}): ${todayIntel?.length || 0} records`);
    console.log(`   Tomorrow (${tomorrowDate}): ${tomorrowIntel?.length || 0} records`);
    console.log(`   TOTAL: ${(todayIntel?.length || 0) + (tomorrowIntel?.length || 0)} records\n`);

    // 3. Breakdown by sport/league
    const allIntel = [...(todayIntel || []), ...(tomorrowIntel || [])];
    const sportBreakdown = {};
    const noMarketCount = allIntel.filter(i => i.recommended_pick === 'NO_MARKET').length;
    const validPicks = allIntel.filter(i => i.recommended_pick && i.recommended_pick !== 'NO_MARKET');

    allIntel.forEach(i => {
        const key = `${i.sport || 'unknown'}/${i.league_id || 'unknown'}`;
        sportBreakdown[key] = (sportBreakdown[key] || 0) + 1;
    });

    console.log(`📈 BREAKDOWN BY SPORT/LEAGUE`);
    Object.entries(sportBreakdown)
        .sort((a, b) => b[1] - a[1])
        .forEach(([key, count]) => {
            console.log(`   ${key}: ${count}`);
        });

    console.log(`\n✅ DATA QUALITY`);
    console.log(`   Valid picks: ${validPicks.length}`);
    console.log(`   NO_MARKET: ${noMarketCount}`);
    if (allIntel.length > 0) {
        console.log(`   Success rate: ${((validPicks.length / allIntel.length) * 100).toFixed(1)}%\n`);
    }

    // 4. Check latest batch from log
    const { data: logs } = await supabase
        .from('pregame_intel_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5);

    if (logs?.length) {
        console.log(`📋 RECENT CRON RUNS`);
        logs.forEach(log => {
            const duration = log.duration_ms ? `${(log.duration_ms / 1000).toFixed(1)}s` : 'N/A';
            console.log(`   ${log.batch_id?.slice(0, 20)}... | Processed: ${log.matches_processed} | Success: ${log.matches_succeeded} | Failed: ${log.matches_failed} | Duration: ${duration}`);
        });
    }

    // 5. Sample picks
    console.log(`\n🎯 SAMPLE PICKS (last 10 generated)`);
    const recentPicks = validPicks
        .sort((a, b) => new Date(b.generated_at) - new Date(a.generated_at))
        .slice(0, 10);

    recentPicks.forEach(p => {
        console.log(`   ${(p.league_id || 'unknown').padEnd(12)} | ${p.recommended_pick}`);
    });

    console.log('\n' + '='.repeat(60));
    console.log('✅ VERIFICATION COMPLETE\n');
}

verify().catch(console.error);
