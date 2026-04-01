
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

// Load env
const envContent = fs.readFileSync('.env', 'utf8');
const env: any = {};
envContent.split('\n').forEach(line => {
    const [key, ...value] = line.split('=');
    if (key && value) env[key.trim()] = value.join('=').trim().replace(/"/g, '');
});

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY);

async function findHeavyMovement() {
    console.log('🔍 Analyzing "Final" (Completed) Games for historical volatility...');

    // 1. Get ONLY matches that have started and likely finished (older than 3 hours)
    // Adjust logic: Fetch matches with start_time < (now - 3h)
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

    const { data: matches, error: mErr } = await supabase
        .from('matches')
        .select('id, start_time, home_team, away_team, sport')
        .lt('start_time', threeHoursAgo)
        .order('start_time', { ascending: false })
        .limit(50); // Analyze last 50 finished games

    if (mErr || !matches || matches.length === 0) {
        console.log('No finished matches found or error:', mErr);
        return;
    }

    console.log(`Found ${matches.length} finished matches. Scanning ledger...`);

    const movements: any[] = [];

    await Promise.all(matches.map(async (match) => {
        // Get all history for this match
        const { data: ticks } = await supabase
            .from('market_history')
            .select('*')
            .eq('match_id', match.id)
            .order('ts', { ascending: true });

        // STRICT: Only look at Pre-Game ticks
        const preGameTicks = ticks?.filter(t => !t.is_live);

        if (!preGameTicks || preGameTicks.length < 2) return;

        const first = preGameTicks[0];
        const last = preGameTicks[preGameTicks.length - 1];

        if (first.total_line && last.total_line) {
            const delta = Math.abs(parseFloat(first.total_line) - parseFloat(last.total_line));
            if (delta >= 1.0) {
                movements.push({
                    matchId: match.id,
                    type: 'TOTAL',
                    delta,
                    first: first.total_line,
                    last: last.total_line,
                    ticks: preGameTicks.length,
                    sport: match.sport,
                    home: match.home_team,
                    away: match.away_team,
                    date: match.start_time
                });
            }
        }

        if (first.home_spread && last.home_spread) {
            const delta = Math.abs(parseFloat(first.home_spread) - parseFloat(last.home_spread));
            if (delta >= 1.0) {
                movements.push({
                    matchId: match.id,
                    type: 'SPREAD',
                    delta,
                    first: first.home_spread,
                    last: last.home_spread,
                    ticks: preGameTicks.length,
                    sport: match.sport,
                    home: match.home_team,
                    away: match.away_team,
                    date: match.start_time
                });
            }
        }
    }));

    if (movements.length === 0) {
        console.log('No significant movement found in the last 50 finished games.');
    } else {
        movements.sort((a, b) => b.delta - a.delta);
        const top10 = movements.slice(0, 10);

        console.log(`\n✅ TOP MOVERS FROM FINAL/COMPLETED GAMES:`);
        top10.forEach(m => {
            console.log(`--------------------------------------------------`);
            console.log(`Match: ${m.home} vs ${m.away} (${m.sport})`);
            console.log(`Date: ${new Date(m.date).toLocaleString()}`);
            console.log(`Type: ${m.type} Move`);
            if (m.delta >= 5) console.log(`🚀 WHALE ALERT: This game moved ${m.delta} points!`);
            console.log(`Movement: ${m.delta} points (from ${m.first} to ${m.last})`);
            console.log(`Resolution: ${m.ticks} pre-game updates tracked`);
        });
    }
}

findHeavyMovement();
