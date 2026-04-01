
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

async function gradeMovements() {
    console.log('🎓 Grading Market Movements (Backtesting V2)...');

    // 1. Get Completed Matches with Scores (Lookback 48h)
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    // Check Status AND Scores to be safe
    const { data: matches, error: mErr } = await supabase
        .from('matches')
        .select('*')
        .lt('start_time', new Date().toISOString()) // Started in the past
        .gt('start_time', twoDaysAgo) // Within last 48h
        .not('home_score', 'is', null) // Must have scores
        .not('away_score', 'is', null)
        .order('start_time', { ascending: false });

    if (mErr || !matches || matches.length === 0) {
        console.log('No scored matches found to grade.');
        return;
    }

    console.log(`Found ${matches.length} matches with scores. checking for whales...`);

    let graded = 0;
    const upserts: any[] = [];

    await Promise.all(matches.map(async (m) => {
        const { data: ticks } = await supabase
            .from('market_history')
            .select('*')
            .eq('match_id', m.id)
            .order('ts', { ascending: true });

        const preGame = ticks?.filter(t => !t.is_live);
        if (!preGame || preGame.length < 2) return;

        const first = preGame[0];
        const last = preGame[preGame.length - 1];

        // --- GRADE TOTALS ---
        if (first.total_line && last.total_line) {
            const open = parseFloat(first.total_line);
            const close = parseFloat(last.total_line);
            const delta = close - open;
            const actualTotal = (m.home_score || 0) + (m.away_score || 0);

            if (Math.abs(delta) >= 1.0) {
                let grade = 'PUSH';
                let pickSide = '';

                // If Market moved UP (Steam on Over) -> We bet Over Open
                if (delta > 0) {
                    pickSide = 'OVER';
                    if (actualTotal > open) grade = 'WIN';
                    else if (actualTotal < open) grade = 'LOSS';
                }
                // If Market moved DOWN (Steam on Under) -> We bet Under Open
                else {
                    pickSide = 'UNDER';
                    if (actualTotal < open) grade = 'WIN';
                    else if (actualTotal > open) grade = 'LOSS';
                }

                if (grade !== 'PUSH') {
                    upserts.push({
                        match_id: m.id,
                        market_type: 'TOTAL',
                        open_line: open,
                        closing_line: close,
                        delta: delta,
                        pick_side: pickSide,
                        pick_line: open,
                        home_score: m.home_score,
                        away_score: m.away_score,
                        final_total: actualTotal,
                        grade: grade
                    });
                    graded++;
                }
            }
        }
    }));

    if (upserts.length > 0) {
        // Persist to DB
        // Using upsert with ON CONFLICT (match_id, market_type)
        const { error } = await supabase
            .from('sharp_movements')
            .upsert(upserts, { onConflict: 'match_id,market_type' });

        if (error) console.error('DB Error:', error);
        else console.log(`✅ Saved ${upserts.length} graded plays to 'sharp_movements'.`);

        // Calc Stats
        const wins = upserts.filter(x => x.grade === 'WIN').length;
        const loss = upserts.filter(x => x.grade === 'LOSS').length;
        console.log(`🏆 SESSION RESULT: ${wins}-${loss} (${((wins / upserts.length) * 100).toFixed(1)}%)`);

    } else {
        console.log('No significant moves found to grade.');
    }
}

gradeMovements();
