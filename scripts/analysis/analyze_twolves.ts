
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

// Load env
const envContent = fs.readFileSync('.env', 'utf8');
const env: any = {};
envContent.split('\n').forEach(line => {
    const [key, ...value] = line.split('=');
    if (key && value) env[key.trim()] = value.join('=').trim().replace(/"/g, '').replace(/'/g, '');
});

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY);

async function analyzeSpecificMatch() {
    console.log(`🔍 Auditing Timberwolves/Cavaliers data timestamps...`);

    const { data: matches, error: mErr } = await supabase
        .from('matches')
        .select('*')
        .limit(1000);

    const match = matches?.find(m => {
        const home = JSON.stringify(m.home_team).toLowerCase();
        const away = JSON.stringify(m.away_team).toLowerCase();
        return (home.includes('minnesota') || home.includes('timberwolves')) && (away.includes('cleveland') || away.includes('cavaliers'));
    });

    if (!match) {
        console.log('Match not found.');
        return;
    }

    const startTime = new Date(match.start_time);
    console.log(`Match: ${match.home_team} vs ${match.away_team}`);
    console.log(`Official Start Time: ${startTime.toLocaleString()}`);

    const { data: ticks } = await supabase
        .from('market_history')
        .select('*')
        .eq('match_id', match.id)
        .order('ts', { ascending: true });

    if (!ticks) return;

    console.log(`\n--- CRITICAL WINDOW AUDIT ---`);
    ticks.forEach(t => {
        const tickTime = new Date(t.ts);
        const diffMinutes = (tickTime.getTime() - startTime.getTime()) / 60000;

        if (Math.abs(diffMinutes) < 180) { // Look at 3 hours around start time
            const status = diffMinutes < 0 ? 'PRE-GAME' : 'LIVE (CLOCK)';
            const taggedAs = t.is_live ? 'LIVE' : 'PRE';

            console.log(`[${tickTime.toLocaleTimeString()}] ID:${t.id} | T${diffMinutes > 0 ? '+' : ''}${diffMinutes.toFixed(1)}m | Total: ${t.total_line} | Tagged: ${taggedAs} | Actual: ${status}`);
        }
    });

    console.log(`\n--- SUMMARY ---`);
    const pre = ticks.filter(t => !t.is_live);
    if (pre.length > 0) {
        console.log(`Last Pre-Game Tick: ${pre[pre.length - 1].total_line} (ID: ${pre[pre.length - 1].id})`);
    }
}

analyzeSpecificMatch();
