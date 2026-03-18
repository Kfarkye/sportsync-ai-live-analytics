
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

// Load env
const envContent = fs.readFileSync('.env', 'utf8');
const env: any = {};
envContent.split('\n').forEach(line => {
    const [key, ...value] = line.split('=');
    if (key && value) env[key.trim()] = value.join('=').trim().replace(/"/g, '').replace(/'/g, '');
});

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY);

async function migrateLatePreGameTicks() {
    console.log('🔍 Scanning for "imposter" pre-game ticks (stamped after start time)...');

    // 1. Fetch matches active in the last 48 hours to limit scope
    const windowStart = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const { data: matches, error: mErr } = await supabase
        .from('matches')
        .select('id, start_time, home_team, away_team')
        .gte('start_time', windowStart);

    if (mErr || !matches || matches.length === 0) {
        console.log('Error fetching matches:', mErr);
        return;
    }

    console.log(`Checking ${matches.length} recent matches for data leaks...`);
    let fixedCount = 0;

    for (const match of matches) {
        if (!match.start_time) continue;

        const startTime = new Date(match.start_time).getTime();
        // Buffer: 5 mins after start time is strictly LIVE territory
        const strictLiveThreshold = new Date(startTime + 5 * 60 * 1000).toISOString();

        // 2. Find ticks marked as PRE-GAME (false) that happened AFTER the threshold
        const { data: badTicks, error: tErr } = await supabase
            .from('market_history')
            .select('id, ts, total_line')
            .eq('match_id', match.id)
            .eq('is_live', false)
            .gt('ts', strictLiveThreshold);

        if (badTicks && badTicks.length > 0) {
            console.log(`⚠️  Found ${badTicks.length} imposter ticks for ${match.home_team} vs ${match.away_team}`);

            // 3. Update them to is_live = true
            const idsToFix = badTicks.map(t => t.id);
            const { error: fixErr } = await supabase
                .from('market_history')
                .update({ is_live: true })
                .in('id', idsToFix);

            if (fixErr) {
                console.error(`Failed to fix records: ${fixErr.message}`);
            } else {
                console.log(`✅ Fixed ${badTicks.length} records.`);
                fixedCount += badTicks.length;
            }
        }
    }

    console.log(`\n🎉 DONE. Total historical records migrated to Live: ${fixedCount}`);
}

migrateLatePreGameTicks();
