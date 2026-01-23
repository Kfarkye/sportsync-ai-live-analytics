
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const envContent = fs.readFileSync('.env', 'utf8');
const env: any = {};
envContent.split('\n').forEach(line => {
    const [key, ...value] = line.split('=');
    if (key && value) env[key.trim()] = value.join('=').trim().replace(/"/g, '').replace(/'/g, '');
});

const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.SERVICE_ROLE_KEY;
const SUPABASE_URL = env.VITE_SUPABASE_URL || env.SUPABASE_URL;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function checkRecord() {
    console.log('--- PREGAME RECORD (JANUARY 13, 2026) ---');

    // Using 2026-01-13 as requested. 
    // We check generated_at to find picks from that day.
    const startOfDay = '2026-01-13T00:00:00Z';
    const endOfDay = '2026-01-14T00:00:00Z';

    const { data: graded, error } = await supabase
        .from('pregame_intel')
        .select('pick_result, recommended_pick, home_team, away_team, generated_at')
        .neq('match_id', 'CRON_SENTINEL')
        .not('pick_result', 'is', null)
        .neq('pick_result', 'PENDING')
        .gte('generated_at', startOfDay)
        .lt('generated_at', endOfDay)
        .order('generated_at', { ascending: false });

    if (error) {
        console.error('Error:', error);
        return;
    }

    const wins = graded.filter(i => i.pick_result === 'WIN');
    const losses = graded.filter(i => i.pick_result === 'LOSS');
    const pushes = graded.filter(i => i.pick_result === 'PUSH');

    console.log(`Record for Jan 13: ${wins.length}W - ${losses.length}L - ${pushes.length}P`);
    console.log('\nWins:');
    wins.forEach(i => console.log(`✅ ${i.away_team} @ ${i.home_team}: ${i.recommended_pick}`));
    console.log('\nLosses:');
    losses.forEach(i => console.log(`❌ ${i.away_team} @ ${i.home_team}: ${i.recommended_pick}`));

    if (pushes.length > 0) {
        console.log('\nPushes:');
        pushes.forEach(i => console.log(`➖ ${i.away_team} @ ${i.home_team}: ${i.recommended_pick}`));
    }
}

checkRecord();
