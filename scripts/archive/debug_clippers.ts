import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

const envContent = fs.readFileSync('.env', 'utf8');
const env: Record<string, string> = {};
envContent.split('\n').forEach(line => {
    const [key, ...value] = line.split('=');
    if (key && value) env[key.trim()] = value.join('=').trim().replace(/"/g, '').replace(/'/g, '');
});
const sb = createClient(env.VITE_SUPABASE_URL!, env.VITE_SUPABASE_SERVICE_ROLE_KEY!);

async function check() {
    // Find NBA games
    const { data: matches } = await sb.from('matches')
        .select('id, status, current_odds, opening_odds, closing_odds, last_odds_update, home_team, away_team')
        .eq('league_id', 'nba')
        .gte('start_time', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order('start_time', { ascending: false })
        .limit(20);

    const clippersGame = matches?.find(m =>
        JSON.stringify(m).toLowerCase().includes('clipper') ||
        JSON.stringify(m).toLowerCase().includes('piston')
    );

    if (clippersGame) {
        console.log('=== CLIPPERS VS PISTONS GAME ===');
        console.log('Match ID:', clippersGame.id);
        console.log('Status:', clippersGame.status);
        console.log('Last Update:', clippersGame.last_odds_update);
        console.log('--- CURRENT ODDS ---');
        console.log('Total:', (clippersGame.current_odds as any)?.total);
        console.log('isLive:', (clippersGame.current_odds as any)?.isLive);
        console.log('Full current_odds:', JSON.stringify(clippersGame.current_odds, null, 2));
        console.log('--- OPENING ODDS ---');
        console.log('Total:', (clippersGame.opening_odds as any)?.total);
    } else {
        console.log('No Clippers/Pistons game found');
        console.log('Sample games:', matches?.slice(0, 3).map(m => ({ id: m.id, home: m.home_team, away: m.away_team })));
    }

    // Also check market_feeds
    const { data: feeds } = await sb.from('market_feeds')
        .select('external_id, best_total, is_live, last_updated')
        .eq('sport_key', 'basketball_nba')
        .order('last_updated', { ascending: false })
        .limit(5);

    console.log('\n=== LATEST MARKET_FEEDS ===');
    feeds?.forEach(f => {
        console.log('ID:', f.external_id, 'Total:', (f.best_total as any)?.over?.point, 'isLive:', f.is_live, 'Updated:', f.last_updated);
    });
}
check();
