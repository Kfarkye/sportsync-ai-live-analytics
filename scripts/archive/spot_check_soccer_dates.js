// scripts/spot_check_soccer_dates.js
// Spot-check soccer grades for specific dates: 1/21 and 1/23

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qffzvrnbzabcokqqrwbv.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

function gradeSpreadPick(pick, homeScore, awayScore) {
    const meta = pick.grading_metadata || {};
    const spread = pick.analyzed_spread ?? 0;
    const side = (meta.side || '').toUpperCase();

    // FIXED: Proper spread calculation
    // For AWAY -1: Away needs to win by MORE than 1 to cover
    // For HOME -1: Home needs to win by MORE than 1 to cover
    let coverMargin;

    if (side === 'AWAY') {
        // Away margin = awayScore - homeScore
        // For away -1 spread: coverMargin = (awayScore - homeScore) - 1
        // If away wins by exactly 1: coverMargin = 0 = PUSH
        const awayMargin = awayScore - homeScore;
        coverMargin = awayMargin + spread; // spread is typically stored negative for favorite
    } else {
        // Home margin = homeScore - awayScore
        const homeMargin = homeScore - awayScore;
        coverMargin = homeMargin + spread;
    }

    let expected;
    if (coverMargin > 0) expected = 'WIN';
    else if (coverMargin < 0) expected = 'LOSS';
    else expected = 'PUSH';

    return {
        expected,
        coverMargin,
        reason: `${side} | Score: ${awayScore}-${homeScore} | Spread: ${spread} | Cover: ${coverMargin.toFixed(1)}`
    };
}

function gradeTotalPick(pick, homeScore, awayScore) {
    const meta = pick.grading_metadata || {};
    const total = pick.analyzed_total ?? 0;
    const direction = (meta.direction || '').toUpperCase();
    const actualTotal = homeScore + awayScore;

    let margin;
    let expected;

    if (direction === 'OVER') {
        margin = actualTotal - total;
        if (margin > 0) expected = 'WIN';
        else if (margin < 0) expected = 'LOSS';
        else expected = 'PUSH';
    } else {
        margin = total - actualTotal;
        if (margin > 0) expected = 'WIN';
        else if (margin < 0) expected = 'LOSS';
        else expected = 'PUSH';
    }

    return {
        expected,
        totalMargin: margin,
        reason: `${direction} ${total} | Actual: ${actualTotal} | Margin: ${margin.toFixed(1)}`
    };
}

function gradeMoneylinePick(pick, homeScore, awayScore) {
    const meta = pick.grading_metadata || {};
    const side = (meta.side || '').toUpperCase();

    let expected;

    if (side === 'AWAY') {
        if (awayScore > homeScore) expected = 'WIN';
        else if (awayScore < homeScore) expected = 'LOSS';
        else expected = 'PUSH';
    } else if (side === 'DRAW') {
        if (homeScore === awayScore) expected = 'WIN';
        else expected = 'LOSS';
    } else {
        if (homeScore > awayScore) expected = 'WIN';
        else if (homeScore < awayScore) expected = 'LOSS';
        else expected = 'PUSH';
    }

    return {
        expected,
        reason: `${side} ML | Score: ${awayScore}-${homeScore}`
    };
}

