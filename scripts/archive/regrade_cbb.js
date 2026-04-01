// scripts/regrade_cbb.js
// Re-grade all CBB picks with correct spread logic

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qffzvrnbzabcokqqrwbv.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

const DRY_RUN = !process.argv.includes('--fix');
const VERBOSE = process.argv.includes('--verbose');

function normalizeName(name) {
    return (name || '').toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z\s]/g, '')
        .trim();
}

function getWords(name) {
    return normalizeName(name).split(/\s+/).filter(w => w.length >= 3);
}

function teamsMatch(team1, team2) {
    const words1 = getWords(team1);
    const words2 = getWords(team2);

    // Count matching words
    let matchCount = 0;
    for (const w1 of words1) {
        for (const w2 of words2) {
            if (w1 === w2) {
                matchCount++;
                break;
            }
        }
    }

    // Need at least 2 matching words to consider it a match
    // This prevents 'Auburn Tigers' from matching 'Jackson State Tigers'
    return matchCount >= 2;
}

async function fetchESPNGames(date) {
    const dateStr = date.replace(/-/g, '');
    const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${dateStr}&limit=200`;

    try {
        const res = await fetch(url);
        if (!res.ok) return [];
        const data = await res.json();

        return (data.events || []).map(event => {
            const comp = event.competitions?.[0];
            if (!comp) return null;

            const status = comp.status?.type?.name || '';
            if (!status.includes('STATUS_FINAL')) return null;

            const teams = comp.competitors || [];
            if (teams.length < 2) return null;

            const home = teams.find(t => t.homeAway === 'home');
            const away = teams.find(t => t.homeAway === 'away');
            if (!home || !away) return null;

            return {
                homeTeam: home.team?.displayName || home.team?.name || '',
                awayTeam: away.team?.displayName || away.team?.name || '',
                homeScore: parseInt(home.score || '0'),
                awayScore: parseInt(away.score || '0'),
            };
        }).filter(Boolean);
    } catch (e) {
        return [];
    }
}

function gradeSpreadPick(pickText, pickedTeam, homeTeam, awayTeam, homeScore, awayScore) {
    // Extract spread from pick text
    const spreadMatch = pickText.match(/([+-]\d+\.?\d*)/);
    if (!spreadMatch) return null;

    const spread = parseFloat(spreadMatch[1]);

    // Determine if picked team is home or away
    const pickedWords = getWords(pickedTeam);

    let pickedScore, opponentScore;

    // Check which team was picked by word matching
    let homeMatchCount = 0, awayMatchCount = 0;
    for (const pw of pickedWords) {
        if (getWords(homeTeam).includes(pw)) homeMatchCount++;
        if (getWords(awayTeam).includes(pw)) awayMatchCount++;
    }

    if (homeMatchCount > awayMatchCount && homeMatchCount >= 2) {
        pickedScore = homeScore;
        opponentScore = awayScore;
    } else if (awayMatchCount > homeMatchCount && awayMatchCount >= 2) {
        pickedScore = awayScore;
        opponentScore = homeScore;
    } else {
        return null; // Can't determine which team was picked
    }

    // Calculate cover: pickedScore + spread vs opponentScore
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
    console.log("🏀 RE-GRADING CBB PICKS\n");
    console.log(`Mode: ${DRY_RUN ? '🔍 DRY RUN (add --fix to apply)' : '🔧 FIX MODE'}\n`);
    console.log("=".repeat(80));

    // Get all graded CBB spread picks
    let allPicks = [];
    let page = 0;
    const pageSize = 1000;

    while (true) {
        const { data, error } = await supabase
            .from('pregame_intel')
            .select('intel_id, match_id, recommended_pick, home_team, away_team, game_date, pick_result')
            .eq('sport', 'college_basketball')
            .in('pick_result', ['WIN', 'LOSS', 'PUSH'])
            .order('game_date', { ascending: false })
            .range(page * pageSize, (page + 1) * pageSize - 1);

        if (error || !data || data.length === 0) break;
        allPicks = allPicks.concat(data);
        if (data.length < pageSize) break;
        page++;
    }

    // Filter to spread picks only
    const spreadPicks = allPicks.filter(p => {
        const pick = (p.recommended_pick || '').toLowerCase();
        if (pick.includes('moneyline') || pick.includes('over') || pick.includes('under')) return false;
        return /[+-]\d+\.?\d*/.test(pick);
    });

    console.log(`\n📋 Found ${spreadPicks.length} CBB spread picks to re-grade\n`);

    // Group by date
    const byDate = {};
    spreadPicks.forEach(p => {
        const date = p.game_date;
        if (!byDate[date]) byDate[date] = [];
        byDate[date].push(p);
    });

    let correct = 0, wrong = 0, unmatched = 0;
    const fixes = [];

    for (const [date, picks] of Object.entries(byDate)) {
        const games = await fetchESPNGames(date);
        if (VERBOSE) console.log(`\n📅 ${date}: ${picks.length} picks, ${games.length} ESPN games`);

        for (const pick of picks) {
            // Extract picked team from pick text
            const pickText = pick.recommended_pick || '';
            const pickedTeam = pickText.split(/[+-]/)[0].trim();
            const dbHome = pick.home_team || '';
            const dbAway = pick.away_team || '';

            // Find matching game using DB's home/away teams (more reliable than pick text)
            const game = games.find(g => {
                const homeMatch = teamsMatch(dbHome, g.homeTeam) || teamsMatch(dbHome, g.awayTeam);
                const awayMatch = teamsMatch(dbAway, g.homeTeam) || teamsMatch(dbAway, g.awayTeam);
                return homeMatch && awayMatch;
            });

            if (!game) {
                unmatched++;
                if (VERBOSE) console.log(`   ⚠️ No match: ${dbAway} @ ${dbHome}`);
                continue;
            }

            const grade = gradeSpreadPick(pickText, pickedTeam, game.homeTeam, game.awayTeam, game.homeScore, game.awayScore);

            if (!grade) {
                unmatched++;
                continue;
            }

            if (grade.result === pick.pick_result) {
                correct++;
            } else {
                wrong++;
                const emoji = grade.result === 'WIN' ? '✅' : grade.result === 'LOSS' ? '❌' : '➖';
                console.log(`\n🔄 WRONG: ${pickText}`);
                console.log(`   ${game.awayTeam} ${game.awayScore} @ ${game.homeTeam} ${game.homeScore}`);
                console.log(`   DB says: ${pick.pick_result} | Should be: ${emoji} ${grade.result}`);
                console.log(`   Reason: ${grade.reason}`);

                fixes.push({
                    intel_id: pick.intel_id,
                    old_result: pick.pick_result,
                    new_result: grade.result,
                    pick_text: pickText
                });
            }
        }
    }

    console.log("\n" + "=".repeat(80));
    console.log(`\n📊 SUMMARY:`);
    console.log(`   ✅ Correct: ${correct}`);
    console.log(`   🔄 Wrong: ${wrong}`);
    console.log(`   ⚠️ Unmatched: ${unmatched}`);

    if (fixes.length > 0) {
        console.log(`\n📝 ${fixes.length} picks need to be fixed\n`);

        // Show breakdown of changes
        const winToLoss = fixes.filter(f => f.old_result === 'WIN' && f.new_result === 'LOSS').length;
        const lossToWin = fixes.filter(f => f.old_result === 'LOSS' && f.new_result === 'WIN').length;
        const toPush = fixes.filter(f => f.new_result === 'PUSH').length;

        console.log(`   WIN → LOSS: ${winToLoss}`);
        console.log(`   LOSS → WIN: ${lossToWin}`);
        console.log(`   → PUSH: ${toPush}`);

        if (!DRY_RUN) {
            console.log("\n🔧 APPLYING FIXES...\n");
            let success = 0, failed = 0;

            for (const fix of fixes) {
                const { error } = await supabase
                    .from('pregame_intel')
                    .update({ pick_result: fix.new_result })
                    .eq('intel_id', fix.intel_id);

                if (error) failed++;
                else success++;
            }

            console.log(`   ✅ Fixed: ${success}`);
            console.log(`   ❌ Failed: ${failed}`);
        } else {
            console.log("\n💡 Run with --fix to apply corrections");
        }
    } else {
        console.log("\n✅ All grades are correct!");
    }
}

regradeCBB();
