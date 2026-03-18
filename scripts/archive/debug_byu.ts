
import { createClient } from '@supabase/supabase-js';

const sb = createClient('https://qffzvrnbzabcokqqrwbv.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUzNTc2NjgsImV4cCI6MjA3MDkzMzY2OH0.PCSnC5E7sG7FvasHy_9DdwiN61xW0GzFROLzZ0bTVnc');

async function debug() {
    console.log('--- SEARCHING FOR BYU/UTAH VARIANTS ---');

    // Select all recent matches (last 24h) to find potential duplicates
    const { data: matches } = await sb.from('matches')
        .select('id, home_team, away_team, status, canonical_id, last_updated')
        .or('home_team.ilike.%BYU%,away_team.ilike.%BYU%,home_team.ilike.%Utah%,away_team.ilike.%Utah%')
        .order('last_updated', { ascending: false });

    console.table(matches);
}

debug();
