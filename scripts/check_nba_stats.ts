
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qffzvrnbzabcokqqrwbv.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUzNTc2NjgsImV4cCI6MjA3MDkzMzY2OH0.PCSnC5E7sG7FvasHy_9DdwiN61xW0GzFROLzZ0bTVnc';
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkNbaStats() {
    console.log('=== CHECKING ACTUAL NBA DATA ===\n');

    // Count pure raw records
    const { count: rawCount, error: rawError } = await supabase
        .from('pregame_intel')
        .select('*', { count: 'exact', head: true })
        .ilike('league_id', '%nba%');

    if (rawError) console.error('Error counting raw:', rawError);
    console.log(`Raw Total NBA Picks in DB: ${rawCount}`);

    // Count by Result
    const { data: picks } = await supabase
        .from('pregame_intel')
        .select('pick_result')
        .ilike('league_id', '%nba%');

    const wins = picks?.filter(p => p.pick_result === 'WIN').length || 0;
    const losses = picks?.filter(p => p.pick_result === 'LOSS').length || 0;
    const pushes = picks?.filter(p => p.pick_result === 'PUSH').length || 0;
    const pending = picks?.filter(p => p.pick_result === 'PENDING').length || 0;

    console.log(`\nActual Record Breakdown:`);
    console.log(`Wins: ${wins}`);
    console.log(`Losses: ${losses}`);
    console.log(`Pushes: ${pushes}`);
    console.log(`Pending: ${pending}`);
    console.log(`Total Scored: ${wins + losses + pushes}`);

    const winRate = wins / (wins + losses) * 100;
    console.log(`Win Rate (W/L): ${winRate.toFixed(1)}%`);
}

checkNbaStats();
