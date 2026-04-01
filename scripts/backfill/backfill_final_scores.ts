#!/usr/bin/env npx ts-node
/**
 * BACKFILL FINAL SCORES v1.0
 * 
 * PURPOSE: Populate final_home_score and final_away_score for historical picks
 *          that were graded before the migration added these columns.
 * 
 * SOURCES (Priority Order):
 *   1. matches table (primary - already in DB)
 *   2. feeds table (secondary - ESPN feed data)
 *   3. Odds API (fallback - external API)
 * 
 * RESULT: Unlocks cover_margin calculations in vw_titan_master
 * 
 * USAGE: npx ts-node scripts/backfill_final_scores.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ODDS_API_KEY = process.env.ODDS_API_KEY || '6bfad0500cee211c753707183b9bd035';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

interface PickToBackfill {
    intel_id: string;
    match_id: string;
    home_team: string;
    away_team: string;
    pick_result: string;
    game_date: string;
    sport: string;
    league_id: string;
}

interface ScoreResult {
    home_score: number;
    away_score: number;
    source: string;
}

// ============================================================================
// SCORE SOURCES
// ============================================================================

/**
 * Try to get scores from the matches table
 */
async function getScoresFromMatches(matchId: string): Promise<ScoreResult | null> {
    const { data } = await supabase
        .from('matches')
        .select('home_score, away_score, status')
        .eq('id', matchId)
        .in('status', ['FINAL', 'STATUS_FINAL', 'STATUS_FULL_TIME', 'post'])
        .single();

    if (data && data.home_score != null && data.away_score != null) {
        return {
            home_score: data.home_score,
            away_score: data.away_score,
            source: 'matches'
        };
    }
    return null;
}

/**
 * Try to get scores from the feeds table (ESPN data)
 */
async function getScoresFromFeeds(matchId: string): Promise<ScoreResult | null> {
    // Match ID format: 401810459_nba -> extract the numeric ID
    const numericId = matchId.split('_')[0];

    const { data } = await supabase
        .from('feeds')
        .select('home_score, away_score, status')
        .or(`event_id.eq.${numericId},match_id.eq.${matchId}`)
        .in('status', ['final', 'FINAL', 'post', 'STATUS_FINAL'])
        .limit(1)
        .single();

    if (data && data.home_score != null && data.away_score != null) {
        return {
            home_score: data.home_score,
            away_score: data.away_score,
            source: 'feeds'
        };
    }
    return null;
}

/**
 * Fallback: Get scores from Odds API (uses API credits)
 */
