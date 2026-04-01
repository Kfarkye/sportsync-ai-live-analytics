
import { createClient } from '@supabase/supabase-js';
import { generateCanonicalGameId } from '../src/utils/matchRegistry.ts';
import fs from 'fs';
import path from 'path';

// Load ENV if possible, or expect them in process.env
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("❌ ERROR: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.");
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function main() {
    console.log("🚀 Starting Institutional Backfill: Canonical Identity Layer (Snap-in)...");

    const now = new Date();
    const lookback = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(); // -24h

    // 1. Fetch matches missing canonical IDs or recently active
    const { data: matches, error } = await supabase
        .from('matches')
        .select('*')
        .or('status.eq.STATUS_SCHEDULED,status.eq.STATUS_IN_PROGRESS,status.eq.STATUS_HALFTIME')
        .gt('start_time', lookback);

    if (error) {
        console.error("❌ Error fetching matches:", error);
        return;
    }

    console.log(`📊 Found ${matches.length} matches to audit/backfill...`);

    let successCount = 0;
    for (const match of matches) {
        try {
            // Generate Institutional True North ID
            const canonicalId = generateCanonicalGameId(
                match.home_team,
                match.away_team,
                match.start_time,
                match.league_id || match.sport || ''
            );

            if (!canonicalId) {
                console.warn(`⚠️  Skipping ${match.home_team} vs ${match.away_team}: Could not generate stable ID.`);
                continue;
            }

            // 1. Register Game in True North Registry
            const { error: kgError } = await supabase.from('canonical_games').upsert({
                id: canonicalId,
                league_id: match.league_id,
                sport: match.sport || 'unknown',
                home_team_name: match.home_team,
                away_team_name: match.away_team,
                commence_time: match.start_time,
                status: match.status
            });

            if (kgError) {
                console.error(`❌ [KG Error] ${canonicalId}:`, kgError.message);
                continue;
            }

            // 2. Register Cross-Provider Mapping (ESPN to True North)
            const { error: mapError } = await supabase.from('entity_mappings').upsert({
                canonical_id: canonicalId,
                provider: 'ESPN',
                external_id: match.id,
                discovery_method: 'institutional_backfill'
            }, { onConflict: 'provider,external_id' });

            if (mapError) {
                console.error(`❌ [Map Error] ${match.id} -> ${canonicalId}:`, mapError.message);
            }

            // 3. Update Match Record (Permanent Snap-in)
            const { error: updateError } = await supabase
                .from('matches')
                .update({ canonical_id: canonicalId })
                .eq('id', match.id);

            if (updateError) {
                console.error(`❌ [Update Error] ${match.id}:`, updateError.message);
            } else {
                console.log(`✅ Snapped-in: ${match.home_team} vs ${match.away_team} -> ${canonicalId}`);
                successCount++;
            }

        } catch (e) {
            console.error(`❌ [Exception] Processing ${match.id}:`, e);
        }
    }

    console.log(`\n🎉 Backfill Complete. ${successCount}/${matches.length} games updated.`);
    console.log("👉 Next: Redeploy your Edge Functions to start using standardized IDs and Anchored Odds.");
}

main();
