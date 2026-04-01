
// scripts/test_simulation.ts
import { createClient } from '@supabase/supabase-js';
import { TelemetryEngine, OddsTick } from '../supabase/functions/_shared/telemetry_core.ts';
import fs from 'fs';

// 1. Setup Environment
const envContent = fs.readFileSync('.env', 'utf8');
const env: any = {};
envContent.split('\n').forEach(line => {
    const [key, ...value] = line.split('=');
    if (key && value) env[key.trim()] = value.join('=').trim().replace(/"/g, '').replace(/'/g, '');
});

const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_URL = env.VITE_SUPABASE_URL || env.SUPABASE_URL;

console.log('Loaded Keys:', Object.keys(env));
if (!SERVICE_KEY || !SUPABASE_URL) {
    console.error('Missing Env Vars. ServiceKey:', !!SERVICE_KEY, 'URL:', !!SUPABASE_URL);
    process.exit(1);
}

const engine = new TelemetryEngine(SUPABASE_URL, SERVICE_KEY);
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const GAME_ID = 'SIM_GAME_001';

async function runSimulation() {
    console.log('🧪 Starting Telemetry Simulation: "The Leader & The Follower"');

    // Clean up previous runs
    await supabase.from('raw_odds_log').delete().eq('game_id', GAME_ID);
    await supabase.from('live_market_state').delete().eq('game_id', GAME_ID);
    await supabase.from('derived_consensus_log').delete().eq('game_id', GAME_ID);

    try {
        // T0: Initial State (Both at -3.0)
        console.log('[T0] Initializing Market...');
        const t0 = new Date().toISOString();
        await engine.ingestTick(mkTick('BookA', -3.0, -110, t0));
        await engine.ingestTick(mkTick('BookB', -3.0, -110, t0));

        // Assert Consensus is -3.0
        let c = await getConsensus();
        console.log(`[T0] Consensus: ${c?.consensus_line} (Expected -3)`);

        // T1: Leader Moves (Book A to -5.0)
        console.log('[T1] Leader (Book A) Moves to -5.0...');
        const t1 = new Date(Date.now() + 5000).toISOString(); // +5s
        await engine.ingestTick(mkTick('BookA', -5.0, -110, t1));

        // Median of [-5.0, -3.0] -> -4.0 (Average)
        c = await getConsensus();
        console.log(`[T1] Consensus: ${c?.consensus_line} (Expected -4)`);

        // T2: Follower Moves (Book B to -5.0)
        console.log('[T2] Follower (Book B) Moves to -5.0...');
        const t2 = new Date(Date.now() + 10000).toISOString(); // +10s
        await engine.ingestTick(mkTick('BookB', -5.0, -110, t2));

        // Median of [-5.0, -5.0] -> -5.0
        c = await getConsensus();
        console.log(`[T2] Consensus: ${c?.consensus_line} (Expected -5)`);

        // 3. Verify Ledger
        const { count } = await supabase
            .from('derived_consensus_log')
            .select('*', { count: 'exact', head: true })
            .eq('game_id', GAME_ID);

        console.log(`\n✅ Simulation Complete. Consensus Events Logged: ${count}`);

        if (count && count >= 3) {
            console.log('SUCCESS: System captured all market shifts.');
        } else {
            console.error('FAILURE: Missing consensus events.');
        }

    } catch (e) {
        console.error('Simulation Failed:', e);
    }
}

function mkTick(book: string, line: number, price: number, ts: string): OddsTick {
    return {
        game_id: GAME_ID,
        sport: 'test_sport',
        market: 'spreads',
        side: 'home',
        book,
        line,
        price,
        ts
    };
}

async function getConsensus() {
    const { data } = await supabase
        .from('derived_consensus_log')
        .select('*')
        .eq('game_id', GAME_ID)
        .order('ts', { ascending: false })
        .limit(1)
        .single();
    return data;
}

runSimulation();
