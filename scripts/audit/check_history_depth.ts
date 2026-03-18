
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

// Load env
const envContent = fs.readFileSync('.env', 'utf8');
const env: any = {};
envContent.split('\n').forEach(line => {
    const [key, ...value] = line.split('=');
    if (key && value) env[key.trim()] = value.join('=').trim().replace(/"/g, '').replace(/'/g, '');
});

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY);

async function checkTimeRange() {
    console.log('🔍 Checking time coverage of latest 40,000 records...');

    // Get newest
    const { data: newest } = await supabase
        .from('market_history')
        .select('ts')
        .order('id', { ascending: false })
        .limit(1);

    // Get oldest of the "latest 40k"
    // We can't offset 40000 easily sometimes, let's just grab the 40000th record roughly
    // Or just grab the range min/max ID

    // Better: just fetch the 40,000th record
    const { data: oldest } = await supabase
        .from('market_history')
        .select('ts')
        .order('id', { ascending: false })
        .range(39999, 39999)
        .limit(1);

    if (newest && newest[0]) console.log(`Newest Record: ${new Date(newest[0].ts).toLocaleString()}`);
    if (oldest && oldest[0]) console.log(`40,000th Record: ${new Date(oldest[0].ts).toLocaleString()}`);
    else console.log('Less than 40,000 records found.');

    // Count total records
    const { count } = await supabase
        .from('market_history')
        .select('*', { count: 'exact', head: true });

    console.log(`Total Market History Records: ${count}`);
}

checkTimeRange();
