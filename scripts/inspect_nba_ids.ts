
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

async function checkIds() {
    console.log('--- CHECKING NBA IDS ---');
    const ids = [
        '401810384_nba', // The one with Heat -4.5
        '401810419_nba', // Suns @ Heat from deep search
        '401810427_nba', // 76ers -1.5
        '401810421_nba', // Wolves @ Bucks
        '401810420_nba'  // Bulls @ Rockets
    ];

    const { data, error } = await supabase
        .from('pregame_intel')
        .select('match_id, home_team, away_team, generated_at, recommended_pick, pick_result')
        .in('match_id', ids);

    if (error) {
        console.error(error);
        return;
    }

    data.forEach(m => {
        console.log(`\nID: ${m.match_id}`);
        console.log(`Match: ${m.away_team} @ ${m.home_team}`);
        console.log(`Generated: ${m.generated_at}`);
        console.log(`Pick: ${m.recommended_pick}`);
        console.log(`Result: ${m.pick_result}`);
    });
}

checkIds();
