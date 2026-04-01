// scripts/fix_away_pick_grades.ts
// Purpose: Fix incorrectly graded AWAY picks that have unsigned spreads

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qffzvrnbzabcokqqrwbv.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function fixAwayPickGrades() {
    console.log("🔧 Starting AWAY pick grade correction...\n");

    // 1. Find all AWAY SPREAD picks with positive analyzed_spread (unsigned)
    const { data: picks, error } = await supabase
        .from('pregame_intel')
        .select('intel_id, match_id, home_team, away_team, recommended_pick, analyzed_spread, actual_home_score, actual_away_score, pick_result, grading_metadata')
        .eq('grading_metadata->>side', 'AWAY')
        .eq('grading_metadata->>type', 'SPREAD')
        .gt('analyzed_spread', 0) // Unsigned (positive) = needs fixing
        .not('actual_home_score', 'is', null)
        .in('pick_result', ['WIN', 'LOSS', 'PUSH']);

    if (error) {
        console.error("❌ Query error:", error.message);
        return;
    }

    if (!picks || picks.length === 0) {
        console.log("✅ No bad records found. All AWAY picks already have correct signs.");
        return;
    }

    console.log(`📊 Found ${picks.length} AWAY picks with unsigned spreads:\n`);

    let fixed = 0;
    for (const pick of picks) {
        const awayMargin = pick.actual_away_score - pick.actual_home_score;
        const signedSpread = -pick.analyzed_spread; // Fix: negate for AWAY
        const coverMargin = awayMargin + signedSpread;

        let correctResult: string;
        if (coverMargin > 0) correctResult = 'WIN';
        else if (coverMargin < 0) correctResult = 'LOSS';
        else correctResult = 'PUSH';

        const needsUpdate = pick.pick_result !== correctResult;

        console.log(`${pick.match_id}: ${pick.away_team} @ ${pick.home_team}`);
        console.log(`  Score: ${pick.actual_away_score}-${pick.actual_home_score} (Away margin: ${awayMargin})`);
        console.log(`  Spread: ${pick.analyzed_spread} → ${signedSpread} (signed)`);
        console.log(`  Cover: ${coverMargin.toFixed(1)}`);
        console.log(`  Result: ${pick.pick_result} → ${correctResult} ${needsUpdate ? '⚠️ NEEDS FIX' : '✓'}\n`);

        if (needsUpdate) {
            const { error: updateErr } = await supabase
                .from('pregame_intel')
                .update({
                    pick_result: correctResult,
                    analyzed_spread: signedSpread
                })
                .eq('intel_id', pick.intel_id);

            if (updateErr) {
                console.error(`  ❌ Update failed: ${updateErr.message}`);
            } else {
                console.log(`  ✅ Fixed: ${pick.pick_result} → ${correctResult}`);
                fixed++;
            }
        }
    }

    console.log(`\n🎉 Done! Fixed ${fixed} out of ${picks.length} records.`);
}

fixAwayPickGrades();
