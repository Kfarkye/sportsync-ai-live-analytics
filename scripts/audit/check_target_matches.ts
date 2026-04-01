
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

async function checkSpecificMatches() {
    const targetIds = ['401814519_ncaab', '401822897_ncaab', '401822899_ncaab', '401814518_ncaab', '401825439_ncaab', '401830268_ncaab'];
    console.log('--- CHECKING SPECIFIC MATCHES ---');
    const { data, error } = await supabase
        .from('pregame_intel')
        .select('match_id, headline, generated_at')
        .in('match_id', targetIds);

    if (error) {
        console.error('Fetch Error:', error);
        return;
    }

    if (data.length === 0) {
        console.log('No records found for these IDs.');
    } else {
        data.forEach(i => {
            console.log(`[${i.generated_at}] ${i.match_id}: ${i.headline}`);
        });
    }
}

checkSpecificMatches();
