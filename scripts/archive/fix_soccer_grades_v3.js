// scripts/fix_soccer_grades_v3.js
// Fix misgraded soccer picks using v3 grading logic (parse spread from pick text)

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qffzvrnbzabcokqqrwbv.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

const DRY_RUN = !process.argv.includes('--fix');

function gradeSpreadV3(pick, homeScore, awayScore) {
    const meta = pick.grading_metadata || {};
    const pickText = pick.recommended_pick || '';
    const side = (meta.side || '').toUpperCase();

    // Parse spread from pick text, filtering out American odds
    let pickedTeamSpread = null;

    // Match all signed numbers in the text
    const matches = pickText.match(/([+-]?\d+\.?\d*)/g);
    if (matches) {
        // Filter out American odds (abs > 30) and pick the best candidate
        const candidates = matches
            .map(m => parseFloat(m))
            .filter(n => !isNaN(n) && Math.abs(n) <= 30); // Excludes -110, +105, etc.

        if (candidates.length > 0) {
            // Prefer quarter/half lines (0.25, 0.5, 0.75) over integers
            const scored = candidates.map(n => {
                const frac = Math.abs(n) % 1;
                const isQuarter = Math.abs(frac - 0.25) < 0.01 || Math.abs(frac - 0.75) < 0.01;
                const isHalf = Math.abs(frac - 0.5) < 0.01;
                return { value: n, score: isQuarter ? 3 : isHalf ? 2 : 1 };
            });
            scored.sort((a, b) => b.score - a.score);
            pickedTeamSpread = scored[0].value;
        }
    }

    // Fallback to analyzed_spread (but filter out American odds)
    if (pickedTeamSpread === null && pick.analyzed_spread !== null && Math.abs(pick.analyzed_spread) <= 30) {
        if (side === 'HOME') {
            pickedTeamSpread = pick.analyzed_spread;
        } else {
            const textHasNegative = pickText.includes('-');
            const storedIsNegative = pick.analyzed_spread < 0;
            if (textHasNegative === storedIsNegative) {
                pickedTeamSpread = pick.analyzed_spread;
            } else {
                pickedTeamSpread = -pick.analyzed_spread;
            }
        }
    }

    if (pickedTeamSpread === null) {
        // Check if this looks like a moneyline that was mislabeled as spread
        if (/\bML\b/i.test(pickText) || /moneyline/i.test(pickText)) {
            return { expected: 'NO_PICK', reason: 'Moneyline mislabeled as spread', coverMargin: 0 };
        }
        // Also filter out analyzed_spread values that look like American odds
        if (pick.analyzed_spread !== null && Math.abs(pick.analyzed_spread) > 30) {
            return { expected: 'NO_PICK', reason: 'Spread looks like American odds', coverMargin: 0 };
        }
        return { expected: 'NO_PICK', reason: 'No spread found', coverMargin: 0 };
    }

    const pickedTeamMargin = side === 'HOME'
        ? homeScore - awayScore
        : awayScore - homeScore;

    const coverMargin = pickedTeamMargin + pickedTeamSpread;

    let expected;
    if (coverMargin > 0) expected = 'WIN';
    else if (coverMargin < 0) expected = 'LOSS';
    else expected = 'PUSH';

    return {
        expected,
        coverMargin,
        pickedTeamSpread,
        pickedTeamMargin,
        reason: `${side} | Margin: ${pickedTeamMargin} + Spread: ${pickedTeamSpread} = Cover: ${coverMargin.toFixed(2)}`
    };
}

async function fixSoccerGrades() {
    console.log("⚽ SOCCER GRADING FIX (v3 Logic)\n");
    console.log("=".repeat(80));
    console.log(`Mode: ${DRY_RUN ? '🔍 DRY RUN (add --fix to apply)' : '🔧 FIX MODE'}\n`);

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

    console.log(`📊 Total graded soccer picks: ${picks?.length || 0}\n`);

    const errors = [];
    let spreadCount = 0;

    for (const pick of picks) {
        const meta = pick.grading_metadata || {};
        const pickType = (meta.type || '').toUpperCase();

        if (pickType !== 'SPREAD') continue;
        spreadCount++;

        const homeScore = pick.actual_home_score;
        const awayScore = pick.actual_away_score;

        const result = gradeSpreadV3(pick, homeScore, awayScore);

        if (pick.pick_result !== result.expected && result.expected !== 'NO_PICK') {
            errors.push({
                pick,
                ...result
            });
        }
    }

    console.log(`📋 Spread picks checked: ${spreadCount}`);
    console.log(`❌ Misgraded picks found: ${errors.length}\n`);

    if (errors.length === 0) {
        console.log("🎉 All soccer spread picks are correctly graded!\n");
        return;
    }

    console.log("=".repeat(80));
    console.log("\n⚠️  MISGRADED PICKS (v3 analysis):\n");

    for (const err of errors) {
        const { pick, expected, reason } = err;
        console.log(`❌ ${pick.match_id} (${pick.game_date})`);
        console.log(`   ${pick.away_team} @ ${pick.home_team}`);
        console.log(`   Pick: "${pick.recommended_pick}"`);
        console.log(`   ${reason}`);
        console.log(`   Recorded: ${pick.pick_result} → Should be: ${expected}\n`);
    }

    if (!DRY_RUN) {
        console.log("=".repeat(80));
        console.log("\n🔧 APPLYING FIXES...\n");

        let fixed = 0;
        for (const err of errors) {
            const { error: updateErr } = await supabase
                .from('pregame_intel')
                .update({ pick_result: err.expected })
                .eq('intel_id', err.pick.intel_id);

            if (updateErr) {
                console.error(`   ❌ Failed: ${err.pick.match_id}`);
            } else {
                console.log(`   ✅ Fixed ${err.pick.match_id}: ${err.pick.pick_result} → ${err.expected}`);
                fixed++;
            }
        }
        console.log(`\n🎉 Fixed ${fixed}/${errors.length} records.\n`);
    } else {
        console.log("=".repeat(80));
        console.log("\n💡 Run with --fix to apply corrections:\n");
        console.log(`   node scripts/fix_soccer_grades_v3.js --fix\n`);
    }
}

fixSoccerGrades();
