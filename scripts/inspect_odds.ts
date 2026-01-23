
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

const HASH_ID = '8a5088f34ae01a11b3711cbdc527e1b2'; // Rockets vs Blazers

async function inspectOdds() {
    console.log(`🔍 Inspecting Game Hash: ${HASH_ID}`);

    // Fetch V2 Live State using Hash ID
    const { data: v2, error: v2Err } = await supabase
        .from('live_market_state')
        .select('*') // Just get everything
        .eq('game_id', HASH_ID)
        .eq('market', 'totals')
        .order('line', { ascending: false });

    if (v2Err) console.error('V2 Error:', v2Err);
    else {
        console.log(`\n--- V2 Market State (Totals) ---`);
        if (v2.length === 0) console.log('No V2 data for totals.');

        console.table(v2.map(r => ({
            book: r.book, // Correct: r.book
            line: r.line,
            side: r.side,
            updated: r.last_update_ts, // Correct: r.last_update_ts
            age_sec: Math.round((Date.now() - new Date(r.last_update_ts).getTime()) / 1000)
        })));
    }
}

inspectOdds();