function processResults(picks, dateLabel) {
    console.log(`\n📊 ${dateLabel}: Found ${picks.length} graded soccer picks\n`);
    console.log("-".repeat(80) + "\n");

    let correct = 0;
    let incorrect = 0;
    const errors = [];

    for (const pick of picks) {
        const meta = pick.grading_metadata || {};
        const pickType = (meta.type || 'UNKNOWN').toUpperCase();
        const homeScore = pick.actual_home_score;
        const awayScore = pick.actual_away_score;

        let result;

        if (pickType === 'SPREAD') {
            const { expected, reason } = gradeSpreadPick(pick, homeScore, awayScore);
            result = { expected, reason };
        } else if (pickType === 'TOTAL') {
            const { expected, reason } = gradeTotalPick(pick, homeScore, awayScore);
            result = { expected, reason };
        } else if (pickType === 'MONEYLINE' || pickType === 'ML') {
            result = gradeMoneylinePick(pick, homeScore, awayScore);
        } else {
            result = { expected: 'UNKNOWN', reason: `Unknown type: ${pickType}` };
        }

        const isCorrect = pick.pick_result === result.expected;
        const icon = isCorrect ? '✅' : '❌';

        console.log(`${icon} ${pick.match_id}`);
        console.log(`   ${pick.away_team} @ ${pick.home_team}`);
        console.log(`   League: ${pick.league_id} | Pick: ${pick.recommended_pick}`);
        console.log(`   ${result.reason}`);
        console.log(`   Recorded: ${pick.pick_result} | Calculated: ${result.expected}`);
        console.log("");

        if (isCorrect) {
            correct++;
        } else {
            incorrect++;
            errors.push({ pick, expected: result.expected, reason: result.reason });
        }
    }

    return { correct, incorrect, errors, total: picks.length };
}

async function spotCheckDates() {
    console.log("⚽ SOCCER GRADING SPOT-CHECK - Specific Dates\n");
    console.log("=".repeat(80));

    const dates = ['2026-01-21', '2026-01-23'];
    let totalCorrect = 0;
    let totalIncorrect = 0;
    const allErrors = [];

    for (const date of dates) {
        console.log(`\n📅 Checking: ${date}`);

        const { data: picks, error } = await supabase
            .from('pregame_intel')
            .select('intel_id, match_id, home_team, away_team, sport, league_id, recommended_pick, analyzed_spread, analyzed_total, actual_home_score, actual_away_score, pick_result, grading_metadata, game_date')
            .or('sport.ilike.%soccer%,league_id.ilike.%eng%,league_id.ilike.%esp%,league_id.ilike.%uefa%,league_id.ilike.%usa.1%,league_id.ilike.%mex%,league_id.ilike.%ger%,league_id.ilike.%ita%,league_id.ilike.%fra%,league_id.ilike.%caf%')
            .eq('game_date', date)
            .not('actual_home_score', 'is', null)
            .in('pick_result', ['WIN', 'LOSS', 'PUSH'])
            .order('league_id', { ascending: true });

        if (error) {
            console.error(`❌ Query error for ${date}:`, error.message);
            continue;
        }

        if (!picks || picks.length === 0) {
            console.log(`   ⚠️ No graded soccer picks found for ${date}`);
            continue;
        }

        const { correct, incorrect, errors } = processResults(picks, date);
        totalCorrect += correct;
        totalIncorrect += incorrect;
        allErrors.push(...errors);
    }

    console.log("=".repeat(80));
    console.log("\n📊 COMBINED SUMMARY\n");
    const total = totalCorrect + totalIncorrect;
    console.log(`   Total Checked: ${total}`);
    console.log(`   ✅ Correct: ${totalCorrect} (${total > 0 ? ((totalCorrect / total) * 100).toFixed(1) : 0}%)`);
    console.log(`   ❌ Incorrect: ${totalIncorrect} (${total > 0 ? ((totalIncorrect / total) * 100).toFixed(1) : 0}%)`);

    if (allErrors.length > 0) {
        console.log("\n⚠️  GRADING ERRORS DETECTED:\n");
        for (const err of allErrors) {
            console.log(`   ${err.pick.match_id} (${err.pick.game_date}):`);
            console.log(`      ${err.pick.away_team} @ ${err.pick.home_team}`);
            console.log(`      Recorded: ${err.pick.pick_result} → Should be: ${err.expected}`);
            console.log(`      ${err.reason}\n`);
        }
    } else {
        console.log("\n🎉 All grades verified correct!\n");
    }
}

spotCheckDates();
