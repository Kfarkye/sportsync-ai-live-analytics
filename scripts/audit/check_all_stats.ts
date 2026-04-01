
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qffzvrnbzabcokqqrwbv.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUzNTc2NjgsImV4cCI6MjA3MDkzMzY2OH0.PCSnC5E7sG7FvasHy_9DdwiN61xW0GzFROLzZ0bTVnc';
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkAllStats() {
    console.log('=== CHECKING ALL LEAGUE DATA ===\n');

    const leagues = ['nba', 'nhl', 'atp', 'wta', 'ncaab', 'nfl']; // Added NFL/NCAAB based on dash

    for (const league of leagues) {
        const { data: picks, error } = await supabase
            .from('pregame_intel')
            .select('pick_result')
            .ilike('league_id', `%${league}%`);

        if (error) {
            console.error(`Error fetching ${league}:`, error);
            continue;
        }

        const wins = picks?.filter(p => p.pick_result === 'WIN').length || 0;
        const losses = picks?.filter(p => p.pick_result === 'LOSS').length || 0;
        const pushes = picks?.filter(p => p.pick_result === 'PUSH').length || 0;
        const pending = picks?.filter(p => p.pick_result === 'PENDING').length || 0;
        const total = wins + losses + pushes;
        const winRate = total > 0 ? (wins / (wins + losses) * 100).toFixed(1) : '0.0';

        console.log(`${league.toUpperCase()}: ${wins}-${losses}-${pushes} (${winRate}%) [Pending: ${pending}]`);
    }
}

checkAllStats();
