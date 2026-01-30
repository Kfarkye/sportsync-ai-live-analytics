
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qffzvrnbzabcokqqrwbv.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUzNTc2NjgsImV4cCI6MjA3MDkzMzY2OH0.PCSnC5E7sG7FvasHy_9DdwiN61xW0GzFROLzZ0bTVnc';
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkLeaguesView() {
    console.log('=== CHECKING LEAGUES VIEW ===\n');

    const { data: viewData, error } = await supabase
        .from('vw_titan_leagues')
        .select('*');

    if (error) {
        console.log('Error:', error);
        return;
    }

    console.log('Leagues View Data:', JSON.stringify(viewData, null, 2));
}

checkLeaguesView();
