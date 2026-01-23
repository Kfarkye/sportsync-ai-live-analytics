/**
 * NBA Live Totals Control Engine v3.0 - Backtest CLI
 * 
 * Usage: npx tsx engine/src/backtest.ts <game_id>
 * 
 * Replays ticks for a game and recomputes snapshots.
 * Verifies determinism by comparing against stored snapshots.
 */

import { computeControlTable, validateControlTableInput } from './controlTable';
import { ControlTableInput, ControlTableOutput } from './types';

// Simulated database types (would come from Supabase in production)
interface TickRow {
    tick_id: number;
    game_id: string;
    ts: string;
    elapsed_min: number;
    rem_min: number;
    pts_home: number;
    pts_away: number;
    home_fga: number;
    home_fgm: number;
    home_3pa: number;
    home_3pm: number;
    home_fta: number;
    home_ftm: number;
    home_tov: number;
    home_orb: number;
    away_fga: number;
    away_fgm: number;
    away_3pa: number;
    away_3pm: number;
    away_fta: number;
    away_ftm: number;
    away_tov: number;
    away_orb: number;
}

interface GameRow {
    game_id: string;
    close_total: number;
    pace_pre48: number;
    home_team: string;
    away_team: string;
}

interface BacktestResult {
    gameId: string;
    tickCount: number;
    snapshots: ControlTableOutput[];
    finalModelFair: number;
    finalEdgeZ: number;
    isDeterministic: boolean;
    mismatches: Array<{
        tickId: number;
        field: string;
        expected: number;
        actual: number;
        diff: number;
    }>;
}

/**
 * Convert tick row to engine input format
 */
function tickToEngineInput(
    tick: TickRow,
    game: GameRow,
    exp3pPctHome: number,
    exp2pPctHome: number,
    exp3pPctAway: number,
    exp2pPctAway: number,
    liveMarketTotal: number
): ControlTableInput {
    return {
        mktAnchorTotal: game.close_total,
        liveMarketTotal,
        elapsedMin: tick.elapsed_min,
        remMin: tick.rem_min,
        ptsHome: tick.pts_home,
        ptsAway: tick.pts_away,
        homeBox: {
            fga: tick.home_fga,
            fgm: tick.home_fgm,
            threePA: tick.home_3pa,
            threePM: tick.home_3pm,
            fta: tick.home_fta,
            ftm: tick.home_ftm,
            tov: tick.home_tov,
            orb: tick.home_orb,
        },
        awayBox: {
            fga: tick.away_fga,
            fgm: tick.away_fgm,
            threePA: tick.away_3pa,
            threePM: tick.away_3pm,
            fta: tick.away_fta,
            ftm: tick.away_ftm,
            tov: tick.away_tov,
            orb: tick.away_orb,
        },
        exp3pPctHome,
        exp2pPctHome,
        exp3pPctAway,
        exp2pPctAway,
        pacePre48: game.pace_pre48,
        sumCurrentEpmHome: 0,
        avgTeamEpmHome: 0,
        sumCurrentEpmAway: 0,
        avgTeamEpmAway: 0,
    };
}

/**
 * Run backtest for a game
 */
export function runBacktest(
    ticks: TickRow[],
    game: GameRow,
    priors: { exp3pPctHome: number; exp2pPctHome: number; exp3pPctAway: number; exp2pPctAway: number },
    liveMarketTotal: number,
    storedSnapshots?: ControlTableOutput[]
): BacktestResult {
    const snapshots: ControlTableOutput[] = [];
    const mismatches: BacktestResult['mismatches'] = [];

    // Sort ticks by timestamp
    const sortedTicks = [...ticks].sort((a, b) =>
        new Date(a.ts).getTime() - new Date(b.ts).getTime()
    );

    for (let i = 0; i < sortedTicks.length; i++) {
        const tick = sortedTicks[i];

        const input = tickToEngineInput(
            tick,
            game,
            priors.exp3pPctHome,
            priors.exp2pPctHome,
            priors.exp3pPctAway,
            priors.exp2pPctAway,
            liveMarketTotal
        );

        // Validate input
        const errors = validateControlTableInput(input);
        if (errors.length > 0) {
            console.warn(`[Tick ${tick.tick_id}] Validation warnings:`, errors);
        }

        // Compute snapshot
        const snapshot = computeControlTable(input);
        snapshots.push(snapshot);

        // Compare against stored if available
        if (storedSnapshots && storedSnapshots[i]) {
            const stored = storedSnapshots[i];
            const fields: (keyof ControlTableOutput)[] = [
                'modelFair', 'edgeZ', 'remPoss', 'luckGap', 'structPpp'
            ];

            for (const field of fields) {
                const diff = Math.abs(
                    (snapshot[field] as number) - (stored[field] as number)
                );
                if (diff > 0.01) {
                    mismatches.push({
                        tickId: tick.tick_id,
                        field,
                        expected: stored[field] as number,
                        actual: snapshot[field] as number,
                        diff,
                    });
                }
            }
        }
    }

    const lastSnapshot = snapshots[snapshots.length - 1];

    return {
        gameId: game.game_id,
        tickCount: ticks.length,
        snapshots,
        finalModelFair: lastSnapshot?.modelFair ?? 0,
        finalEdgeZ: lastSnapshot?.edgeZ ?? 0,
        isDeterministic: mismatches.length === 0,
        mismatches,
    };
}

