
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

async function testPregameIntel() {
    const match_id = '401808164';
    console.log(`Testing pregame-intel for ${match_id}...`);

    const { data, error } = await supabase.functions.invoke('pregame-intel', {
        body: {
            match_id: match_id,
            league: 'mens-college-basketball',
            sport: 'basketball',
            home_team: 'Ole Miss Rebels',
            away_team: 'Missouri Tigers'
        }
    });

    if (error) {
        console.error('❌ Error Name:', error.name);
        console.error('❌ Error Message:', error.message);
        if (error.context) {
            console.error('❌ Error Context:', JSON.stringify(error.context, null, 2));
        }
    } else {
        console.log('✅ Success:', JSON.stringify(data, null, 2));
    }
}

testPregameIntel();
