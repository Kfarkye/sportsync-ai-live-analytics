
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

async function testUpsert() {
    console.log('--- TESTING UPSERT ON PREGAME_INTEL ---');

    // Attempting to update the '401814519_ncaab' record (existing from 16:11)
    const testDossier = {
        match_id: '401814519_ncaab',
        game_date: '2026-01-13',
        headline: 'RLS TEST AT ' + new Date().toISOString(),
        generated_at: new Date().toISOString(),
        home_team: 'EMU',
        away_team: 'KENT',
        sport: 'basketball',
        league_id: 'mens-college-basketball'
    };

    const { data, error } = await supabase
        .from('pregame_intel')
        .upsert(testDossier, { onConflict: 'match_id,game_date' })
        .select();

    if (error) {
        console.error('❌ Upsert FAILED:', error);
    } else {
        console.log('✅ Upsert SUCCEEDED:', data);
    }
}

testUpsert();
