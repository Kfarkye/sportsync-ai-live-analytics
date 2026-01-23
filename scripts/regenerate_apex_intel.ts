
import { createClient } from "@supabase/supabase-js";
import fs from 'fs';

// --- ENV SETUP ---
const envContent = fs.readFileSync('.env', 'utf8');
const env: any = {};
envContent.split('\n').forEach(line => {
    const [key, ...value] = line.split('=');
    if (key && value) env[key.trim()] = value.join('=').trim().replace(/"/g, '').replace(/'/g, '');
});

const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing environment variables.");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function regenerateApexIntel() {
    console.log("--- STARTING APEX REGENERATION FOR JAN 14 ---");

    // 1. Target specific games we know are active/pending for today
    // Based on previous inspection: Cavs @ Sixers (401810427_nba) is a key target.
    // We will also look for any other NBA games scheduled for today.

    // Hardcoded target based on user request "run the intel for the 14th games"
    // and the inspection findings.
    const targetIds = [
        '401810427_nba', // Cavs @ Sixers
        // Add others if found from query below
    ];

    // Query for other NBA games today
    const { data: matches, error: matchError } = await supabase
        .from('matches')
        .select('*')
        .eq('league', 'basketball_nba')
        .gte('date', '2026-01-14T00:00:00Z')
        .lt('date', '2026-01-15T00:00:00Z');

    if (matchError) {
        console.error("Match fetch error:", matchError);
    } else {
        console.log(`Found ${matches.length} NBA matches for today.`);
        matches.forEach(m => {
            if (!targetIds.includes(m.match_id)) targetIds.push(m.match_id);
        });
    }

    console.log(`Broadcasting Intel Regeneration for: ${targetIds.join(', ')}`);

    for (const matchId of targetIds) {
        console.log(`\nTriggering Apex Engine for: ${matchId}`);
        // Call the Edge Function directly via Supabase Invoke
        const { data, error } = await supabase.functions.invoke('pregame-intel', {
            body: { matchId }
        });

        if (error) {
            console.error(`❌ Failed for ${matchId}:`, error);
        } else {
            console.log(`✅ Success for ${matchId}:`, data?.headline || 'Intel Generated');
            if (data?.recommended_pick) console.log(`   Pick: ${data.recommended_pick}`);
            if (data?.logic_authority) console.log(`   Authority: ${data.logic_authority}`);
        }
    }
}

regenerateApexIntel();
