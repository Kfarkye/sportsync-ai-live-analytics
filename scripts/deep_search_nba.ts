
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

async function deepSearch() {
    console.log('--- DEEP SEARCH FOR NBA TEAMS (JAN 13) ---');

    // Search effectively for any intel involving these teams, regardless of ID or date filter strictness
    const teams = ['Suns', 'Heat', 'Bulls', 'Rockets', 'Bucks', 'Timberwolves', 'Nuggets', 'Pelicans'];

    // We'll broaden the date range slightly just in case of UTC offset issues
    const startRange = '2026-01-12T12:00:00Z';
    const endRange = '2026-01-14T12:00:00Z';

    const { data: matches, error } = await supabase
        .from('pregame_intel')
        .select('*')
        .gte('generated_at', startRange)
        .lt('generated_at', endRange);

    if (error) {
        console.error(error);
        return;
    }

    console.log(`Scanned ${matches?.length} total records.`);

    const found = matches.filter(m => {
        const fullTxt = (m.home_team + m.away_team + m.headline).toUpperCase();
        return teams.some(t => fullTxt.includes(t.toUpperCase()));
    });

    if (found.length === 0) {
        console.log('ZERO matches found containing NBA team names.');
    } else {
        found.forEach(m => {
            console.log(`[FOUND] ${m.away_team} @ ${m.home_team} (ID: ${m.match_id}) - Result: ${m.pick_result}`);
        });
    }
}

deepSearch();
