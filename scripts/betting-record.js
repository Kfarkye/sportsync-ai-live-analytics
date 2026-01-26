// Quick script to pull betting record from Supabase
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
    // Get date 7 days ago
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    console.log('\n📊 BETTING RECORD - LAST 7 DAYS\n');
    console.log('='.repeat(60));

    // Query graded picks
    const { data: picks, error } = await supabase
        .from('pregame_intel')
        .select('*')
        .gte('created_at', weekAgo.toISOString())
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Query error:', error);
        return;
    }

    console.log(`\nTotal picks this week: ${picks.length}\n`);

    // Group by sport
    const bySport = {};
    const byResult = { WIN: 0, LOSS: 0, PUSH: 0, PENDING: 0 };

    for (const pick of picks) {
        const sport = pick.sport || 'Unknown';
        if (!bySport[sport]) {
            bySport[sport] = { WIN: 0, LOSS: 0, PUSH: 0, PENDING: 0, picks: [] };
        }

        const result = pick.grading_result || 'PENDING';
        bySport[sport][result]++;
        bySport[sport].picks.push(pick);
        byResult[result]++;
    }

    // Summary by sport
    console.log('📈 SUMMARY BY SPORT\n');
    for (const [sport, stats] of Object.entries(bySport)) {
        const total = stats.WIN + stats.LOSS;
        const winPct = total > 0 ? ((stats.WIN / total) * 100).toFixed(1) : 'N/A';
        console.log(`${sport}:`);
        console.log(`  Record: ${stats.WIN}-${stats.LOSS}-${stats.PUSH} (${winPct}% win rate)`);
        console.log(`  Pending: ${stats.PENDING}`);
        console.log('');
    }

    // Overall
    const totalGraded = byResult.WIN + byResult.LOSS;
    const overallWinPct = totalGraded > 0 ? ((byResult.WIN / totalGraded) * 100).toFixed(1) : 'N/A';
    console.log('='.repeat(60));
    console.log(`\n🎯 OVERALL: ${byResult.WIN}-${byResult.LOSS}-${byResult.PUSH} (${overallWinPct}%)`);
    console.log(`   Pending: ${byResult.PENDING}`);

    // Recent picks detail
    console.log('\n\n📋 RECENT GRADED PICKS\n');
    const graded = picks.filter(p => p.grading_result);
    for (const pick of graded.slice(0, 20)) {
        const result = pick.grading_result;
        const emoji = result === 'WIN' ? '✅' : result === 'LOSS' ? '❌' : '➖';
        const date = new Date(pick.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        console.log(`${emoji} [${date}] ${pick.away_team} @ ${pick.home_team}`);
        console.log(`   ${pick.pick_type}: ${pick.pick_side} ${pick.analyzed_spread || pick.analyzed_total || ''}`);
        if (pick.grading_metadata?.final_score) {
            console.log(`   Final: ${pick.grading_metadata.final_score}`);
        }
        console.log('');
    }
}

main().catch(console.error);
