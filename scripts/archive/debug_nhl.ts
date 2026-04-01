
import { createClient } from '@supabase/supabase-js';

const sb = createClient('https://qffzvrnbzabcokqqrwbv.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUzNTc2NjgsImV4cCI6MjA3MDkzMzY2OH0.PCSnC5E7sG7FvasHy_9DdwiN61xW0GzFROLzZ0bTVnc');

async function debug() {
    const ids = ['401825838', '401826012'];
    console.log(`--- DEBUGGING NHL MATCHES: ${ids.join(', ')} ---`);

    for (const id of ids) {
        const fullId = `${id}_nhl`;
        const { data: matches } = await sb.from('matches')
            .select('id, home_team, away_team, status, league_id, canonical_id, last_updated')
            .or(`id.eq.${id},id.eq.${fullId}`);

        console.log(`Results for ${id}:`);
        console.table(matches);

        if (matches && matches.length > 0) {
            const m = matches[0];
            // If canonical_id is missing, let's see if we can resolve it manually with the registry logic
            console.log(`Details for ${id}:`, JSON.stringify(m, null, 2));
        }
    }

    // Check recent NHL canonical games
    const { data: canonicals } = await sb.from('canonical_games')
        .select('id, home_team_name, away_team_name, commence_time')
        .eq('sport', 'icehockey_nhl') // or just search by ID suffix
        .ilike('id', '%_nhl%')
        .order('commence_time', { ascending: false })
        .limit(10);

    console.log('--- RECENT NHL CANONICAL GAMES ---');
    console.table(canonicals || []);
}

debug();
