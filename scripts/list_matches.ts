
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

console.log('Connecting to:', SUPABASE_URL);

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function debugListHelper() {
    console.log('🔍 Executing Base Query...');

    // Just count total matches first
    const { count, error: countErr } = await supabase
        .from('matches')
        .select('*', { count: 'exact', head: true });

    if (countErr) {
        console.error('Count Error:', countErr);
        return;
    }
    console.log('Total Rows in Matches:', count);

    // List recent games
    // List ALL recent games (Nuclear Option)
    const { data: rawData, error } = await supabase
        .from('matches')
        .select('*')
        .order('last_updated', { ascending: false })
        .limit(2000); // Get everything

    if (error) {
        console.error('Select Error:', error);
        return;
    }

    // Filter in JS: MUST have BOTH Rocket AND Blazer
    const nbaGames = rawData?.filter(m =>
        (JSON.stringify(m).includes('Rocket') && JSON.stringify(m).includes('Blazer'))
    );

    console.table(nbaGames?.map(m => ({
        id: m.id,
        sport: m.sport,
        home: m.home_team,
        away: m.away_team,
        updated: m.last_updated,
        best_spread: m.current_odds?.best_spread,
        best_total: m.current_odds?.best_total
    })));
}

debugListHelper();
