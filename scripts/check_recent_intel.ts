
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const envContent = fs.readFileSync('.env', 'utf8');
const env: any = {};
envContent.split('\n').forEach(line => {
    const [key, ...value] = line.split('=');
    if (key && value) env[key.trim()] = value.join('=').trim().replace(/"/g, '').replace(/'/g, '');
});

const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_URL = env.VITE_SUPABASE_URL || env.SUPABASE_URL;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function checkIntel() {
    console.log('--- RECENT INTEL WRITES ---');
    const { data, error } = await supabase
        .from('pregame_intel')
        .select('match_id, headline, generated_at, home_team, away_team')
        .neq('match_id', 'CRON_SENTINEL')
        .order('generated_at', { ascending: false })
        .limit(10);

    if (error) {
        console.error('Intel Fetch Error:', error);
        return;
    }

    data.forEach(i => {
        console.log(`[${i.generated_at}] ${i.away_team} @ ${i.home_team}: ${i.headline} (${i.match_id})`);
    });
}

checkIntel();
