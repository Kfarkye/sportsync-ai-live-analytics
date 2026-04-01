/**
 * AUDIT SCRIPT: Verify Tennis PICK_EM Classification
 * 
 * This script queries the ACTUAL vw_titan_master view to:
 * 1. Count NULL vs ZERO spread for Tennis PICK_EM picks
 * 2. Show sample rows
 * 3. Prove the implied side using odds
 * 
 * Run: npx tsx scripts/audit_pickem_tennis.ts
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qffzvrnbzabcokqqrwbv.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUzNTc2NjgsImV4cCI6MjA3MDkzMzY2OH0.PCSnC5E7sG7FvasHy_9DdwiN61xW0GzFROLzZ0bTVnc';
const supabase = createClient(supabaseUrl, supabaseKey);

interface AuditResult {
    timestamp: string;
    relation: string;
    spread_breakdown: Record<string, { count: number; wins: number; losses: number; pushes: number; win_rate_pct: string }>;
    sample_rows: any[];
    implied_side_breakdown: Record<string, number>;
}

async function runAudit(): Promise<AuditResult> {
    const timestamp = new Date().toISOString();
    console.log(`\n${'='.repeat(60)}`);
    console.log(`AUDIT: Tennis PICK_EM Classification`);
    console.log(`Timestamp: ${timestamp}`);
    console.log(`Relation: vw_titan_master`);
    console.log(`${'='.repeat(60)}\n`);

    // Query 1: Get all Tennis picks from vw_titan_master with category info
    const { data: masterData, error: masterError } = await supabase
        .from('vw_titan_master')
        .select('*')
        .in('league_id', ['atp', 'wta']);

    if (masterError) {
        console.error('Error querying vw_titan_master:', masterError);
        throw masterError;
    }

    // Aggregate by category
    const categoryBreakdown: Record<string, { count: number; wins: number; losses: number }> = {};
    masterData?.forEach(row => {
        const cat = row.category || 'UNKNOWN';
        if (!categoryBreakdown[cat]) categoryBreakdown[cat] = { count: 0, wins: 0, losses: 0 };
        categoryBreakdown[cat].count++;
        if (row.pick_result === 'WIN') categoryBreakdown[cat].wins++;
        if (row.pick_result === 'LOSS') categoryBreakdown[cat].losses++;
    });

    console.log(`A) TENNIS CATEGORY BREAKDOWN (from vw_titan_master)\n`);
    console.log(`Category          | Count | W-L     | Win Rate`);
    console.log(`${'─'.repeat(50)}`);
    for (const [cat, stats] of Object.entries(categoryBreakdown).sort((a, b) => b[1].count - a[1].count)) {
        const decisions = stats.wins + stats.losses;
        const rate = decisions > 0 ? ((stats.wins / decisions) * 100).toFixed(1) + '%' : 'N/A';
        console.log(`${cat.padEnd(17)} | ${String(stats.count).padEnd(5)} | ${stats.wins}-${stats.losses}`.padEnd(40) + ` | ${rate}`);
    }

    // Query 2: Get raw pregame_intel for Tennis to check spread distribution
    const { data: rawData, error: rawError } = await supabase
        .from('pregame_intel')
        .select('intel_id, spread_line, pick_result, home_ml, away_ml, recommended_pick')
        .in('league_id', ['atp', 'wta']);

    if (rawError) {
        console.error('Error querying pregame_intel:', rawError);
        throw rawError;
    }

    // Aggregate by spread state
    const spreadBreakdown: Record<string, { count: number; wins: number; losses: number; pushes: number; win_rate_pct: string }> = {
        'NULL': { count: 0, wins: 0, losses: 0, pushes: 0, win_rate_pct: '0.0%' },
        'ZERO': { count: 0, wins: 0, losses: 0, pushes: 0, win_rate_pct: '0.0%' },
        'OTHER': { count: 0, wins: 0, losses: 0, pushes: 0, win_rate_pct: '0.0%' }
    };

    const impliedSideBreakdown: Record<string, number> = {
        'FAVORITE_PROXY': 0,
        'UNDERDOG_PROXY': 0,
        'NO_ODDS': 0
    };

    rawData?.forEach(row => {
        // Spread state
        let state = 'OTHER';
        if (row.spread_line === null) state = 'NULL';
        else if (row.spread_line === 0) state = 'ZERO';

        spreadBreakdown[state].count++;
        if (row.pick_result === 'WIN') spreadBreakdown[state].wins++;
        if (row.pick_result === 'LOSS') spreadBreakdown[state].losses++;
        if (row.pick_result === 'PUSH') spreadBreakdown[state].pushes++;

        // Implied side (using home_ml as proxy - if pick was home and home_ml < 0, they picked favorite)
        // This is approximate - we'd need the actual pick_odds to be precise
        if (row.home_ml === null && row.away_ml === null) {
            impliedSideBreakdown['NO_ODDS']++;
        } else if (row.home_ml !== null && row.home_ml < 0) {
            // Home is favorite
            impliedSideBreakdown['FAVORITE_PROXY']++;
        } else {
            impliedSideBreakdown['UNDERDOG_PROXY']++;
        }
    });

    // Calculate win rates
    for (const state of Object.keys(spreadBreakdown)) {
        const s = spreadBreakdown[state];
        const decisions = s.wins + s.losses;
        s.win_rate_pct = decisions > 0 ? ((s.wins / decisions) * 100).toFixed(1) + '%' : 'N/A';
    }

    console.log(`\n\nB) SPREAD STATE BREAKDOWN (from pregame_intel)\n`);
    console.log(`Spread State | Count | W-L-P       | Win Rate`);
    console.log(`${'─'.repeat(50)}`);
    for (const [state, stats] of Object.entries(spreadBreakdown)) {
        if (stats.count === 0) continue;
        console.log(`${state.padEnd(12)} | ${String(stats.count).padEnd(5)} | ${stats.wins}-${stats.losses}-${stats.pushes}`.padEnd(35) + ` | ${stats.win_rate_pct}`);
    }

    console.log(`\n\nC) IMPLIED SIDE BREAKDOWN (odds-based proxy)\n`);
    console.log(`Implied Side      | Count`);
    console.log(`${'─'.repeat(30)}`);
    for (const [side, count] of Object.entries(impliedSideBreakdown)) {
        if (count === 0) continue;
        console.log(`${side.padEnd(17)} | ${count}`);
    }

    // Sample rows
    const sampleRows = rawData?.filter(r => r.spread_line === null).slice(0, 10) || [];

    console.log(`\n\nD) SAMPLE ROWS (10 NULL-spread Tennis picks)\n`);
    console.log(`intel_id (first 8) | spread | result | home_ml | away_ml`);
    console.log(`${'─'.repeat(60)}`);
    sampleRows.forEach(r => {
        console.log(`${String(r.intel_id).slice(0, 8)}...     | ${String(r.spread_line).padEnd(6)} | ${String(r.pick_result).padEnd(6)} | ${String(r.home_ml).padEnd(7)} | ${r.away_ml}`);
    });

    const result: AuditResult = {
        timestamp,
        relation: 'vw_titan_master + pregame_intel',
        spread_breakdown: spreadBreakdown,
        sample_rows: sampleRows,
        implied_side_breakdown: impliedSideBreakdown
    };

    console.log(`\n\n${'='.repeat(60)}`);
    console.log(`AUDIT COMPLETE`);
    console.log(`${'='.repeat(60)}`);
    console.log(`\nJSON Output (for audit record):`);
    console.log(JSON.stringify(result, null, 2));

    return result;
}

runAudit().catch(err => {
    console.error('Audit failed:', err);
    process.exit(1);
});
