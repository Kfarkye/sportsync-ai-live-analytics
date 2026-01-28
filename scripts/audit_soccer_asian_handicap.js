// scripts/audit_soccer_asian_handicap.js
// Find and fix ALL misgraded soccer Asian handicap (fractional spread) picks

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qffzvrnbzabcokqqrwbv.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

const DRY_RUN = process.argv.includes('--dry-run') || !process.argv.includes('--fix');

function gradeSpreadPick(awayScore, homeScore, spread, side) {
    let coverMargin;

    if (side === 'AWAY') {
        // Away margin = awayScore - homeScore
        // spread is stored as the handicap (negative = favorite, positive = underdog)
        const awayMargin = awayScore - homeScore;
        coverMargin = awayMargin + spread;
    } else {
        // Home margin = homeScore - awayScore
        const homeMargin = homeScore - awayScore;
        coverMargin = homeMargin + spread;
    }

    let expected;
    if (coverMargin > 0) expected = 'WIN';
    else if (coverMargin < 0) expected = 'LOSS';
    else expected = 'PUSH';

    return { expected, coverMargin };
}

async function auditAllSoccerGrades() {
    console.log("⚽ SOCCER ASIAN HANDICAP GRADING AUDIT\n");
    console.log("=".repeat(80));
    console.log(`Mode: ${DRY_RUN ? '🔍 DRY RUN (add --fix to apply changes)' : '🔧 FIX MODE'}\n`);

    // Get ALL graded soccer SPREAD picks
    const { data: picks, error } = await supabase
        .from('pregame_intel')
        .select('intel_id, match_id, home_team, away_team, league_id, recommended_pick, analyzed_spread, actual_home_score, actual_away_score, pick_result, grading_metadata, game_date')
        .or('sport.ilike.%soccer%,league_id.ilike.%eng%,league_id.ilike.%esp%,league_id.ilike.%uefa%,league_id.ilike.%usa.1%,league_id.ilike.%mex%,league_id.ilike.%ger%,league_id.ilike.%ita%,league_id.ilike.%fra%,league_id.ilike.%caf%')
        .not('actual_home_score', 'is', null)
        .in('pick_result', ['WIN', 'LOSS', 'PUSH'])
        .order('game_date', { ascending: false });

    if (error) {
        console.error("❌ Query error:", error.message);
        return;
    }

    console.log(`📊 Total graded soccer picks found: ${picks?.length || 0}\n`);

    if (!picks || picks.length === 0) {
        console.log("No picks to audit.");
        return;
    }

    const errors = [];
    let checkedCount = 0;
    let spreadCount = 0;

    for (const pick of picks) {
        const meta = pick.grading_metadata || {};
        const pickType = (meta.type || '').toUpperCase();

        // Only audit SPREAD picks
        if (pickType !== 'SPREAD') continue;

        spreadCount++;
        const side = (meta.side || '').toUpperCase();
        const spread = pick.analyzed_spread ?? 0;
        const homeScore = pick.actual_home_score;
        const awayScore = pick.actual_away_score;

        const { expected, coverMargin } = gradeSpreadPick(awayScore, homeScore, spread, side);
        checkedCount++;

        if (pick.pick_result !== expected) {
            errors.push({
                pick,
                expected,
                coverMargin,
                side,
                spread
            });
        }
    }

    console.log(`📋 Spread picks audited: ${spreadCount}`);
    console.log(`❌ Grading errors found: ${errors.length}\n`);

    if (errors.length === 0) {
        console.log("🎉 All soccer spread picks are correctly graded!\n");
        return;
    }

    console.log("=".repeat(80));
    console.log("\n⚠️  MISGRADED PICKS:\n");

    // Group by error type
    const wrongWins = errors.filter(e => e.pick.pick_result === 'WIN' && e.expected === 'LOSS');
    const wrongLosses = errors.filter(e => e.pick.pick_result === 'LOSS' && e.expected === 'WIN');
    const wrongPushes = errors.filter(e => e.pick.pick_result === 'PUSH' && e.expected !== 'PUSH');
    const shouldBePush = errors.filter(e => e.expected === 'PUSH' && e.pick.pick_result !== 'PUSH');

    console.log(`📊 Error Breakdown:`);
    console.log(`   WIN → LOSS: ${wrongWins.length}`);
    console.log(`   LOSS → WIN: ${wrongLosses.length}`);
    console.log(`   PUSH → WIN/LOSS: ${wrongPushes.length}`);
    console.log(`   WIN/LOSS → PUSH: ${shouldBePush.length}\n`);

    // Show all errors
    for (const err of errors) {
        const { pick, expected, coverMargin, side, spread } = err;
        console.log(`❌ ${pick.match_id} (${pick.game_date})`);
        console.log(`   ${pick.away_team} @ ${pick.home_team}`);
        console.log(`   League: ${pick.league_id}`);
        console.log(`   Pick: ${pick.recommended_pick}`);
        console.log(`   ${side} | Score: ${pick.actual_away_score}-${pick.actual_home_score} | Spread: ${spread}`);
        console.log(`   Cover Margin: ${coverMargin.toFixed(2)}`);
        console.log(`   Recorded: ${pick.pick_result} → Should be: ${expected}\n`);
    }

    // Fix if not dry run
    if (!DRY_RUN) {
        console.log("=".repeat(80));
        console.log("\n🔧 APPLYING FIXES...\n");

        let fixed = 0;
        for (const err of errors) {
            const { data, error: updateErr } = await supabase
                .from('pregame_intel')
                .update({ pick_result: err.expected })
                .eq('intel_id', err.pick.intel_id)
                .select('match_id, pick_result');

            if (updateErr) {
                console.error(`   ❌ Failed to fix ${err.pick.match_id}: ${updateErr.message}`);
            } else {
                console.log(`   ✅ Fixed ${err.pick.match_id}: ${err.pick.pick_result} → ${err.expected}`);
                fixed++;
            }
        }

        console.log(`\n🎉 Fixed ${fixed}/${errors.length} records.\n`);
    } else {
        console.log("=".repeat(80));
        console.log("\n💡 To apply fixes, run with --fix flag:");
        console.log(`   node scripts/audit_soccer_asian_handicap.js --fix\n`);
    }
}

auditAllSoccerGrades();
