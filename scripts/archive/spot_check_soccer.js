// scripts/spot_check_soccer.js
// Purpose: Spot-check 20 soccer games from the last week to verify grading accuracy

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qffzvrnbzabcokqqrwbv.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

function gradeSpreadPick(pick, homeScore, awayScore) {
    const meta = pick.grading_metadata || {};
    const spread = pick.analyzed_spread ?? 0;
    const side = (meta.side || '').toUpperCase();

    let coverMargin;
    let scoreDiff;

    if (side === 'AWAY') {
        scoreDiff = awayScore - homeScore;
        coverMargin = scoreDiff + Math.abs(spread);
    } else {
        scoreDiff = homeScore - awayScore;
        coverMargin = scoreDiff + spread;
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

function processResults(picks) {
    console.log(`📊 Found ${picks.length} graded soccer picks\n`);
    console.log("=".repeat(80) + "\n");

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
        console.log(`   ${pick.away_team} @ ${pick.home_team} | ${pick.game_date}`);
        console.log(`   League: ${pick.league_id}`);
        console.log(`   Pick: ${pick.recommended_pick}`);
        console.log(`   Type: ${pickType} | ${result.reason}`);
        console.log(`   Recorded: ${pick.pick_result} | Calculated: ${result.expected}`);
        console.log("");

        if (isCorrect) {
            correct++;
        } else {
            incorrect++;
            errors.push({ pick, expected: result.expected, reason: result.reason });
        }
    }

    console.log("=".repeat(80));
    console.log("\n📊 SUMMARY\n");
    console.log(`   Total Checked: ${picks.length}`);
    console.log(`   ✅ Correct: ${correct} (${((correct / picks.length) * 100).toFixed(1)}%)`);
    console.log(`   ❌ Incorrect: ${incorrect} (${((incorrect / picks.length) * 100).toFixed(1)}%)`);

    if (errors.length > 0) {
        console.log("\n⚠️  GRADING ERRORS DETECTED:\n");
        for (const err of errors) {
            console.log(`   ${err.pick.match_id}:`);
            console.log(`      ${err.pick.away_team} @ ${err.pick.home_team}`);
            console.log(`      Recorded: ${err.pick.pick_result} → Should be: ${err.expected}`);
            console.log(`      ${err.reason}\n`);
        }
    } else {
        console.log("\n🎉 All grades verified correct!\n");
    }
}

async function spotCheckSoccerGrades() {
    console.log("⚽ SOCCER GRADING SPOT-CHECK\n");
    console.log("=".repeat(80) + "\n");

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 7);

    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];

    console.log(`📅 Date Range: ${startStr} to ${endStr}\n`);

    // Try multiple sport identifiers for soccer
    const { data: picks, error } = await supabase
        .from('pregame_intel')
        .select('intel_id, match_id, home_team, away_team, sport, league_id, recommended_pick, analyzed_spread, analyzed_total, actual_home_score, actual_away_score, pick_result, grading_metadata, game_date')
        .or('sport.ilike.%soccer%,league_id.ilike.%eng%,league_id.ilike.%esp%,league_id.ilike.%uefa%,league_id.ilike.%usa.1%,league_id.ilike.%mex%,league_id.ilike.%ger%,league_id.ilike.%ita%,league_id.ilike.%fra%,league_id.ilike.%caf%')
        .gte('game_date', startStr)
        .lte('game_date', endStr)
        .not('actual_home_score', 'is', null)
        .in('pick_result', ['WIN', 'LOSS', 'PUSH'])
        .order('game_date', { ascending: false })
        .limit(20);

    if (error) {
        console.error("❌ Query error:", error.message);
        return;
    }

    if (!picks || picks.length === 0) {
        console.log("⚠️  No graded soccer picks found in the last week.\n");

        // Debug: show what sports exist
        const { data: sports } = await supabase
            .from('pregame_intel')
            .select('sport, league_id')
            .gte('game_date', startStr)
            .not('actual_home_score', 'is', null)
            .limit(50);

        if (sports) {
            const uniqueSports = [...new Set(sports.map(s => `${s.sport}|${s.league_id}`))];
            console.log("Available sport|league combinations in graded picks:");
            uniqueSports.slice(0, 20).forEach(s => console.log(`  - ${s}`));
        }
        return;
    }

    processResults(picks);
}

spotCheckSoccerGrades();
