
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split('\n').filter(l => l.includes('=')).map(l => l.split('=')));
const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
    console.log('Checking for NCAAF matches...');

    // 1. Check matches table
    const { data: matches, error: mErr } = await supabase
        .from('matches')
        .select('*')
        .or('league_id.eq.college-football,league_id.eq.ncaaf')
        .gte('start_time', '2026-01-18T00:00:00Z')
        .lte('start_time', '2026-01-21T00:00:00Z');

    if (mErr) console.error('Matches Error:', mErr);
    else console.log('Matches:', JSON.stringify(matches, null, 2));

    // 2. Check team_game_context (verified schedule source)
    const { data: context, error: cErr } = await supabase
        .from('team_game_context')
        .select('*')
        .gte('game_date', '2026-01-18')
        .lte('game_date', '2026-01-21');

    if (cErr) console.error('Context Error:', cErr);
    else {
        const relevantContext = context?.filter(c =>
            c.team?.toLowerCase().includes('indiana') ||
            c.team?.toLowerCase().includes('miami') ||
            c.opponent?.toLowerCase().includes('indiana') ||
            c.opponent?.toLowerCase().includes('miami')
        );
        console.log('Relevant Context (team_game_context):', JSON.stringify(relevantContext, null, 2));
    }

    // 3. Check pregame_intel table
    const { data: intel, error: iErr } = await supabase
        .from('pregame_intel')
        .select('*')
        .or('match_id.ilike.%indiana%,match_id.ilike.%miami%,match_id.ilike.%ncaaf%');

    if (iErr) console.error('Intel Error:', iErr);
    else console.log('Pregame Intel records found:', intel?.length);
    if (intel && intel.length > 0) {
        console.log('Recent Intel Entries:', JSON.stringify(intel.slice(0, 5), null, 2));
    }
})();
