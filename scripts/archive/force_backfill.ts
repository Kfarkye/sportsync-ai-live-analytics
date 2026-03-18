
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';

// Try to load .env manually if dotenv doesn't find it in the current CWD
const envData = fs.readFileSync('.env', 'utf8');
const env: Record<string, string> = {};
envData.split('\n').forEach(line => {
    const [key, ...value] = line.split('=');
    if (key && value) {
        env[key.trim()] = value.join('=').trim();
    }
});

const SUPABASE_URL = env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("❌ ERROR: Missing credentials in .env");
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function main() {
    console.log("🚀 Manually Triggering Capture Flow for Serie A...");

    // We'll try to reach the edge function directly
    const url = `${SUPABASE_URL}/functions/v1/capture-opening-lines`;

    console.log(`🔗 Target: ${url}`);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                'apikey': SUPABASE_SERVICE_ROLE_KEY
            },
            body: JSON.stringify({ league: 'ita.1' })
        });

        const text = await response.text();
        console.log("📥 Raw Response:", text);

        try {
            const result = JSON.parse(text);
            console.log("✅ Parsed Capture Result:", JSON.stringify(result, null, 2));

            if (result.matches_upserted > 0 || result.scanned > 0) {
                console.log(`\n🎉 Success! Scanned ${result.scanned} events, upserted ${result.matches_upserted} matches.`);

                // Now trigger research
                console.log("🤖 Triggering research cron...");
                const cronUrl = `${SUPABASE_URL}/functions/v1/pregame-intel-cron`;
                const cronRes = await fetch(cronUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                        'apikey': SUPABASE_SERVICE_ROLE_KEY
                    },
                    body: JSON.stringify({ force: true })
                });
                const cronText = await cronRes.text();
                console.log("✅ Research Response:", cronText);
            }
        } catch (e) {
            console.error("❌ Failed to parse JSON response:", e);
        }
    } catch (err) {
        console.error("❌ Fatal Error during fetch:", err);
    }
}

main();
