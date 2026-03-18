
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

async function inspectConstraints() {
    // 1. Audit Environment (Robust Detection)
    const envContent = fs.readFileSync('.env', 'utf8');
    const env: any = {};
    envContent.split('\n').forEach(line => {
        const [key, ...value] = line.split('=');
        if (key && value) env[key.trim()] = value.join('=').trim().replace(/"/g, '').replace(/'/g, '');
    });

    const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_SERVICE_ROLE_KEY;
    const SUPABASE_URL = env.VITE_SUPABASE_URL || env.SUPABASE_URL;

    if (!SUPABASE_URL || !SERVICE_KEY) {
        console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
        return;
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    console.log("--- INSPECTING CONSTRAINTS: pregame_intel ---");

    // Try to "upsert" a record that definitely duplicates an existing one, but catch the error
    // If onConflict fails, it usually throws a specific error
    // We will use the existing match ID we know exists: 401810419_nba

    const existingId = '401810419_nba';

    // First, verify what is currently there
    const { data: current } = await supabase.from('pregame_intel').select('match_id, game_date, headline').eq('match_id', existingId).single();
    if (current) {
        console.log("Current Record:", JSON.stringify(current, null, 2));
    } else {
        console.log("❌ Record 401810419_nba not found. Cannot test conflict.");
        return;
    }

    // Now try to UPSERT with a DIFFERENT headline, using the same keys
    const updatePayload = {
        ...current,
        headline: "DIAGNOSTIC UPDATE TEST " + Date.now(),
        generated_at: new Date().toISOString(),
        cards: [{ title: 'Diag', body: 'Constraint Satisfied', category: 'SYSTEM' }]
    };

    console.log("\nAttempting UPSERT on match_id, game_date...");
    const { data, error } = await supabase
        .from('pregame_intel')
        .upsert(updatePayload, { onConflict: 'match_id,game_date' })
        .select();

    if (error) {
        console.log("❌ UPSERT FAILED using 'match_id,game_date'");
        console.log("Error:", error);

        // Try alternate onConflict strategies if the first one failed
        console.log("\nAttempting UPSERT on JUST match_id...");
        const { error: err2 } = await supabase
            .from('pregame_intel')
            .upsert(updatePayload, { onConflict: 'match_id' })
            .select();

        if (err2) {
            console.log("❌ UPSERT FAILED using 'match_id'");
            console.log("Error:", err2);
        } else {
            console.log("✅ UPSERT SUCCEEDED using 'match_id' only!");
            console.log("This means the constraint is likely just on match_id, not composite.");
        }

    } else {
        console.log("✅ UPSERT SUCCEEDED using 'match_id,game_date'");
        console.log("Result:", JSON.stringify(data?.[0]?.headline));
    }
}

inspectConstraints();
