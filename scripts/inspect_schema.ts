
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

async function inspectSchema() {
    const { data: cols, error } = await supabase.rpc('inspect_table_columns', { tname: 'opening_lines' });

    // If RPC doesn't exist, try a raw query via postgrest trick or just select one row
    const { data: row } = await supabase.from('opening_lines').select('*').limit(1);

    if (row && row.length > 0) {
        console.log('Columns in opening_lines:', Object.keys(row[0]));
    } else {
        console.log('No data in opening_lines or table missing.');
    }
}

inspectSchema();
