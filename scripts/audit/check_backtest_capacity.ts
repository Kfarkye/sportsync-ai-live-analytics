
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

async function checkDataDepth() {
    // 1. Oldest Market History
    const { data: oldest } = await supabase
        .from('market_history')
        .select('ts')
        .order('ts', { ascending: true })
        .limit(1);

    if (oldest && oldest[0]) {
        console.log(`Oldest Odds Record: ${new Date(oldest[0].ts).toLocaleString()}`);
    } else {
        console.log('No market history found.');
    }

    // 2. Check for Scores in Matches
    const { data: matchSample } = await supabase
        .from('matches')
        .select('id, home_team, home_score, away_team, away_score, status')
        .not('home_score', 'is', null) // Try to find one with scores
        .limit(1);

    if (matchSample && matchSample.length > 0) {
        console.log('✅ Found match with scores:');
        console.log(matchSample[0]);
    } else {
        console.log('⚠️ No matches with scores found via explicit check. Checking schema...');
        // Just pull any match to see raw columns
        const { data: anyMatch } = await supabase.from('matches').select('*').limit(1);
        if (anyMatch) console.log('Sample Match Keys:', Object.keys(anyMatch[0]));
    }
}

checkDataDepth();
