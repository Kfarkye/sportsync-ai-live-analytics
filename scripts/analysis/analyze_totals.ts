
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

// Load env
const envContent = fs.readFileSync('.env', 'utf8');
const env: any = {};
envContent.split('\n').forEach(line => {
    const [key, ...value] = line.split('=');
    if (key && value) env[key.trim()] = value.join('=').trim().replace(/"/g, '').replace(/'/g, '');
});

const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.SERVICE_ROLE_KEY;
const supabase = createClient(env.VITE_SUPABASE_URL, SERVICE_KEY || env.VITE_SUPABASE_ANON_KEY);

async function analyzeTotals() {
    console.log('📊 Analyzing Totals (Over/Under) Performance...');

    const { data: moves, error } = await supabase
        .from('sharp_movements')
        .select('*')
        .eq('market_type', 'TOTAL');

    if (error) {
        console.error('Error:', error);
        return;
    }

    if (!moves || moves.length === 0) {
        console.log('No Totals found.');
        return;
    }

    const wins = moves.filter(m => m.grade === 'WIN').length;
    const losses = moves.filter(m => m.grade === 'LOSS').length;
    const pushes = moves.filter(m => m.grade === 'PUSH').length;
    const total = wins + losses;

    const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0';

    console.log(`\n🥅 TOTALS REPORT CARD`);
    console.log(`-----------------------`);
    console.log(`Record: ${wins}-${losses}-${pushes}`);
    console.log(`Win Rate: ${winRate}%`);
    console.log(`Volume: ${moves.length} plays`);

    // Breakdown by Over vs Under
    const overs = moves.filter(m => m.pick_side === 'OVER');
    const unders = moves.filter(m => m.pick_side === 'UNDER');

    const overWins = overs.filter(m => m.grade === 'WIN').length;
    const underWins = unders.filter(m => m.grade === 'WIN').length;

    console.log(`\nBreakdown:`);
    console.log(`📈 OVERS: ${overWins}-${overs.length - overWins} (${overs.length > 0 ? ((overWins / overs.length) * 100).toFixed(0) : 0}%)`);
    console.log(`📉 UNDERS: ${underWins}-${unders.length - underWins} (${unders.length > 0 ? ((underWins / unders.length) * 100).toFixed(0) : 0}%)`);
}

analyzeTotals();
