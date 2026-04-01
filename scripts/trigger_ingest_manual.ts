
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

// Load env
const envContent = fs.readFileSync('.env', 'utf8');
const env: any = {};
envContent.split('\n').forEach(line => {
    const [key, ...value] = line.split('=');
    if (key && value) env[key.trim()] = value.join('=').trim().replace(/"/g, '').replace(/'/g, '');
});

const SUPABASE_URL = env.VITE_SUPABASE_URL;
const CRON_SECRET = env.CRON_SECRET;

if (!SUPABASE_URL || !CRON_SECRET) {
    console.error('Missing URL or CRON_SECRET');
    process.exit(1);
}

// Function Endpoint
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/ingest-odds`;

(async () => {
    console.log(`🚀 Triggering Ingest: ${FUNCTION_URL}`);

    try {
        const res = await fetch(FUNCTION_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-cron-secret': CRON_SECRET
            },
            body: JSON.stringify({
                sport_key: 'basketball_nba' // Test with NBA
            })
        });

        if (!res.ok) {
            console.error(`❌ HTTP Error: ${res.status} ${res.statusText}`);
            console.error(await res.text());
        } else {
            const data = await res.json();
            console.log('✅ SUCCESS:', JSON.stringify(data, null, 2));
        }

    } catch (e) {
        console.error('❌ Network Error:', e);
    }
})();