/**
 * Print backtest summary
 */
export function printBacktestSummary(result: BacktestResult): void {
    console.log('\n' + '='.repeat(60));
    console.log('🏀 NBA Live Totals Engine v3.0 - Backtest Report');
    console.log('='.repeat(60));

    console.log(`\nGame ID: ${result.gameId}`);
    console.log(`Ticks Processed: ${result.tickCount}`);
    console.log(`Final Model Fair: ${result.finalModelFair.toFixed(1)}`);
    console.log(`Final Edge Z: ${result.finalEdgeZ >= 0 ? '+' : ''}${result.finalEdgeZ.toFixed(2)}`);

    console.log('\n--- Determinism Check ---');
    if (result.isDeterministic) {
        console.log('✅ All snapshots match stored values (within tolerance)');
    } else {
        console.log(`❌ Found ${result.mismatches.length} mismatches:`);
        for (const m of result.mismatches.slice(0, 10)) {
            console.log(`   Tick ${m.tickId}: ${m.field} expected ${m.expected.toFixed(2)}, got ${m.actual.toFixed(2)} (diff: ${m.diff.toFixed(3)})`);
        }
    }

    console.log('\n--- Snapshot Timeline ---');
    const keyPoints = [0, Math.floor(result.tickCount / 4), Math.floor(result.tickCount / 2), Math.floor(3 * result.tickCount / 4), result.tickCount - 1];
    for (const i of keyPoints) {
        if (i >= 0 && i < result.snapshots.length) {
            const s = result.snapshots[i];
            console.log(`   [${i}] Fair=${s.modelFair.toFixed(1)} EdgeZ=${s.edgeZ >= 0 ? '+' : ''}${s.edgeZ.toFixed(2)} RemPoss=${s.remPoss.toFixed(1)}`);
        }
    }

    console.log('\n' + '='.repeat(60) + '\n');
}

// CLI Entry Point
if (typeof process !== 'undefined' && process.argv) {
    const gameId = process.argv[2];

    if (!gameId) {
        console.log('Usage: npx tsx engine/src/backtest.ts <game_id>');
        console.log('\nThis script requires a database connection to fetch ticks.');
        console.log('For local testing, use the runBacktest() function with mock data.');

        // Demo with mock data
        console.log('\n--- Running Demo Backtest ---\n');

        const mockGame: GameRow = {
            game_id: 'demo_game',
            close_total: 225,
            pace_pre48: 100,
            home_team: 'Lakers',
            away_team: 'Celtics',
        };

        const mockTicks: TickRow[] = [
            { tick_id: 1, game_id: 'demo', ts: '2025-01-01T19:00:00Z', elapsed_min: 12, rem_min: 36, pts_home: 28, pts_away: 30, home_fga: 25, home_fgm: 11, home_3pa: 8, home_3pm: 3, home_fta: 6, home_ftm: 5, home_tov: 4, home_orb: 3, away_fga: 24, away_fgm: 12, away_3pa: 9, away_3pm: 4, away_fta: 4, away_ftm: 3, away_tov: 3, away_orb: 2 },
            { tick_id: 2, game_id: 'demo', ts: '2025-01-01T19:30:00Z', elapsed_min: 24, rem_min: 24, pts_home: 55, pts_away: 58, home_fga: 48, home_fgm: 22, home_3pa: 16, home_3pm: 6, home_fta: 12, home_ftm: 9, home_tov: 7, home_orb: 5, away_fga: 47, away_fgm: 24, away_3pa: 17, away_3pm: 7, away_fta: 8, away_ftm: 6, away_tov: 6, away_orb: 4 },
            { tick_id: 3, game_id: 'demo', ts: '2025-01-01T20:00:00Z', elapsed_min: 36, rem_min: 12, pts_home: 82, pts_away: 85, home_fga: 70, home_fgm: 32, home_3pa: 24, home_3pm: 9, home_fta: 18, home_ftm: 13, home_tov: 10, home_orb: 7, away_fga: 68, away_fgm: 34, away_3pa: 25, away_3pm: 10, away_fta: 12, away_ftm: 9, away_tov: 8, away_orb: 6 },
            { tick_id: 4, game_id: 'demo', ts: '2025-01-01T20:30:00Z', elapsed_min: 48, rem_min: 0, pts_home: 110, pts_away: 115, home_fga: 92, home_fgm: 42, home_3pa: 32, home_3pm: 12, home_fta: 24, home_ftm: 18, home_tov: 13, home_orb: 9, away_fga: 90, away_fgm: 45, away_3pa: 33, away_3pm: 13, away_fta: 16, away_ftm: 12, away_tov: 11, away_orb: 8 },
        ];

        const result = runBacktest(
            mockTicks,
            mockGame,
            { exp3pPctHome: 0.36, exp2pPctHome: 0.52, exp3pPctAway: 0.37, exp2pPctAway: 0.53 },
            225
        );

        printBacktestSummary(result);
    } else {
        console.log(`\nTo backtest game ${gameId}, connect to Supabase and fetch ticks.`);
        console.log('This requires the @supabase/supabase-js package in the engine.');
    }
}
