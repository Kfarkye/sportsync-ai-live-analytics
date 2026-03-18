// scripts/regrade_cbb_oddsapi.js
// Re-grade CBB picks using The Odds API (better coverage than ESPN)

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qffzvrnbzabcokqqrwbv.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

const ODDS_API_KEY = process.env.ODDS_API_KEY || '6bfad0500cee211c753707183b9bd035';
const DRY_RUN = !process.argv.includes('--fix');

function normalizeWord(word) {
    // Handle common abbreviations
    const abbrevs = {
        'st': 'state', 'st.': 'state',
        'gw': 'george washington',
        'siu': 'southern illinois',
        'unc': 'north carolina',
        'usc': 'southern california',
        'ucla': 'california',
        'lsu': 'louisiana state',
        'ole': 'mississippi',
        'a&m': 'am',
        'fiu': 'florida international',
        'fau': 'florida atlantic',
    };
    const lower = word.toLowerCase().replace(/[^a-z]/g, '');
    return abbrevs[lower] || lower;
}

function getWords(name) {
    const stopWords = ['state', 'university', 'college', 'tech', 'golden', 'blue', 'red', 'green', 'black', 'white'];
    return (name || '').toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z\s]/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(w => w.length >= 2)
        .map(normalizeWord)
        .flat()
        .filter(w => w.length >= 3 && !stopWords.includes(w));
}

function teamsMatch(team1, team2) {
    const words1 = getWords(team1);
    const words2 = getWords(team2);

    let matchCount = 0;
    for (const w1 of words1) {
        for (const w2 of words2) {
            // Exact match or one contains the other
            if (w1 === w2 || (w1.length >= 4 && w2.includes(w1)) || (w2.length >= 4 && w1.includes(w2))) {
                matchCount++;
                break;
            }
        }
    }

    // For short team names (2 words), accept 1 match
    // For longer names, require 2 matches
    const minWords = Math.min(words1.length, words2.length);
    const requiredMatches = minWords <= 2 ? 1 : 2;

    return matchCount >= requiredMatches;
}

async function fetchOddsAPIScores() {
    // daysFrom=3 gets last 3 days
    const url = `https://api.the-odds-api.com/v4/sports/basketball_ncaab/scores/?apiKey=${ODDS_API_KEY}&daysFrom=3`;

    try {
        const res = await fetch(url);
        if (!res.ok) {
            console.log("Odds API error:", res.status);
            return [];
        }
        const data = await res.json();
        const remaining = res.headers.get('x-requests-remaining');
        console.log(`📡 Odds API: ${data.length} games, ${remaining} requests remaining\n`);

        return data.filter(g => g.completed && g.scores).map(g => {
            const homeScore = g.scores.find(s => s.name === g.home_team);
            const awayScore = g.scores.find(s => s.name === g.away_team);
            return {
                homeTeam: g.home_team,
                awayTeam: g.away_team,
                homeScore: parseInt(homeScore?.score || '0'),
                awayScore: parseInt(awayScore?.score || '0'),
                date: g.commence_time.split('T')[0]
            };
        });
    } catch (e) {
        console.log("Odds API error:", e.message);
        return [];
    }
}

