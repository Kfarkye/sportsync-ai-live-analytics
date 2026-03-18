// scripts/check_date_format.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qffzvrnbzabcokqqrwbv.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    const { data } = await supabase
        .from('pregame_intel')
        .select('game_date, sport, recommended_pick, pick_result')
        .eq('sport', 'college_basketball')
        .order('game_date', { ascending: false })
        .limit(20);

    console.log('Sample CBB picks with dates:');
    data.forEach(d => console.log(`  ${d.game_date} | ${d.pick_result} | ${d.recommended_pick?.slice(0, 40)}`));
}
check();
