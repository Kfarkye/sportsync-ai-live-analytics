import { createClient } from "@supabase/supabase-js";
import * as fs from "node:fs";
import * as path from "node:path";

// Load environment
const loadEnv = () => {
    ['.env', '.env.local'].forEach(file => {
        const envPath = path.resolve(process.cwd(), file);
        if (fs.existsSync(envPath)) {
            const env = fs.readFileSync(envPath, 'utf8');
            env.split('\n').forEach(line => {
                const [key, ...valueParts] = line.split('=');
                if (key && valueParts.length > 0) {
                    process.env[key.trim()] = valueParts.join('=').trim();
                }
            });
        }
    });
};

loadEnv();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function auditIntel() {
    console.log("🚀 Auditing Institutional Intel Engine (Hybrid Persona)...");

    // 1. Find an upcoming NBA match
    const { data: matches, error: mError } = await supabase
        .from('matches')
        .select('id, home_team, away_team, start_time, league_id')
        .eq('league_id', 'nba')
        .gt('start_time', new Date().toISOString())
        .order('start_time', { ascending: true })
        .limit(1);

    if (mError || !matches?.length) {
        console.warn("⚠️ No upcoming NBA matches found. Using fallback match ID.");
    }

    const targetMatch = matches?.[0] || {
        id: "401704811",
        home_team: "Brooklyn Nets",
        away_team: "Golden State Warriors",
        league_id: "nba"
    };

    console.log(`📍 Targeting: ${targetMatch.away_team} @ ${targetMatch.home_team} (${targetMatch.id})`);

    // 2. Trigger Intel Redo (Force Refresh)
    const payload = {
        match_id: targetMatch.id,
        home_team: targetMatch.home_team,
        away_team: targetMatch.away_team,
        league: targetMatch.league_id,
        trigger_source: "user"
    };

    console.log("📥 Triggering Intelligence Generation...");
    const response = await fetch(`${SUPABASE_URL}/functions/v1/pregame-intel`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            'apikey': SUPABASE_SERVICE_ROLE_KEY
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const err = await response.text();
        console.error("❌ Intel Generation Failed:", response.status, err);
        return;
    }

    const intel = await response.json();
    console.log("\n📊 INTEL AUDIT RESULTS:");
    console.log("-----------------------------------------");
    console.log(`Headline: ${intel.headline}`);
    console.log(`Pick: ${intel.recommended_pick}`);
    console.log(`Logic Authority (Math Core): ${intel.logic_authority}`);
    console.log(`Briefing Snippet: ${intel.briefing.substring(0, 150)}...`);

    console.log("\n🔍 PERSONA & RIGOR CHECK:");
    const isBroadcastVoice = /mismatch|dislocation|execution|discipline|negible|structural|market/.test(intel.briefing.toLowerCase());
    const hasMathRigor = intel.logic_authority.toLowerCase().includes("apex") || intel.logic_authority.toLowerCase().includes("dislocation");
    const hasGradingMeta = !!intel.grading_metadata;

    console.log(`- Broadcast Voice Detected: ${isBroadcastVoice ? "✅ YES" : "❌ NO"}`);
    console.log(`- Math Rigor Detected: ${hasMathRigor ? "✅ YES" : "❌ NO"}`);
    console.log(`- Grading Metadata Present: ${hasGradingMeta ? "✅ YES" : "❌ NO"}`);

    if (intel.grading_metadata) {
        console.log(`  -> Side: ${intel.grading_metadata.side}, Type: ${intel.grading_metadata.type}, Selection: ${intel.grading_metadata.selection}`);
    }

    console.log("\n- Verdict:", (isBroadcastVoice && hasMathRigor && hasGradingMeta) ? "PASS (Production Ready)" : "FAIL (Refinement Needed)");
}

auditIntel().catch(console.error);
