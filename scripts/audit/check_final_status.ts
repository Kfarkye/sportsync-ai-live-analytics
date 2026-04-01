
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const envContent = fs.readFileSync('.env', 'utf8');
const env: any = {};
envContent.split('\n').forEach(line => {
    const [key, ...value] = line.split('=');
    if (key && value) env[key.trim()] = value.join('=').trim().replace(/"/g, '').replace(/'/g, '');
});

const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.SERVICE_ROLE_KEY;
const SUPABASE_URL = env.VITE_SUPABASE_URL || env.SUPABASE_URL;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function checkFinalStatus() {
    console.log('--- FINAL STATUS CHECK (JAN 13) ---');

    const startOfDay = '2026-01-13T00:00:00Z';
    const endOfDay = '2026-01-14T00:00:00Z';

    // 1. Get Record (Wins/Losses)
    const { data: graded, error } = await supabase
        .from('pregame_intel')
        .select('*')
        .neq('match_id', 'CRON_SENTINEL')
        .neq('pick_result', 'PENDING') // Graded only
        .not('pick_result', 'is', null) // Double check
        .gte('generated_at', startOfDay)
        .lt('generated_at', endOfDay);

    const wins = graded?.filter(i => i.pick_result === 'WIN') || [];
    const losses = graded?.filter(i => i.pick_result === 'LOSS') || [];
    const pushes = graded?.filter(i => i.pick_result === 'PUSH') || [];

    console.log(`\nRECORD: ${wins.length}W - ${losses.length}L - ${pushes.length}P`);

    // 2. Get Remaining Pending
    const { data: pending } = await supabase
        .from('pregame_intel')
        .select('match_id, home_team, away_team, recommended_pick')
        .neq('match_id', 'CRON_SENTINEL')
        .eq('pick_result', 'PENDING')
        .gte('generated_at', startOfDay)
        .lt('generated_at', endOfDay);

    if (pending && pending.length > 0) {
        console.log(`\nREMAINING PENDING (${pending.length}):`);
        pending.forEach(p => {
            const isNFL = p.match_id.includes('_nfl');
            console.log(`${isNFL ? '[PHANTOM NFL] ' : '[VALID? ] '} ${p.away_team} @ ${p.home_team}: ${p.recommended_pick} (${p.match_id})`);
        });
    } else {
        console.log('\nNo pending picks remaining.');
    }
}

checkFinalStatus();
