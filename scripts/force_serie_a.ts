
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("❌ ERROR: Missing credentials.");
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function main() {
    console.log("🚀 Manually Triggering Capture for Serie A...");

    // We invoke the Edge Function URL directly using a fresh fetch
    // to bypass any local environment issues
    const url = `${SUPABASE_URL}/functions/v1/capture-opening-lines`;

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

        const result = await response.json();
        console.log("✅ Capture Result:", JSON.stringify(result, null, 2));

        if (result.matches_upserted > 0) {
            console.log(`\n🎉 Success! ${result.matches_upserted} matches discovered.`);
            console.log("Triggering intelligence research now...");

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
            const cronResult = await cronRes.json();
            console.log("✅ Research Triggered:", JSON.stringify(cronResult, null, 2));
        }
    } catch (err) {
        console.error("❌ Fatal Error:", err);
    }
}

main();
