
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

async function nukeBadData() {
    console.log('🔍 Targeting Timberwolves vs Cavaliers (401810385_nba)...');

    // 1. Get Match Details
    const { data: match } = await supabase
        .from('matches')
        .select('*')
        .eq('id', '401810385_nba')
        .single();

    if (!match) {
        console.error('Match not found!');
        return;
    }

    console.log(`Match Start: ${match.start_time}`);
    const startTime = new Date(match.start_time).getTime();
    const threshold = new Date(startTime + 5 * 60 * 1000).toISOString();
    console.log(`Live Threshold: ${threshold}`);

    // 2. Find Bad Records
    const { data: badRows } = await supabase
        .from('market_history')
        .select('*')
        .eq('match_id', match.id)
        .eq('is_live', false)
        .gt('ts', threshold);

    if (!badRows || badRows.length === 0) {
        console.log('No bad rows found matching criteria.');
    } else {
        console.log(`⚠️ FOUND ${badRows.length} BAD RECORDS:`);
        badRows.forEach(row => {
            console.log(`- ID: ${row.id} | TS: ${row.ts} | Total: ${row.total_line} | Live: ${row.is_live}`);
        });

        // 3. Fix them
        console.log('fixing...');
        const ids = badRows.map(r => r.id);
        const { error } = await supabase
            .from('market_history')
            .update({ is_live: true })
            .in('id', ids);

        if (error) console.error('Fix failed:', error);
        else console.log('✅ FIXED.');
    }
}

nukeBadData();
