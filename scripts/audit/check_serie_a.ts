
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("❌ ERROR: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.");
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function main() {
    console.log("🔍 Auditing Serie A (ita.1) Coverage...");

    const now = new Date();
    const plus48h = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();

    // 1. Fetch upcoming Serie A matches
    const { data: matches, error: matchErr } = await supabase
        .from('matches')
        .select('id, home_team, away_team, start_time, league_id')
        .eq('league_id', 'ita.1')
        .gte('start_time', now.toISOString())
        .lt('start_time', plus48h)
        .order('start_time', { ascending: true });

    if (matchErr) {
        console.error("❌ Error fetching matches:", matchErr);
        return;
    }

    console.log(`📊 Found ${matches.length} upcoming Serie A matches in the next 48h.`);

    if (matches.length > 0) {
        for (const match of matches) {
            console.log(`\n👉 Match: ${match.away_team} @ ${match.home_team} (${match.id})`);
            console.log(`   Start Time: ${match.start_time}`);

            // 2. Check for Intelligence
            const bettingDate = new Date(new Date(match.start_time).getTime() - 6 * 60 * 60 * 1000).toISOString().split('T')[0];

            // Try both exact ID and potential legacy/canonical variants if underscore naming is inconsistent
            const { data: intel, error: intelErr } = await supabase
                .from('pregame_intel')
                .select('intel_id, generated_at, is_edge_of_day')
                .eq('match_id', match.id)
                .eq('game_date', bettingDate);

            if (intelErr) {
                console.error(`   ❌ Error fetching intel:`, intelErr);
                continue;
            }

            if (intel && intel.length > 0) {
                console.log(`   ✅ Intel Found: ${intel.length} record(s)`);
                console.log(`   Generated At: ${intel[0].generated_at}`);
                console.log(`   Edge of Day: ${intel[0].is_edge_of_day}`);
            } else {
                console.log(`   ⚠️  No Intel Found for this match ID and date (${bettingDate}).`);
            }
        }
    } else {
        // Broad search for any Serie A matches in the system
        console.log("\nSearching for ANY Serie A matches to see what's in the DB...");
        const { data: allIta } = await supabase
            .from('matches')
            .select('home_team, away_team, start_time, league_id')
            .eq('league_id', 'ita.1')
            .limit(5);

        if (allIta && allIta.length > 0) {
            console.log("Recent/Any Serie A matches found:");
            allIta.forEach(m => console.log(` - ${m.away_team} @ ${m.home_team} | ${m.start_time}`));
        } else {
            console.log("❌ No Serie A (ita.1) matches found in the system AT ALL.");
        }
    }
}

main();