function gradeSpreadPick(pickText, pickedTeam, gameHomeTeam, gameAwayTeam, homeScore, awayScore, dbHomeTeam, dbAwayTeam) {
    const spreadMatch = pickText.match(/([+-]\d+\.?\d*)/);
    if (!spreadMatch) return null;

    const spread = parseFloat(spreadMatch[1]);

    // Skip if spread looks like American odds (> 30)
    if (Math.abs(spread) > 30) return null;

    const pickedWords = getWords(pickedTeam);
    const dbHomeWords = getWords(dbHomeTeam);
    const dbAwayWords = getWords(dbAwayTeam);

    let pickedScore, opponentScore;
    let homeMatchCount = 0, awayMatchCount = 0;

    // Match against DB's team names (more reliable than game team names)
    for (const pw of pickedWords) {
        if (dbHomeWords.includes(pw)) homeMatchCount++;
        if (dbAwayWords.includes(pw)) awayMatchCount++;
    }

    // Accept 1 match for short names
    const minRequired = Math.min(pickedWords.length, 2) === 1 ? 1 : 1;

    if (homeMatchCount > awayMatchCount && homeMatchCount >= minRequired) {
        pickedScore = homeScore;
        opponentScore = awayScore;
    } else if (awayMatchCount > homeMatchCount && awayMatchCount >= minRequired) {
        pickedScore = awayScore;
        opponentScore = homeScore;
    } else if (homeMatchCount === awayMatchCount && homeMatchCount >= 1) {
        // Tie - try to use more specific matching
        return null;
    } else {
        return null;
    }

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
    console.log("🏀 RE-GRADING CBB PICKS (Odds API)\n");
    console.log(`Mode: ${DRY_RUN ? '🔍 DRY RUN' : '🔧 FIX MODE'}\n`);
    console.log("=".repeat(80));

    // Fetch scores from Odds API
    const games = await fetchOddsAPIScores();
    if (games.length === 0) {
        console.log("❌ No games from Odds API");
        return;
    }

    // Get CBB picks from last 3 days
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const startDate = threeDaysAgo.toISOString().split('T')[0];

    const { data: picks } = await supabase
        .from('pregame_intel')
        .select('intel_id, recommended_pick, home_team, away_team, game_date, pick_result')
        .eq('sport', 'college_basketball')
        .gte('game_date', startDate)
        .in('pick_result', ['WIN', 'LOSS', 'PUSH']);

    // Filter to spread picks
    const spreadPicks = (picks || []).filter(p => {
        const pick = (p.recommended_pick || '').toLowerCase();
        if (pick.includes('moneyline') || pick.includes(' ml') || pick.includes('over') || pick.includes('under')) return false;
        const match = pick.match(/([+-]\d+\.?\d*)/);
        if (!match) return false;
        return Math.abs(parseFloat(match[1])) <= 30; // Filter out odds
    });

    console.log(`\n📋 ${spreadPicks.length} CBB spread picks from last 3 days\n`);

    let correct = 0, wrong = 0, unmatched = 0;
    const fixes = [];

    for (const pick of spreadPicks) {
        const pickText = pick.recommended_pick || '';
        const pickedTeam = pickText.split(/[+-]/)[0].trim();
        const dbHome = pick.home_team || '';
        const dbAway = pick.away_team || '';

        // Find matching game
        const game = games.find(g => {
            const homeMatch = teamsMatch(dbHome, g.homeTeam) || teamsMatch(dbHome, g.awayTeam);
            const awayMatch = teamsMatch(dbAway, g.homeTeam) || teamsMatch(dbAway, g.awayTeam);
            return homeMatch && awayMatch;
        });

        if (!game) {
            unmatched++;
            if (process.argv.includes('--verbose')) {
                console.log(`⚠️ No game match: ${dbAway} @ ${dbHome}`);
            }
            continue;
        }

        const grade = gradeSpreadPick(pickText, pickedTeam, game.homeTeam, game.awayTeam, game.homeScore, game.awayScore, dbHome, dbAway);

        if (!grade) {
            unmatched++;
            if (process.argv.includes('--verbose')) {
                console.log(`⚠️ No grade (pick team unclear): ${pickText}`);
            }
            continue;
        }

        if (grade.result === pick.pick_result) {
            correct++;
        } else {
            wrong++;
            const emoji = grade.result === 'WIN' ? '✅' : grade.result === 'LOSS' ? '❌' : '➖';
            console.log(`🔄 WRONG: ${pickText}`);
            console.log(`   ${game.awayTeam} ${game.awayScore} @ ${game.homeTeam} ${game.homeScore}`);
            console.log(`   DB: ${pick.pick_result} | Should be: ${emoji} ${grade.result} | ${grade.reason}\n`);

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
    console.log(`   ⚠️ Unmatched: ${unmatched}`);

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
    }
}

regradeCBB();
