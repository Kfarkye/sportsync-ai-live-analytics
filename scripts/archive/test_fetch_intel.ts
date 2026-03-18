
import fs from 'fs';

const envContent = fs.readFileSync('.env', 'utf8');
const env: any = {};
envContent.split('\n').forEach(line => {
    const [key, ...value] = line.split('=');
    if (key && value) env[key.trim()] = value.join('=').trim().replace(/"/g, '').replace(/'/g, '');
});

const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_URL = env.VITE_SUPABASE_URL || env.SUPABASE_URL;

async function testFetch() {
    const match_id = '401808164';
    const url = `${SUPABASE_URL}/functions/v1/pregame-intel`;

    console.log(`Fetching ${url} for ${match_id}...`);

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SERVICE_KEY}`
        },
        body: JSON.stringify({
            match_id: match_id,
            league: 'mens-college-basketball',
            sport: 'basketball',
            home_team: 'Ole Miss Rebels',
            away_team: 'Missouri Tigers',
            trigger_source: 'cron'
        })
    });

    console.log('Status:', res.status);
    const text = await res.text();
    console.log('Body:', text);
}

testFetch();
