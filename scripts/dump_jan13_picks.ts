
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

async function dumpAll() {
    console.log('--- DUMP ALL GRADED PICKS (JAN 13) ---');

    const startOfDay = '2026-01-13T00:00:00Z';
    const endOfDay = '2026-01-14T00:00:00Z';

    // Get all graded picks for the day
    const { data: graded, error } = await supabase
        .from('pregame_intel')
        .select('match_id, home_team, away_team, pick_result, recommended_pick')
        .neq('match_id', 'CRON_SENTINEL')
        .neq('pick_result', 'PENDING')
        .gte('generated_at', startOfDay)
        .lt('generated_at', endOfDay);

    if (error) {
        console.error(error);
        return;
    }

    console.log(`Total Graded: ${graded.length}`);
    graded.forEach(i => {
        console.log(`[${i.match_id}] ${i.away_team} @ ${i.home_team}: ${i.pick_result} (${i.recommended_pick})`);
    });
}

dumpAll();
