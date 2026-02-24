import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const url = 'https://qffzvrnbzabcokqqrwbv.supabase.co';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUzNTc2NjgsImV4cCI6MjA3MDkzMzY2OH0.PCSnC5E7sG7FvasHy_9DdwiN061xW0GzFROLzZ0bTVnc';
const supabase = createClient(url, key);

async function check() {
    console.log("Checking DB for recent odds...");

    // Checking matches near today
    const { data: matches } = await supabase.from('matches')
        .select('id, start_time, home_team, away_team, current_odds, closing_odds')
        .eq('league_id', 'nba')
        .gte('start_time', new Date(Date.now() - 48 * 3600 * 1000).toISOString())
        .lte('start_time', new Date(Date.now() + 48 * 3600 * 1000).toISOString())
        .limit(10);

    console.log("NBA Matches in ~48h window:", JSON.stringify(matches, null, 2));
}

check();
