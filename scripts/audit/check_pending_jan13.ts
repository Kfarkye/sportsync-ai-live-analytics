
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

async function checkPending() {
    const startOfDay = '2026-01-13T00:00:00Z';
    const endOfDay = '2026-01-14T00:00:00Z';

    const { count, error } = await supabase
        .from('pregame_intel')
        .select('*', { count: 'exact', head: true })
        .neq('match_id', 'CRON_SENTINEL')
        .eq('pick_result', 'PENDING')
        .gte('generated_at', startOfDay)
        .lt('generated_at', endOfDay);

    if (error) {
        console.error('Error:', error);
        return;
    }

    console.log(`Pending picks for Jan 13: ${count}`);
}

checkPending();
