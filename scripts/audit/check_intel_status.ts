
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const envContent = fs.readFileSync('.env', 'utf8');
const env: any = {};
envContent.split('\n').forEach(line => {
    const [key, ...value] = line.split('=');
    if (key && value) env[key.trim()] = value.join('=').trim().replace(/"/g, '').replace(/'/g, '');
});

const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_URL = env.VITE_SUPABASE_URL || env.SUPABASE_URL;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function checkIntel() {
    const now = new Date().toISOString();
    console.log('--- INTEL STATUS REPORT ---');
    console.log('Time:', now);

    // 1. Fetch upcoming matches
    const { data: matches, error: mErr } = await supabase
        .from('matches')
        .select('id, home_team, away_team, start_time, league_id, sport')
        .gte('start_time', now)
        .order('start_time', { ascending: true })
        .limit(20);

    if (mErr) {
        console.error('Match Fetch Error:', mErr);
        return;
    }

    if (!matches || matches.length === 0) {
        console.log('No upcoming matches found.');
        return;
    }

    // 2. Fetch existing intel for these matches
    const matchIds = matches.map(m => m.id);
    const { data: intel, error: iErr } = await supabase
        .from('pregame_intel')
        .select('match_id, generated_at, headline')
        .in('match_id', matchIds);

    if (iErr) {
        console.error('Intel Fetch Error:', iErr);
    }

    const intelMap = new Map(intel?.map(i => [i.match_id, i]));

    console.table(matches.map(m => {
        const i = intelMap.get(m.id);
        return {
            id: m.id,
            league: m.league_id,
            teams: `${m.away_team} @ ${m.home_team}`,
            start: m.start_time,
            has_intel: i ? '✅ YES' : '❌ NO',
            intel_headline: i?.headline || 'N/A'
        };
    }));

    // 3. Specifically check NCAAB
    const { count: ncaabCount } = await supabase
        .from('matches')
        .select('*', { count: 'exact', head: true })
        .eq('league_id', 'mens-college-basketball')
        .gte('start_time', now);

    console.log(`\nUpcoming NCAAB matches: ${ncaabCount}`);
}

checkIntel();
