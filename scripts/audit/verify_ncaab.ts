
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const envData = fs.readFileSync('.env', 'utf8');
const env: Record<string, string> = {};
envData.split('\n').forEach(line => {
    const [key, ...value] = line.split('=');
    if (key && value) {
        env[key.trim()] = value.join('=').trim();
    }
});

const SUPABASE_URL = env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function verify() {
    console.log("Verifying NCAAB ingestion...");
    const { count, error } = await supabase
        .from('matches')
        .select('*', { count: 'exact', head: true })
        .eq('league_id', 'mens-college-basketball')
        .gte('start_time', '2026-01-08')
        .lt('start_time', '2026-01-09');

    if (error) {
        console.error("Error:", error);
    } else {
        console.log(`✅ Found ${count} NCAAB games for today.`);
    }
}

verify();