async function getScoresFromOddsAPI(pick: PickToBackfill): Promise<ScoreResult | null> {
    // Map sport to Odds API sport key
    const sportKeyMap: Record<string, string> = {
        'basketball': 'basketball_nba',
        'nba': 'basketball_nba',
        'hockey': 'icehockey_nhl',
        'nhl': 'icehockey_nhl',
        'football': 'americanfootball_nfl',
        'nfl': 'americanfootball_nfl',
        'mens-college-basketball': 'basketball_ncaab',
        'ncaab': 'basketball_ncaab',
        'college-football': 'americanfootball_ncaaf',
        'ncaaf': 'americanfootball_ncaaf',
        'soccer': 'soccer_epl', // Default to EPL, may need adjustment
        'tennis': 'tennis_atp_aus_open', // Default, may need adjustment
    };

    const sportKey = sportKeyMap[pick.sport?.toLowerCase()] || sportKeyMap[pick.league_id?.toLowerCase()];
    if (!sportKey) return null;

    try {
        // Fetch scores for the sport (last 3 days)
        const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/scores/?apiKey=${ODDS_API_KEY}&daysFrom=14`;
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) });

        if (!res.ok) return null;

        const games = await res.json();

        // Try to match by team names
        const normalizeTeam = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, '');
        const homeNorm = normalizeTeam(pick.home_team);
        const awayNorm = normalizeTeam(pick.away_team);

        for (const game of games) {
            if (!game.completed || !game.scores) continue;

            const gameHomeNorm = normalizeTeam(game.home_team);
            const gameAwayNorm = normalizeTeam(game.away_team);

            // Check for match (either exact or contains)
            const homeMatch = gameHomeNorm.includes(homeNorm) || homeNorm.includes(gameHomeNorm);
            const awayMatch = gameAwayNorm.includes(awayNorm) || awayNorm.includes(gameAwayNorm);

            if (homeMatch && awayMatch) {
                const homeScoreObj = game.scores.find((s: any) => s.name === game.home_team);
                const awayScoreObj = game.scores.find((s: any) => s.name === game.away_team);

                if (homeScoreObj && awayScoreObj) {
                    return {
                        home_score: parseInt(homeScoreObj.score || '0'),
                        away_score: parseInt(awayScoreObj.score || '0'),
                        source: 'odds_api'
                    };
                }
            }
        }
    } catch (e) {
        // Ignore API errors, just return null
    }

    return null;
}

// ============================================================================
// MAIN BACKFILL LOGIC
// ============================================================================

async function backfillFinalScores() {
    console.log('🚀 BACKFILL FINAL SCORES v1.0');
    console.log('═'.repeat(60));
    console.log('');

    // Step 1: Find all picks that need backfilling
    const { data: picks, error } = await supabase
        .from('pregame_intel')
        .select('intel_id, match_id, home_team, away_team, pick_result, game_date, sport, league_id')
        .in('pick_result', ['WIN', 'LOSS', 'PUSH'])
        .is('final_home_score', null)
        .order('game_date', { ascending: false })
        .limit(500);

    if (error) {
        console.error('❌ Error fetching picks:', error.message);
        return;
    }

    if (!picks?.length) {
        console.log('✅ No picks need backfilling! All final scores are populated.');
        return;
    }

    console.log(`📊 Found ${picks.length} picks needing score backfill`);
    console.log('');

    // Stats tracking
    const stats = {
        total: picks.length,
        updated: 0,
        fromMatches: 0,
        fromFeeds: 0,
        fromOddsAPI: 0,
        notFound: 0,
        errors: 0
    };

    // Step 2: Process each pick
    for (const pick of picks as PickToBackfill[]) {
        let scores: ScoreResult | null = null;

        // Try sources in priority order
        scores = await getScoresFromMatches(pick.match_id);

        if (!scores) {
            scores = await getScoresFromFeeds(pick.match_id);
        }

        // Note: Uncomment below to enable Odds API fallback (uses API credits)
        // if (!scores) {
        //     scores = await getScoresFromOddsAPI(pick);
        // }

        if (scores) {
            // Update the pick with final scores
            const { error: updateError } = await supabase
                .from('pregame_intel')
                .update({
                    final_home_score: scores.home_score,
                    final_away_score: scores.away_score
                })
                .eq('intel_id', pick.intel_id);

            if (updateError) {
                console.log(`  ❌ ${pick.match_id}: Update failed - ${updateError.message}`);
                stats.errors++;
            } else {
                console.log(`  ✅ ${pick.match_id}: ${scores.home_score}-${scores.away_score} (${scores.source})`);
                stats.updated++;

                if (scores.source === 'matches') stats.fromMatches++;
                if (scores.source === 'feeds') stats.fromFeeds++;
                if (scores.source === 'odds_api') stats.fromOddsAPI++;
            }
        } else {
            console.log(`  ⚠️  ${pick.match_id}: No score found (${pick.home_team} vs ${pick.away_team})`);
            stats.notFound++;
        }
    }

    // Step 3: Print summary
    console.log('');
    console.log('═'.repeat(60));
    console.log('📊 BACKFILL SUMMARY');
    console.log('═'.repeat(60));
    console.log(`  Total Picks Processed: ${stats.total}`);
    console.log(`  Successfully Updated:  ${stats.updated}`);
    console.log(`    └─ From matches:     ${stats.fromMatches}`);
    console.log(`    └─ From feeds:       ${stats.fromFeeds}`);
    console.log(`    └─ From Odds API:    ${stats.fromOddsAPI}`);
    console.log(`  Not Found:             ${stats.notFound}`);
    console.log(`  Errors:                ${stats.errors}`);
    console.log('═'.repeat(60));

    if (stats.updated > 0) {
        console.log('');
        console.log('✅ cover_margin will now calculate for updated picks in vw_titan_master!');
    }

    if (stats.notFound > 0) {
        console.log('');
        console.log('💡 TIP: Uncomment the Odds API fallback in the script to fetch missing scores');
        console.log('   (Note: This uses API credits)');
    }
}

// Run the backfill
backfillFinalScores().catch(console.error);
