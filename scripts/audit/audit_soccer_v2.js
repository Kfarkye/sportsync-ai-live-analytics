// scripts/audit_soccer_v2.js
// Audit soccer grades by parsing the actual pick text for the spread value

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qffzvrnbzabcokqqrwbv.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

const DRY_RUN = !process.argv.includes('--fix');

function parseSpreadFromPick(pickText) {
    if (!pickText) return null;

    // Match patterns like "-2.5", "+1.5", "-0.25", "0", "-1"
    const match = pickText.match(/([+-]?\d+\.?\d*)\s*$/);
    if (match) {
        return parseFloat(match[1]);
    }

    // Also try to find spread in middle of text
    const midMatch = pickText.match(/([+-]\d+\.?\d*)/);
    if (midMatch) {
        return parseFloat(midMatch[1]);
    }

    return null;
}

function extractTeamFromPick(pickText, homeTeam, awayTeam) {
    if (!pickText) return null;
    const pickLower = pickText.toLowerCase();
    const homeLower = homeTeam.toLowerCase();
    const awayLower = awayTeam.toLowerCase();

    // Check which team is in the pick
    if (pickLower.includes(awayLower) || pickLower.includes(awayLower.split(' ')[0])) {
        return 'AWAY';
    }
    if (pickLower.includes(homeLower) || pickLower.includes(homeLower.split(' ')[0])) {
        return 'HOME';
    }
    return null;
}

function gradeSpreadPick(awayScore, homeScore, spread, side) {
    let coverMargin;

    if (side === 'AWAY') {
        const awayMargin = awayScore - homeScore;
        coverMargin = awayMargin + spread;
    } else {
        const homeMargin = homeScore - awayScore;
        coverMargin = homeMargin + spread;
    }

    let expected;
    if (coverMargin > 0) expected = 'WIN';
    else if (coverMargin < 0) expected = 'LOSS';
    else expected = 'PUSH';

    return { expected, coverMargin };
}

async function auditSoccerGrades() {
    console.log("⚽ SOCCER GRADING AUDIT v2 (Using Pick Text)\n");
    console.log("=".repeat(80));
    console.log(`Mode: ${DRY_RUN ? '🔍 DRY RUN' : '🔧 FIX MODE'}\n`);

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
    const dataIssues = [];
    let spreadCount = 0;

    for (const pick of picks) {
        const meta = pick.grading_metadata || {};
        const pickType = (meta.type || '').toUpperCase();

        if (pickType !== 'SPREAD') continue;
        spreadCount++;

        const homeScore = pick.actual_home_score;
        const awayScore = pick.actual_away_score;

        // Parse spread from the pick text
        const parsedSpread = parseSpreadFromPick(pick.recommended_pick);
        const storedSpread = pick.analyzed_spread;
        const metaSide = (meta.side || '').toUpperCase();

        // Determine side from pick text if metadata is missing
        const side = metaSide || extractTeamFromPick(pick.recommended_pick, pick.home_team, pick.away_team);

        if (parsedSpread === null || !side) {
            dataIssues.push({
                pick,
                issue: `Could not parse: spread=${parsedSpread}, side=${side}`
            });
            continue;
        }

        // Check if stored spread matches parsed spread
        const spreadMismatch = storedSpread !== null && Math.abs(storedSpread - parsedSpread) > 0.01;

        const { expected, coverMargin } = gradeSpreadPick(awayScore, homeScore, parsedSpread, side);

        if (pick.pick_result !== expected) {
            errors.push({
                pick,
                expected,
                coverMargin,
                side,
                parsedSpread,
                storedSpread,
                spreadMismatch
            });
        }
    }

    console.log(`📋 Spread picks audited: ${spreadCount}`);
    console.log(`❌ Grading errors: ${errors.length}`);
    console.log(`⚠️  Data issues (couldn't parse): ${dataIssues.length}\n`);

    if (errors.length === 0 && dataIssues.length === 0) {
        console.log("🎉 All soccer spread picks are correctly graded!\n");
        return;
    }

    if (errors.length > 0) {
        console.log("=".repeat(80));
        console.log("\n❌ MISGRADED PICKS (based on pick text):\n");

        for (const err of errors) {
            const { pick, expected, coverMargin, side, parsedSpread, storedSpread, spreadMismatch } = err;
            console.log(`❌ ${pick.match_id} (${pick.game_date})`);
            console.log(`   ${pick.away_team} @ ${pick.home_team}`);
            console.log(`   Pick Text: "${pick.recommended_pick}"`);
            console.log(`   Parsed: ${side} spread ${parsedSpread} | Stored: ${storedSpread}${spreadMismatch ? ' ⚠️ MISMATCH' : ''}`);
            console.log(`   Score: ${pick.actual_away_score}-${pick.actual_home_score} | Cover: ${coverMargin.toFixed(2)}`);
            console.log(`   Recorded: ${pick.pick_result} → Should be: ${expected}\n`);
        }
    }

    if (dataIssues.length > 0) {
        console.log("=".repeat(80));
        console.log("\n⚠️  DATA ISSUES (manual review needed):\n");
        for (const issue of dataIssues.slice(0, 10)) {
            console.log(`   ${issue.pick.match_id}: ${issue.issue}`);
            console.log(`   Pick: "${issue.pick.recommended_pick}"\n`);
        }
    }

    if (!DRY_RUN && errors.length > 0) {
        console.log("=".repeat(80));
        console.log("\n🔧 APPLYING FIXES...\n");

        let fixed = 0;
        for (const err of errors) {
            const updates = { pick_result: err.expected };

            // Also fix the stored spread if it's wrong
            if (err.spreadMismatch && err.parsedSpread !== null) {
                updates.analyzed_spread = err.parsedSpread;
            }

            const { error: updateErr } = await supabase
                .from('pregame_intel')
                .update(updates)
                .eq('intel_id', err.pick.intel_id);

            if (updateErr) {
                console.error(`   ❌ Failed: ${err.pick.match_id}`);
            } else {
                console.log(`   ✅ Fixed ${err.pick.match_id}: ${err.pick.pick_result} → ${err.expected}`);
                fixed++;
            }
        }
        console.log(`\n🎉 Fixed ${fixed}/${errors.length} records.\n`);
    }
}

auditSoccerGrades();
