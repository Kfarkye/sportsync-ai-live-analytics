
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

async function checkPendingDetails() {
    const startOfDay = '2026-01-13T00:00:00Z';
    const endOfDay = '2026-01-14T00:00:00Z';

    const { data: pending, error } = await supabase
        .from('pregame_intel')
        .select('match_id, home_team, away_team, recommended_pick, pick_result, analyzed_spread, analyzed_total, grading_metadata')
        .neq('match_id', 'CRON_SENTINEL')
        .eq('pick_result', 'PENDING')
        .gte('generated_at', startOfDay)
        .lt('generated_at', endOfDay);

    if (error) {
        console.error('Error:', error);
        return;
    }

    console.log(`--- PENDING PICKS (JAN 13) ---`);
    pending.forEach(p => {
        console.log(`[PENDING] ${p.away_team} @ ${p.home_team}: ${p.recommended_pick} (S: ${p.analyzed_spread}, T: ${p.analyzed_total}) [Meta: ${p.grading_metadata ? 'PRESENT' : 'MISSING'}] (${p.match_id})`);
    });
}

checkPendingDetails();
