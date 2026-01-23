import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Manual Env Load
try {
    const envPath = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
        const envConfig = fs.readFileSync(envPath, 'utf-8');
        envConfig.split('\n').forEach(line => {
            const [key, ...values] = line.split('=');
            if (key && values.length > 0) {
                const val = values.join('=').trim().replace(/^["']|["']$/g, '');
                if (!process.env[key.trim()]) process.env[key.trim()] = val;
            }
        });
    }
} catch (e) {
    console.error("Error loading .env manually", e);
}

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!url || !key) {
    console.error("Missing Credentials. Check .env");
    process.exit(1);
}

const supabase = createClient(url, key, {
    auth: { persistSession: false },
    db: { schema: 'public' }
});

const TARGET_DATE = '2026-01-20'; // Yesterday

async function main() {
    console.log(`Connecting to ${url.substring(0, 15)}...`);

    // 1. Fetch Matches for Context
    const start = `${TARGET_DATE}T00:00:00`;
    const end = `${TARGET_DATE}T23:59:59`;

    const { data: matches, error: matchError } = await supabase.from('matches')
        .select(`
            id, home_team, away_team, home_score, away_score, status, start_time,
            sport, league_id
        `)
        .gte('start_time', start).lte('start_time', end);

    if (matchError) {
        console.error(`Match Error: ${matchError.message}`);
        return;
    }

    const matchMap = new Map();
    matches?.forEach(m => matchMap.set(m.id, m));

    console.log(`\n=== RECAP FOR ${TARGET_DATE} (${matches?.length || 0} Games) ===`);

    // 2. Fetch High Confidence "Edge" Picks from Pregame Intel
    // adaptive_intel_tracking added confidence_score (int)
    const { data: edgePicks, error: edgeError } = await supabase.from('pregame_intel')
        .select('match_id, confidence_score, recommended_pick')
        .in('match_id', Array.from(matchMap.keys()))
        .order('confidence_score', { ascending: false, nullsFirst: false })
        .limit(10);

    // Diagnostic: Check if ANY have confidence
    const { count } = await supabase.from('pregame_intel')
        .select('*', { count: 'exact', head: true })
        .in('match_id', Array.from(matchMap.keys()))
        .not('confidence_score', 'is', null);

    console.log(`Diagnostic: ${count} rows have non-null confidence scores.`);

    if (edgeError) console.error("Edge Intel Error:", edgeError.message);

    if (edgePicks && edgePicks.length > 0) {
        console.log(`\n--- TOP EDGE PICKS (Highest Confidence) ---`);

        for (const pick of edgePicks) {
            const m = matchMap.get(pick.match_id);
            if (!m) continue;

            // Determine Pick Text
            const pText = pick.recommended_pick || "See Summary";

            // Clean names
            let h = m.home_team;
            let a = m.away_team;
            if (typeof h === 'object') h = h.name || "Home";
            if (typeof a === 'object') a = a.name || "Away";

            // Determine Result
            let result = "PENDING";
            if (m.status === 'STATUS_FINAL' || m.status === 'FINISHED') {
                result = "FINAL"; // Simplified, ideally we parse the pick vs score
            }

            console.log(`[Confidence: ${pick.confidence_score || 'N/A'}] ${h} vs ${a}`);
            console.log(`   Pick: ${pText}`);
            console.log(`   Result: ${a} ${m.away_score} - ${h} ${m.home_score} (${m.status})`);
        }
    } else {
        console.log("\nNo high confidence 'Edge' picks found in pregame_intel.");
    }

    // 3. Fetch "Sharp" Intel (if any)
    const { data: sharpPicks, error: sharpError } = await supabase.from('sharp_intel')
        .select('*')
        .in('match_id', Array.from(matchMap.keys()));

    if (sharpError) {
        // Table might not exist yet or be empty
        // console.error("Sharp Intel Error:", sharpError.message);
    } else if (sharpPicks && sharpPicks.length > 0) {
        console.log(`\n--- SHARP INTEL PICKS ---`);
        for (const s of sharpPicks) {
            const m = matchMap.get(s.match_id);
            console.log(`[${s.ai_confidence}] ${s.pick_type} ${s.pick_side} (${s.pick_odds})`);
            if (m) {
                let h = m.home_team;
                let a = m.away_team;
                if (typeof h === 'object') h = h.name || "Home";
                if (typeof a === 'object') a = a.name || "Away";
                console.log(`   Match: ${h} vs ${a}`);
                console.log(`   Result: ${a} ${m.away_score} - ${h} ${m.home_score}`);
            }
        }
    }
}

main();
