#!/usr/bin/env node
/**
 * BACKFILL FINAL SCORES v1.0
 * 
 * PURPOSE: Populate final_home_score and final_away_score for historical picks
 *          that were graded before the migration added these columns.
 * 
 * USAGE: SUPABASE_SERVICE_ROLE_KEY="your-key" node scripts/backfill_final_scores.js
 */

import { createClient } from '@supabase/supabase-js';

// Hardcoded Supabase URL (same as other scripts in this project)
const SUPABASE_URL = 'https://qffzvrnbzabcokqqrwbv.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_SERVICE_KEY) {
    console.error('❌ Missing SUPABASE_SERVICE_ROLE_KEY');
    console.error('');
    console.error('Run with:');
    console.error('  SUPABASE_SERVICE_ROLE_KEY="your-key" node scripts/backfill_final_scores.js');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

/**
 * Try to get scores from the matches table
 */
async function getScoresFromMatches(matchId) {
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
async function getScoresFromFeeds(matchId) {
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
        notFound: 0,
        errors: 0
    };

    // Step 2: Process each pick
    for (const pick of picks) {
        let scores = null;

        // Try sources in priority order
        scores = await getScoresFromMatches(pick.match_id);

        if (!scores) {
            scores = await getScoresFromFeeds(pick.match_id);
        }

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
    console.log(`  Not Found:             ${stats.notFound}`);
    console.log(`  Errors:                ${stats.errors}`);
    console.log('═'.repeat(60));

    if (stats.updated > 0) {
        console.log('');
        console.log('✅ cover_margin will now calculate for updated picks in vw_titan_master!');
    }
}

// Run the backfill
backfillFinalScores().catch(console.error);
