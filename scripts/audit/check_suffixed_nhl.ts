
import { createClient } from '@supabase/supabase-js';

const sb = createClient('https://qffzvrnbzabcokqqrwbv.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUzNTc2NjgsImV4cCI6MjA3MDkzMzY2OH0.PCSnC5E7sG7FvasHy_9DdwiN61xW0GzFROLzZ0bTVnc');

async function checkSuffixed() {
    const ids = ['401803060_nhl', '401803061_nhl'];
    console.log(`--- CHECKING FOR SUFFIXED IDS: ${ids.join(', ')} ---`);

    const { data: matches } = await sb.from('matches')
        .select('id, home_team, away_team, status, league_id, canonical_id, last_updated')
        .in('id', ids);

    console.table(matches);
}

checkSuffixed();
