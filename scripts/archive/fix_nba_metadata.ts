
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

async function fixNBAMetadata() {
    console.log('--- FIXING PENDING NBA METADATA ---');
    const startRange = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // Last 24h

    const { data: pending, error } = await supabase
        .from('pregame_intel')
        .select('*')
        .ilike('match_id', '%_nba')
        .in('pick_result', ['PENDING', 'NO_PICK'])
        .gte('generated_at', startRange);

    if (error) {
        console.error('Fetch error:', error);
        return;
    }

    console.log(`Found ${pending.length} NBA picks (PENDING or NO_PICK).`);

    for (const p of pending) {
        let side: string | null = null;
        let type: string | null = null;
        let selection: string = p.recommended_pick;

        // SKIP LOGIC if grading_metadata already exists and pick_result is not NO_PICK
        // Actually, if it's NO_PICK, it might be because metadata was missing, so we should always retry metadata generation.

        // 1. Detect Type
        if (!p.recommended_pick) {
            console.log(`[SKIP] No recommended_pick for ${p.match_id}`);
            continue;
        }

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
            // Check tokens
            else if (homeTokens.some(t => cleanPick.includes(t))) side = 'HOME';
            else if (awayTokens.some(t => cleanPick.includes(t))) side = 'AWAY';
        }

        if (side && type) {
            const metadata = { side, type, selection };
            console.log(`[FIX] ${p.recommended_pick} -> ${JSON.stringify(metadata)}`);

            const { error: updateError } = await supabase
                .from('pregame_intel')
                .update({
                    grading_metadata: metadata,
                    pick_result: 'PENDING' // Reset so it gets graded
                })
                .eq('match_id', p.match_id);

            if (updateError) console.error(`[ERR] Failed to update ${p.match_id}:`, updateError);
        } else {
            console.log(`[SKIP] Could not resolve ${p.recommended_pick}`);
        }
    }
}

fixNBAMetadata();
