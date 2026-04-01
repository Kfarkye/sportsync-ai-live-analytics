
import { createClient } from '@supabase/supabase-js';

const sb = createClient('https://qffzvrnbzabcokqqrwbv.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUzNTc2NjgsImV4cCI6MjA3MDkzMzY2OH0.PCSnC5E7sG7FvasHy_9DdwiN61xW0GzFROLzZ0bTVnc');

async function checkNhlOdds() {
    console.log('--- CHECKING MARKET_FEEDS FOR NHL ---');

    // Check for any NHL feeds in the last hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const { data: feeds, error } = await sb.from('market_feeds')
        .select('id, home_team, away_team, sport_key, last_updated, canonical_id')
        .eq('sport_key', 'icehockey_nhl')
        .gte('last_updated', oneHourAgo)
        .order('last_updated', { ascending: false });

    if (error) {
        console.error('Error:', error);
        return;
    }

    console.log(`Found ${feeds.length} fresh NHL feeds.`);
    console.table(feeds);

    if (feeds.length > 0) {
        console.log('Sample feed team names for mapping check:');
        console.log(`${feeds[0].home_team} vs ${feeds[0].away_team}`);
    }
}

checkNhlOdds();
