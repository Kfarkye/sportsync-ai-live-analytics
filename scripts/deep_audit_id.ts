
import { createClient } from '@supabase/supabase-js';

const sb = createClient('https://qffzvrnbzabcokqqrwbv.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUzNTc2NjgsImV4cCI6MjA3MDkzMzY2OH0.PCSnC5E7sG7FvasHy_9DdwiN61xW0GzFROLzZ0bTVnc');

async function debug() {
    const id = '401727618';
    console.log(`--- DEEP AUDIT OF MATCH ID ${id} ---`);

    // Check matches
    const { data: matchData } = await sb.from('matches').select('*').eq('id', id).maybeSingle();
    console.log('Matches Record:', matchData);

    // Check with suffix just in case
    const { data: matchSuffixData } = await sb.from('matches').select('*').eq('id', `${id}_ncaab`).maybeSingle();
    console.log('Matches Suffix Record:', matchSuffixData);

    // Check live_game_state
    const { data: stateData } = await sb.from('live_game_state').select('*').eq('id', id).maybeSingle();
    console.log('Live Game State Record:', stateData);

    // Check entity_mappings
    const { data: mappingData } = await sb.from('entity_mappings').select('*').eq('external_id', id);
    console.log('Entity Mappings:', mappingData);
}

debug();
