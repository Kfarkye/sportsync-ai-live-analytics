import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qffzvrnbzabcokqqrwbv.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUzNTc2NjgsImV4cCI6MjA3MDkzMzY2OH0.PCSnC5E7sG7FvasHy_9DdwiN61xW0GzFROLzZ0bTVnc';
const supabase = createClient(supabaseUrl, supabaseKey);

async function investigateMoneylineCategory() {
    console.log('=== INVESTIGATING MONEYLINE/PICK_EM CATEGORIES ===\n');

    // Check what's in the heatmap for PICK_EM or MONEYLINE
    const { data: heatmap } = await supabase
        .from('vw_titan_heatmap')
        .select('*')
        .in('category', ['PICK_EM', 'MONEYLINE']);

    console.log('Heatmap entries for PICK_EM/MONEYLINE:');
    console.log(JSON.stringify(heatmap, null, 2));

    // Check vw_titan_master for these categories
    const { data: masterData } = await supabase
        .from('vw_titan_master')
        .select('*')
        .in('category', ['PICK_EM', 'MONEYLINE'])
        .limit(20);

    console.log('\n\nSample picks with PICK_EM/MONEYLINE category:');
    console.log(JSON.stringify(masterData, null, 2));
}

investigateMoneylineCategory();
