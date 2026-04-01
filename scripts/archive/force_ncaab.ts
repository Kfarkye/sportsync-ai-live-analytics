
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

const SUPABASE_URL = env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function main() {
    console.log("🚀 Manually Triggering Capture Flow for NCAAB...");

    const url = `${SUPABASE_URL}/functions/v1/capture-opening-lines`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                'apikey': SUPABASE_SERVICE_ROLE_KEY
            },
            // Note: The function currently iterates all leagues by default if no payload is specified,
            // but we can try to force it or just let it run for all.
            body: JSON.stringify({})
        });

        const text = await response.text();
        console.log("📥 Raw Response:", text);

        try {
            const result = JSON.parse(text);
            console.log("✅ Parsed Result:", JSON.stringify(result, null, 2));

            // Check matches table again after a short delay
            setTimeout(async () => {
                const { data: count } = await supabase
                    .from('matches')
                    .select('id', { count: 'exact', head: true })
                    .eq('league_id', 'ncaab')
                    .gte('start_time', '2026-01-08')
                    .lt('start_time', '2026-01-09');
                console.log(`\n📊 Current NCAAB matches for today: ${count?.length || 0}`);
            }, 5000);

        } catch (e) {
            console.error("❌ Failed to parse JSON:", e);
        }
    } catch (err) {
        console.error("❌ Fatal Error:", err);
    }
}

main();
