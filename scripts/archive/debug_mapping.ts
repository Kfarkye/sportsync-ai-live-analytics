
import { createClient } from '@supabase/supabase-js';

const sb = createClient('https://qffzvrnbzabcokqqrwbv.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUzNTc2NjgsImV4cCI6MjA3MDkzMzY2OH0.PCSnC5E7sG7FvasHy_9DdwiN61xW0GzFROLzZ0bTVnc');

async function debug() {
    const id = '401727618';
    console.log(`--- SEARCHING ENTITY MAPPINGS FOR ${id} ---`);
    const { data: mappings } = await sb.from('entity_mappings')
        .select('*')
        .or(`external_id.eq.${id},canonical_id.ilike.%${id}%`);

    console.table(mappings);

    if (mappings && mappings.length > 0) {
        console.log('Mapping found! Canonical ID:', mappings[0].canonical_id);
    } else {
        console.log('No mapping found for this ID.');
    }
}

debug();
