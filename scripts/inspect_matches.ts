
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

async function inspectMatches() {
    console.log('--- MATCHES SCHEMA ---');
    const { data: row } = await supabase.from('matches').select('*').limit(1);

    if (row && row.length > 0) {
        for (const [key, val] of Object.entries(row[0])) {
            console.log(`${key}: ${typeof val} (${JSON.stringify(val)})`);
        }
    } else {
        console.log('No data in matches.');
    }
}

inspectMatches();
