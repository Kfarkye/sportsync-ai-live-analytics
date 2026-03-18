import { createClient } from '@supabase/supabase-js';

const sb = createClient('https://qffzvrnbzabcokqqrwbv.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUzNTc2NjgsImV4cCI6MjA3MDkzMzY2OH0.PCSnC5E7sG7FvasHy_9DdwiN61xW0GzFROLzZ0bTVnc');

async function check() {
    // 1. Check if the specific Jazz game exists in matches
    const { data: matchById } = await sb.from('matches')
        .select('*')
        .eq('id', '401810402_nba');

    console.log('--- MATCH BY ID (401810402_nba) ---');
    console.table(matchById);

    // 2. Check all live matches without filters
    const { data: liveMatches } = await sb.from('matches')
        .select('id, home_team, away_team, status, league_id')
        .or('status.eq.STATUS_IN_PROGRESS,status.eq.IN_PROGRESS,status.eq.LIVE');

    console.log('--- ALL LIVE MATCHES ---');
    console.table(liveMatches);

    // 3. Check for any match with "Charlotte" or "Utah"
    const { data: charlotteMatches } = await sb.from('matches')
        .select('id, home_team, away_team, status')
        .or('home_team.ilike.%Charlotte%,away_team.ilike.%Charlotte%,home_team.ilike.%Utah%,away_team.ilike.%Utah%')
        .limit(10);

    console.log('--- CHARLOTTE/UTAH MATCHES ---');
    console.table(charlotteMatches);
}
check();
