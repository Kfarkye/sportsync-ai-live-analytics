
import { createClient } from '@supabase/supabase-js';

const sb = createClient('https://qffzvrnbzabcokqqrwbv.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUzNTc2NjgsImV4cCI6MjA3MDkzMzY2OH0.PCSnC5E7sG7FvasHy_9DdwiN61xW0GzFROLzZ0bTVnc');

async function debug() {
    console.log('--- INSPECTING MATCHES SCHEMA ---');
    const { data: sample } = await sb.from('matches').select('*').limit(1);
    if (sample && sample[0]) {
        console.log('Matches Columns:', Object.keys(sample[0]));
        console.log('Sample Row home_team type:', typeof sample[0].home_team);
        console.log('Sample Row homeTeam type:', typeof sample[0].homeTeam);
    }

    console.log('--- FETCHING RECENT NCAAB ---');
    const { data: matches } = await sb.from('matches')
        .select('id, home_team, away_team, league_id, canonical_id, last_updated')
        .eq('league_id', 'mens-college-basketball')
        .order('last_updated', { ascending: false })
        .limit(10);

    console.table(matches);

    // Filter for utah or byu locally if ilike is failing
    const byuUtah = (matches || []).filter(m =>
        (m.home_team && (m.home_team.includes('BYU') || m.home_team.includes('Utah'))) ||
        (m.away_team && (m.away_team.includes('BYU') || m.away_team.includes('Utah')))
    );

    console.log('--- BYU/UTAH MATCHES (Local Filter) ---');
    console.table(byuUtah);
}

debug();
