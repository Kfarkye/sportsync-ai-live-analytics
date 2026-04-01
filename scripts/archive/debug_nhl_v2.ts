
import { createClient } from '@supabase/supabase-js';

const sb = createClient('https://qffzvrnbzabcokqqrwbv.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUzNTc2NjgsImV4cCI6MjA3MDkzMzY2OH0.PCSnC5E7sG7FvasHy_9DdwiN61xW0GzFROLzZ0bTVnc');

async function debug() {
    const ids = ['401803060', '401803061'];
    console.log(`--- DEEP AUDIT OF NHL MATCHES: ${ids.join(', ')} ---`);

    for (const id of ids) {
        const fullId = `${id}_nhl`;
        const { data: matches } = await sb.from('matches')
            .select('id, home_team, away_team, status, league_id, canonical_id, last_updated')
            .or(`id.eq.${id},id.eq.${fullId}`);

        console.log(`Results for ${id}:`);
        console.table(matches);

        if (matches && matches.length > 0) {
            console.log(`Details for ${id}:`, JSON.stringify(matches[0], null, 2));
        } else {
            console.log(`ID ${id} NOT FOUND IN matches TABLE.`);
        }
    }

    // Check entity_mappings
    const { data: mappings } = await sb.from('entity_mappings')
        .select('*')
        .in('external_id', ids);
    console.log('--- ENTITY MAPPINGS ---');
    console.table(mappings || []);
}

debug();
