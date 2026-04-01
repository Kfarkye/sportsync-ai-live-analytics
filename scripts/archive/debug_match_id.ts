
import { createClient } from '@supabase/supabase-js';

const sb = createClient('https://qffzvrnbzabcokqqrwbv.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUzNTc2NjgsImV4cCI6MjA3MDkzMzY2OH0.PCSnC5E7sG7FvasHy_9DdwiN61xW0GzFROLzZ0bTVnc');

async function debug() {
    const id = '401727618';
    console.log(`--- DEBUGGING MATCH ID ${id} ---`);

    // Check both raw ID and with suffix
    const { data: matches } = await sb.from('matches')
        .select('id, home_team, away_team, league_id, canonical_id, last_updated')
        .or(`id.eq.${id},id.eq.${id}_ncaab`);

    console.table(matches);

    if (matches && matches.length > 0) {
        // If it exists but canonical_id is missing, let's see why
        const m = matches[0];
        console.log('Match details:', m);
    }
}

debug();
