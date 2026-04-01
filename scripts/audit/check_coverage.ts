
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

// Load env
const envContent = fs.readFileSync('.env', 'utf8');
const env: any = {};
envContent.split('\n').forEach(line => {
    const [key, ...value] = line.split('=');
    if (key && value) env[key.trim()] = value.join('=').trim().replace(/"/g, '').replace(/'/g, '');
});

const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_URL = env.VITE_SUPABASE_URL || env.SUPABASE_URL;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function checkCoverage() {
    console.log('🕵️ Checking Legacy Data Coverage...');

    // 1. Total Matches
    const { count: totalMatches, error: matchLat } = await supabase
        .from('matches')
        .select('id', { count: 'exact', head: true });

    // 2. Matches with History
    // Note: This is an approximation as we can't do distinct count easily via API without RPC
    // We'll approximate by checking matches that have 'opening_odds' populated (a sign of ingestion)
    const { count: trackedMatches, error: trackErr } = await supabase
        .from('matches')
        .select('id', { count: 'exact', head: true })
        .not('opening_odds', 'is', null);

    // 3. Market History Rows
    const { count: historyRows } = await supabase
        .from('market_history')
        .select('id', { count: 'exact', head: true });

    console.log(`\n📊 STATS:`);
    console.log(`- Total Games in DB: ${totalMatches}`);
    console.log(`- Games with Odds Data: ${trackedMatches}`);
    console.log(`- Total History Updates: ${historyRows}`);

    if (totalMatches && trackedMatches) {
        console.log(`\n✅ COVERAGE: ${((trackedMatches / totalMatches) * 100).toFixed(1)}% of games have V1 data.`);
    }
}

checkCoverage();
