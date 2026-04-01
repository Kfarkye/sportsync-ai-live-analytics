// scripts/regrade_cbb_v2.js
// RE-GRADE CBB PICKS USING ODDS_API_EVENT_ID (DETERMINISTIC)
// This is the correct architecture - exact ID matching, no fuzzy logic

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qffzvrnbzabcokqqrwbv.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

const ODDS_API_KEY = process.env.ODDS_API_KEY || '6bfad0500cee211c753707183b9bd035';
const DRY_RUN = !process.argv.includes('--fix');

async function fetchOddsAPIScores() {
    const url = `https://api.the-odds-api.com/v4/sports/basketball_ncaab/scores/?apiKey=${ODDS_API_KEY}&daysFrom=3`;

    try {
        const res = await fetch(url);
        if (!res.ok) return {};

        const data = await res.json();
        const remaining = res.headers.get('x-requests-remaining');
        console.log(`📡 Odds API: ${data.length} games, ${remaining} requests remaining\n`);

        // Index by event ID for O(1) lookup
        const gamesById = {};
        for (const g of data) {
            if (!g.completed || !g.scores) continue;
            const homeScore = g.scores.find(s => s.name === g.home_team);
            const awayScore = g.scores.find(s => s.name === g.away_team);
            gamesById[g.id] = {
                homeTeam: g.home_team,
                awayTeam: g.away_team,
                homeScore: parseInt(homeScore?.score || '0'),
                awayScore: parseInt(awayScore?.score || '0'),
            };
        }
        return gamesById;
    } catch (e) {
        console.log("Odds API error:", e.message);
        return {};
    }
}

function gradeSpreadPick(pickText, homeScore, awayScore, isHomePick) {
    const spreadMatch = pickText.match(/([+-]\d+\.?\d*)/);
    if (!spreadMatch) return null;

    const spread = parseFloat(spreadMatch[1]);
    if (Math.abs(spread) > 30) return null; // Filter out American odds

    const pickedScore = isHomePick ? homeScore : awayScore;
    const opponentScore = isHomePick ? awayScore : homeScore;

    const adjustedScore = pickedScore + spread;

    if (adjustedScore > opponentScore) {
        return { result: 'WIN', reason: `${pickedScore} + ${spread} = ${adjustedScore} > ${opponentScore}` };
    } else if (adjustedScore < opponentScore) {
        return { result: 'LOSS', reason: `${pickedScore} + ${spread} = ${adjustedScore} < ${opponentScore}` };
    } else {
        return { result: 'PUSH', reason: `${pickedScore} + ${spread} = ${adjustedScore} = ${opponentScore}` };
    }
}

async function regradeCBB() {
    console.log("🏀 RE-GRADING CBB PICKS (Odds API Event ID - DETERMINISTIC)\n");
    console.log(`Mode: ${DRY_RUN ? '🔍 DRY RUN' : '🔧 FIX MODE'}\n`);
    console.log("=".repeat(80));

    // Fetch scores indexed by event ID
    const gamesById = await fetchOddsAPIScores();
    const gameCount = Object.keys(gamesById).length;
    if (gameCount === 0) {
        console.log("❌ No games from Odds API");
        return;
    }
    console.log(`📊 ${gameCount} finished games indexed by event ID\n`);

    // Get CBB picks from last 3 days that have odds_api_event_id
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const startDate = threeDaysAgo.toISOString().split('T')[0];

    const { data: picks, error } = await supabase
        .from('pregame_intel')
        .select('intel_id, recommended_pick, home_team, away_team, game_date, pick_result, odds_event_id, grading_metadata')
        .eq('sport', 'college_basketball')
        .gte('game_date', startDate)
        .not('odds_event_id', 'is', null)
        .in('pick_result', ['WIN', 'LOSS', 'PUSH']);

    if (error) {
        console.log("❌ Supabase error:", error.message);
        return;
    }

    // Filter to spread picks
    const spreadPicks = (picks || []).filter(p => {
        const pick = (p.recommended_pick || '').toLowerCase();
        if (pick.includes('moneyline') || pick.includes(' ml') || pick.includes('over') || pick.includes('under')) return false;
        const match = pick.match(/([+-]\d+\.?\d*)/);
        if (!match) return false;
        return Math.abs(parseFloat(match[1])) <= 30;
    });

    console.log(`📋 ${spreadPicks.length} CBB spread picks with odds_event_id from last 3 days\n`);

    let correct = 0, wrong = 0, noScore = 0;
    const fixes = [];

    for (const pick of spreadPicks) {
        const game = gamesById[pick.odds_event_id];

        if (!game) {
            noScore++;
            if (process.argv.includes('--verbose')) {
                console.log(`⚠️ No score for event: ${pick.odds_event_id}`);
            }
            continue;
        }

        // Determine if pick is on home team
        const pickText = pick.recommended_pick || '';
        const grading = pick.grading_metadata;
        let isHomePick = grading?.side === 'HOME';

        // Fallback to text matching if no grading metadata
        if (!grading?.side) {
            const pickTeamName = pickText.split(/[+-]/)[0].trim().toLowerCase();
            const homeLower = (pick.home_team || '').toLowerCase();
            isHomePick = pickTeamName.includes(homeLower.split(' ')[0]) || homeLower.includes(pickTeamName.split(' ')[0]);
        }

        const grade = gradeSpreadPick(pickText, game.homeScore, game.awayScore, isHomePick);

        if (!grade) {
            noScore++;
            continue;
        }

        if (grade.result === pick.pick_result) {
            correct++;
        } else {
            wrong++;
            const emoji = grade.result === 'WIN' ? '✅' : grade.result === 'LOSS' ? '❌' : '➖';
            console.log(`🔄 WRONG: ${pickText}`);
            console.log(`   ${game.awayTeam} ${game.awayScore} @ ${game.homeTeam} ${game.homeScore}`);
            console.log(`   DB: ${pick.pick_result} | Should be: ${emoji} ${grade.result} | ${grade.reason}`);
            console.log(`   Event ID: ${pick.odds_event_id}\n`);

            fixes.push({
                intel_id: pick.intel_id,
                old_result: pick.pick_result,
                new_result: grade.result
            });
        }
    }

    console.log("=".repeat(80));
    console.log(`\n📊 SUMMARY:`);
    console.log(`   ✅ Correct: ${correct}`);
    console.log(`   🔄 Wrong: ${wrong}`);
    console.log(`   ⚠️ No score/parse: ${noScore}`);

    if (fixes.length > 0 && !DRY_RUN) {
        console.log("\n🔧 APPLYING FIXES...\n");
        let success = 0;
        for (const fix of fixes) {
            const { error } = await supabase
                .from('pregame_intel')
                .update({ pick_result: fix.new_result })
                .eq('intel_id', fix.intel_id);
            if (!error) success++;
        }
        console.log(`   ✅ Fixed: ${success}/${fixes.length}`);
    } else if (fixes.length > 0) {
        console.log("\n💡 Run with --fix to apply corrections");
    } else {
        console.log("\n✅ All grades are correct!");
    }
}

regradeCBB();
