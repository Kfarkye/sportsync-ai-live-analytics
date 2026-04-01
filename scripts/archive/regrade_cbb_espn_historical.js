// scripts/regrade_cbb_espn_historical.js
// RE-GRADE CBB PICKS USING ESPN SCOREBOARDS FOR HISTORICAL DATA
// ESPN scoreboards are archived - we can go back further than Odds API's 3-day limit

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qffzvrnbzabcokqqrwbv.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

const DRY_RUN = !process.argv.includes('--fix');
const DAYS_BACK = parseInt(process.argv.find(a => a.startsWith('--days='))?.split('=')[1] || '14');

// ESPN scoreboard URL for a specific date
const getESPNScoreboardUrl = (date) => {
    // date format: YYYYMMDD
    return `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${date}&limit=500`;
};

function normalizeTeamName(name) {
    return (name || '')
        .toLowerCase()
        .replace(/[^a-z\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function teamsMatch(team1, team2) {
    const n1 = normalizeTeamName(team1);
    const n2 = normalizeTeamName(team2);

    // Exact match
    if (n1 === n2) return true;

    // One contains the other (for abbreviations)
    if (n1.includes(n2) || n2.includes(n1)) return true;

    // Word overlap (at least 2 significant words match)
    const words1 = n1.split(' ').filter(w => w.length >= 3);
    const words2 = n2.split(' ').filter(w => w.length >= 3);
    const stopWords = ['state', 'university', 'college'];

    const sig1 = words1.filter(w => !stopWords.includes(w));
    const sig2 = words2.filter(w => !stopWords.includes(w));

    let matches = 0;
    for (const w1 of sig1) {
        for (const w2 of sig2) {
            if (w1 === w2 || w1.includes(w2) || w2.includes(w1)) {
                matches++;
                break;
            }
        }
    }

    return matches >= 1 && matches >= Math.min(sig1.length, sig2.length) * 0.5;
}

async function fetchESPNScoreboard(dateStr) {
    // dateStr format: YYYY-MM-DD
    const espnDate = dateStr.replace(/-/g, '');
    const url = getESPNScoreboardUrl(espnDate);

    try {
        const res = await fetch(url);
        if (!res.ok) return [];

        const data = await res.json();
        const games = [];

        for (const event of (data.events || [])) {
            const competition = event.competitions?.[0];
            if (!competition) continue;

            const status = competition.status?.type?.name;
            if (status !== 'STATUS_FINAL') continue;

            const competitors = competition.competitors || [];
            const home = competitors.find(c => c.homeAway === 'home');
            const away = competitors.find(c => c.homeAway === 'away');

            if (!home || !away) continue;

            games.push({
                espnId: event.id,
                homeTeam: home.team?.displayName || home.team?.name,
                awayTeam: away.team?.displayName || away.team?.name,
                homeScore: parseInt(home.score || '0'),
                awayScore: parseInt(away.score || '0'),
                date: dateStr
            });
        }

        return games;
    } catch (e) {
        console.log(`ESPN error for ${dateStr}:`, e.message);
        return [];
    }
}

function gradeSpreadPick(pickText, homeScore, awayScore, isHomePick) {
    const spreadMatch = pickText.match(/([+-]\d+\.?\d*)/);
    if (!spreadMatch) return null;

    const spread = parseFloat(spreadMatch[1]);
    if (Math.abs(spread) > 30) return null;

    const pickedScore = isHomePick ? homeScore : awayScore;
    const opponentScore = isHomePick ? awayScore : homeScore;

    const adjustedScore = pickedScore + spread;

    if (adjustedScore > opponentScore) {
        return { result: 'WIN', homeScore, awayScore, reason: `${pickedScore} + ${spread} = ${adjustedScore} > ${opponentScore}` };
    } else if (adjustedScore < opponentScore) {
        return { result: 'LOSS', homeScore, awayScore, reason: `${pickedScore} + ${spread} = ${adjustedScore} < ${opponentScore}` };
    } else {
        return { result: 'PUSH', homeScore, awayScore, reason: `${pickedScore} + ${spread} = ${adjustedScore} = ${opponentScore}` };
    }
}

async function regradeCBB() {
    console.log("🏀 RE-GRADING CBB PICKS (ESPN Historical)\n");
    console.log(`Mode: ${DRY_RUN ? '🔍 DRY RUN' : '🔧 FIX MODE'}`);
    console.log(`Looking back: ${DAYS_BACK} days\n`);
    console.log("=".repeat(80));

    // Get all CBB spread picks
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - DAYS_BACK);
    const startDateStr = startDate.toISOString().split('T')[0];

    const { data: picks, error } = await supabase
        .from('pregame_intel')
        .select('intel_id, recommended_pick, home_team, away_team, game_date, pick_result, grading_metadata')
        .eq('sport', 'college_basketball')
        .gte('game_date', startDateStr)
        .in('pick_result', ['WIN', 'LOSS', 'PUSH'])
        .order('game_date', { ascending: true });

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

    console.log(`\n📋 ${spreadPicks.length} CBB spread picks from last ${DAYS_BACK} days\n`);

    // Group picks by date for efficient ESPN fetching
    const picksByDate = {};
    for (const pick of spreadPicks) {
        if (!picksByDate[pick.game_date]) {
            picksByDate[pick.game_date] = [];
        }
        picksByDate[pick.game_date].push(pick);
    }

    const dates = Object.keys(picksByDate).sort();
    console.log(`📅 Fetching ESPN scoreboards for ${dates.length} dates...\n`);

    let correct = 0, wrong = 0, noMatch = 0;
    const fixes = [];

    for (const date of dates) {
        const games = await fetchESPNScoreboard(date);
        const datePicks = picksByDate[date];

        process.stdout.write(`  ${date}: ${games.length} games, ${datePicks.length} picks... `);

        let dateCorrect = 0, dateWrong = 0, dateNoMatch = 0;

        for (const pick of datePicks) {
            // Find matching game
            const game = games.find(g =>
                (teamsMatch(pick.home_team, g.homeTeam) && teamsMatch(pick.away_team, g.awayTeam)) ||
                (teamsMatch(pick.home_team, g.awayTeam) && teamsMatch(pick.away_team, g.homeTeam))
            );

            if (!game) {
                dateNoMatch++;
                noMatch++;
                continue;
            }

            // Determine if pick is on home team
            const pickText = pick.recommended_pick || '';
            const grading = pick.grading_metadata;
            let isHomePick = grading?.side === 'HOME';

            if (!grading?.side) {
                const pickTeamName = pickText.split(/[+-]/)[0].trim().toLowerCase();
                isHomePick = teamsMatch(pickTeamName, pick.home_team);
            }

            const grade = gradeSpreadPick(pickText, game.homeScore, game.awayScore, isHomePick);

            if (!grade) {
                dateNoMatch++;
                noMatch++;
                continue;
            }

            if (grade.result === pick.pick_result) {
                dateCorrect++;
                correct++;
            } else {
                dateWrong++;
                wrong++;

                fixes.push({
                    intel_id: pick.intel_id,
                    old_result: pick.pick_result,
                    new_result: grade.result,
                    pickText,
                    game,
                    reason: grade.reason
                });
            }
        }

        console.log(`✓${dateCorrect} ✗${dateWrong} ?${dateNoMatch}`);

        // Small delay to avoid rate limiting
        await new Promise(r => setTimeout(r, 100));
    }

    console.log("\n" + "=".repeat(80));
    console.log(`\n📊 SUMMARY:`);
    console.log(`   ✅ Correct: ${correct}`);
    console.log(`   🔄 Wrong: ${wrong}`);
    console.log(`   ⚠️ No match: ${noMatch}`);
    console.log(`   📈 Accuracy: ${(correct / (correct + wrong) * 100).toFixed(1)}%`);

    if (wrong > 0) {
        console.log(`\n🔍 WRONG PICKS (showing first 10):`);
        for (const fix of fixes.slice(0, 10)) {
            console.log(`\n   ${fix.pickText}`);
            console.log(`   ${fix.game.awayTeam} ${fix.game.awayScore} @ ${fix.game.homeTeam} ${fix.game.homeScore}`);
            console.log(`   DB: ${fix.old_result} → Should be: ${fix.new_result} | ${fix.reason}`);
        }
    }

    if (fixes.length > 0 && !DRY_RUN) {
        console.log("\n🔧 APPLYING FIXES...\n");
        let success = 0;
        for (const fix of fixes) {
            const { error } = await supabase
                .from('pregame_intel')
                .update({
                    pick_result: fix.new_result,
                    final_home_score: fix.game.homeScore,
                    final_away_score: fix.game.awayScore
                })
                .eq('intel_id', fix.intel_id);
            if (!error) success++;
        }
        console.log(`   ✅ Fixed: ${success}/${fixes.length}`);
    } else if (fixes.length > 0) {
        console.log("\n💡 Run with --fix to apply corrections");
    }
}

regradeCBB();
