
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

// CONFIG mirror from index.ts
const CONFIG = {
    LOOKAHEAD_HOURS: 48,
    FETCH_LIMIT: 50,
    BATCH_SIZE: 6,
    TIMEOUT_MS: 150_000,
    STALE_HOURS: 12,
};

function getCanonicalMatchId(id: string, league: string) {
    if (!id || !league) return id;
    // Mirror of match-registry.ts logic (simplified for simulation)
    // Assuming standard format here. Real function might be more complex.
    // For now we assume if id has underscore, it's likely canonical or close enough for simulation
    return id;
}

async function simulateCron() {
    console.log("--- SIMULATING CRON LOGIC ---");

    // 1. Audit Environment
    const envContent = fs.readFileSync('.env', 'utf8');
    const env: any = {};
    envContent.split('\n').forEach(line => {
        const [key, ...value] = line.split('=');
        if (key && value) env[key.trim()] = value.join('=').trim().replace(/"/g, '').replace(/'/g, '');
    });

    const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_SERVICE_ROLE_KEY;
    const SUPABASE_URL = env.VITE_SUPABASE_URL || env.SUPABASE_URL;

    if (!SUPABASE_URL || !SERVICE_KEY) {
        console.error('❌ Missing Keys');
        return;
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const now = new Date();
    const windowEnd = new Date(now.getTime() + CONFIG.LOOKAHEAD_HOURS * 60 * 60 * 1000);

    console.log(`Time: ${now.toISOString()}`);
    console.log(`Window: Now -> ${windowEnd.toISOString()} (${CONFIG.LOOKAHEAD_HOURS}h)`);

    // 2. Fetch Slate
    const { data: slate, error: slateErr } = await supabase
        .from("matches")
        .select("id, home_team, away_team, start_time, sport, league_id")
        .gte("start_time", now.toISOString())
        .lt("start_time", windowEnd.toISOString())
        .order("start_time", { ascending: true })
        .limit(CONFIG.FETCH_LIMIT);

    if (slateErr) {
        console.error("Slate Error:", slateErr);
        return;
    }

    console.log(`Found ${slate?.length || 0} matches in window.`);

    if (!slate || slate.length === 0) return;

    // 3. Check Existing Intel
    const { data: existingIntel, error: intelErr } = await supabase
        .from("pregame_intel")
        .select("match_id, generated_at, freshness")
        .in("match_id", slate.map(s => s.id))
        .order("generated_at", { ascending: true });

    const intelMap = new Map((existingIntel as any[])?.map(i => [i.match_id, i]));
    console.log(`Cache Hit: ${existingIntel?.length || 0} existing reports.`);

    // 4. Calculate Priority
    const queue = slate.map(game => {
        const canonicalId = getCanonicalMatchId(game.id, game.league_id);
        const intel: any = intelMap.get(canonicalId); // Using match_id directly as canonical for now

        let priority = 0;
        const hoursToStart = (new Date(game.start_time).getTime() - Date.now()) / (1000 * 60 * 60);

        if (!intel) {
            priority = 100;
            console.log(`[${game.id}] NO INTEL -> Priority 100`);
        } else {
            const lastGen = intel?.generated_at;
            const ageHours = lastGen ? (Date.now() - new Date(lastGen).getTime()) / (1000 * 60 * 60) : 999;

            let staleThreshold = CONFIG.STALE_HOURS;
            if (hoursToStart < 4) staleThreshold = 1;
            else if (hoursToStart < 24) staleThreshold = 4;

            if (ageHours > staleThreshold) {
                priority = 50;
                console.log(`[${game.id}] STALE (${ageHours.toFixed(1)}h > ${staleThreshold}h) -> Priority 50`);
            } else {
                console.log(`[${game.id}] FRESH (${ageHours.toFixed(1)}h < ${staleThreshold}h) -> Priority 0 (SKIPPED)`);
            }
        }

        if (priority > 0) {
            priority += Math.max(0, 24 - hoursToStart);
        }
        return { game, priority };
    })
        .filter(q => q.priority > 0)
        .sort((a, b) => b.priority - a.priority);

    console.log(`\n--- FINAL QUEUE (${queue.length}) ---`);
    queue.slice(0, 5).forEach(q => {
        console.log(`- ${q.game.id}: Priority ${q.priority.toFixed(1)}`);
    });
}

simulateCron();
