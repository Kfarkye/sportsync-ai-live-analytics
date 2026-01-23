
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

async function forceTrigger() {
    console.log('--- FORCE TRIGGERING NEW INTEL ---');

    // 1. Audit Environment (Robust Detection from sentinel test)
    const envContent = fs.readFileSync('.env', 'utf8');
    const env: any = {};
    envContent.split('\n').forEach(line => {
        const [key, ...value] = line.split('=');
        if (key && value) env[key.trim()] = value.join('=').trim().replace(/"/g, '').replace(/'/g, '');
    });

    const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.SERVICE_ROLE_KEY;
    const SUPABASE_URL = env.VITE_SUPABASE_URL || env.SUPABASE_URL;

    if (!SUPABASE_URL || !SERVICE_KEY) {
        console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
        return;
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // 2. Get an upcoming NBA match (Next one, skipping the one we just did)
    const { data: matches, error: fetchErr } = await supabase
        .from('matches')
        .select('*')
        .eq('league_id', 'nba')
        .neq('id', '401810419_nba') // Skip Suns vs Heat
        .gte('start_time', new Date().toISOString())
        .order('start_time', { ascending: true })
        .limit(1);

    if (fetchErr) {
        console.error("❌ Match fetch error:", fetchErr);
        return;
    }

    if (!matches || matches.length === 0) {
        console.log("❌ No upcoming NBA matches found.");
        return;
    }

    const match = matches[0];
    console.log(`Targeting Match: ${match.away_team} @ ${match.home_team} (${match.id})`);

    // 3. Invoke pregame-intel with force
    console.log("Invoking pregame-intel edge function...");
    const { data, error } = await supabase.functions.invoke('pregame-intel', {
        body: {
            match_id: match.id,
            home_team: match.home_team,
            away_team: match.away_team,
            league: match.league_id,
            sport: match.sport || 'basketball',
            trigger_source: "user", // "user" source skips cache fresh TTL
            force: true
        }
    });

    if (error) {
        console.error("❌ Function Invocation Error:", error);
    } else {
        console.log("✅ Function Response:", JSON.stringify(data, null, 2));
        console.log("\n--- VERIFICATION ---");

        const { data: verifyRow } = await supabase
            .from('pregame_intel')
            .select('match_id, generated_at, headline')
            .eq('match_id', (data as any).match_id || match.id)
            .order('generated_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (verifyRow) {
            console.log(`✅ VERIFIED: Found entry with generated_at: ${verifyRow.generated_at}`);
            console.log(`✅ Headline: ${verifyRow.headline}`);
        } else {
            console.log("❌ NOT VERIFIED: No entry found in database after invocation.");
        }
    }
}

forceTrigger();
