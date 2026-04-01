
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

async function fixMetadata() {
    console.log('--- BACKFILLING JAN 13 METADATA ---');
    const startOfDay = '2026-01-13T00:00:00Z';
    const endOfDay = '2026-01-14T00:00:00Z';

    const { data: pending, error } = await supabase
        .from('pregame_intel')
        .select('*')
        .neq('match_id', 'CRON_SENTINEL')
        .eq('pick_result', 'PENDING')
        .gte('generated_at', startOfDay)
        .lt('generated_at', endOfDay);

    if (error) {
        console.error('Fetch error:', error);
        return;
    }

    console.log(`Found ${pending.length} pending picks.`);

    for (const p of pending) {
        let side: string | null = null;
        let type: string | null = null;
        let selection: string = p.recommended_pick;

        // 1. Detect Type
        const pickLower = p.recommended_pick.toUpperCase();
        if (pickLower.includes('OVER')) {
            type = 'TOTAL';
            side = 'OVER';
        } else if (pickLower.includes('UNDER')) {
            type = 'TOTAL';
            side = 'UNDER';
        } else if (p.analyzed_spread !== null || /[-+]\d+/.test(p.recommended_pick)) {
            type = 'SPREAD';
        } else {
            type = 'MONEYLINE';
        }

        // 2. Detect Side for SPREAD/MONEYLINE
        if (type === 'SPREAD' || type === 'MONEYLINE') {
            const cleanPick = pickLower.replace(/[^A-Z0-9 ]/g, '');
            const cleanHome = p.home_team.toUpperCase().replace(/[^A-Z0-9 ]/g, '');
            const cleanAway = p.away_team.toUpperCase().replace(/[^A-Z0-9 ]/g, '');

            const homeTokens = cleanHome.split(' ').filter(t => t.length > 2);
            const awayTokens = cleanAway.split(' ').filter(t => t.length > 2);

            // Check full names
            if (pickLower.includes(p.home_team.toUpperCase())) side = 'HOME';
            else if (pickLower.includes(p.away_team.toUpperCase())) side = 'AWAY';
            // Check tokens (e.g. "George" "Mason")
            else if (homeTokens.some(t => cleanPick.includes(t))) side = 'HOME';
            else if (awayTokens.some(t => cleanPick.includes(t))) side = 'AWAY';

            // Special overrides based on known remaining failures
            if (!side) {
                if (p.recommended_pick.includes('Miami (OH)')) {
                    // Find which team is Miami (OH)
                    if (p.home_team.includes('Miami')) side = 'HOME';
                    else if (p.away_team.includes('Miami')) side = 'AWAY';
                }
            }
        }

        if (side && type) {
            const metadata = { side, type, selection };
            console.log(`[FIX] ${p.recommended_pick} -> ${JSON.stringify(metadata)}`);

            const { error: updateError } = await supabase
                .from('pregame_intel')
                .update({ grading_metadata: metadata })
                .eq('match_id', p.match_id);

            if (updateError) console.error(`[ERR] Failed to update ${p.match_id}:`, updateError);
        } else {
            console.log(`[SKIP] Could not resolve ${p.recommended_pick}`);
        }
    }
}

fixMetadata();
