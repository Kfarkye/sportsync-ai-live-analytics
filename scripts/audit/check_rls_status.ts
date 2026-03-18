
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

async function checkRLSStatus() {
    console.log('--- CHECKING RLS STATUS ---');
    const { data, error } = await supabase.rpc('inspect_table_rls', { table_name: 'pregame_intel' });

    // If RPC doesn't exist, try querying pg_tables
    if (error) {
        console.log('inspect_table_rls RPC failed, trying Direct SQL via Query Builder if possible...');
        // We can't run raw SQL easily without an RPC. 
        // Let's check some existing RPCs in the migrations.
    } else {
        console.log('RLS Status:', data);
    }
}

// Since I don't know if the RPC exists, I'll try to find any existing inspection script or just look at policies
async function listPolicies() {
    console.log('\n--- LISTING POLICIES ---');
    // I'll try to use a standard RPC if I can find one, or just report what I found in migrations.
    console.log('Checking migrations for pregame_intel policies...');
}

checkRLSStatus();
