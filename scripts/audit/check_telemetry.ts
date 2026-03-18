
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const envContent = fs.readFileSync('.env', 'utf8');
const env: any = {};
envContent.split('\n').forEach(line => {
    const [key, ...value] = line.split('=');
    if (key && value) env[key.trim()] = value.join('=').trim().replace(/"/g, '').replace(/'/g, '');
});

const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_URL = env.VITE_SUPABASE_URL || env.SUPABASE_URL;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function check() {
    console.log('📡 Checking Telemetry V2 Data...');

    const { count, error } = await supabase
        .from('raw_odds_log')
        .select('id', { count: 'exact', head: true });

    if (error) {
        console.error('Error:', error);
        return;
    }

    console.log(`\n📊 Raw Odds Log Count: ${count}`);

    if (count > 0) {
        const { data } = await supabase
            .from('raw_odds_log')
            .select('*')
            .order('ingested_at', { ascending: false })
            .limit(3);

        console.log('\nLatest Ticks:');
        console.table(data);
    }
}

check();
