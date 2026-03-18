
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Load env files
const loadEnv = (filePath: string) => {
    try {
        const fullPath = path.resolve(process.cwd(), filePath);
        if (fs.existsSync(fullPath)) {
            const envConfig = fs.readFileSync(fullPath, 'utf8');
            envConfig.split('\n').forEach(line => {
                const parts = line.split('=');
                if (parts.length >= 2) {
                    const key = parts[0].trim();
                    const value = parts.slice(1).join('=').trim().replace(/"/g, '');
                    if (key && !key.startsWith('#')) {
                        process.env[key] = value;
                    }
                }
            });
        }
    } catch (e) {
        console.log(`Failed to load ${filePath}`);
    }
};

loadEnv('.env');
loadEnv('.env.local');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/pregame-intel`;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function regenerateIntel() {
    console.log('🔍 Searching for Nuggets vs Mavericks match...');
    console.log(`Using Supabase URL: ${SUPABASE_URL}`);

    // Find the match
    const { data: matches, error } = await supabase
        .from('matches')
        .select('id, home_team, away_team, start_time, league_id')
        .gt('start_time', new Date().toISOString())
        .limit(1000);

    if (error) {
        console.error('❌ Match lookup failed:', error);
        return;
    }

    console.log(`DEBUG: Found ${matches?.length} future matches.`);

    const match = matches?.find(m => {
        const h = String(m.home_team).toLowerCase();
        const a = String(m.away_team).toLowerCase();

        // Match Nuggets vs Mavericks
        const isMavs = h.includes('maverick') || a.includes('maverick') || h.includes('dallas') || a.includes('dallas');
        const isNuggets = h.includes('nugget') || a.includes('nugget') || h.includes('denver') || a.includes('denver');

        return isMavs && isNuggets;
    });

    if (!match) {
        console.error('❌ No exact match for Mavericks found in future games.');
        return;
    }

    console.log(`✅ Found Match: ${match.home_team} vs ${match.away_team} (ID: ${match.id})`);

    // Delete existing intel to force regeneration
    console.log('🗑️  Deleting existing pregame_intel row to flush cache...');
    const { error: delError } = await supabase
        .from('pregame_intel')
        .delete()
        .eq('match_id', match.id);

    if (delError) {
        console.error('⚠️  Error deleting intel:', delError);
    } else {
        console.log('✨ Cache flushed successfully.');
    }

    // Invoke the Edge Function
    console.log('🚀 Triggering Intel Generation...');

    // Construct payload
    const payload = {
        match_id: match.id,
        league: 'nba',
        sport: 'basketball',
        home_team: match.home_team,
        away_team: match.away_team,
        start_time: match.start_time
    };

    try {
        const response = await fetch(FUNCTION_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
            },
            body: JSON.stringify(payload)
        });

        // Try to parse JSON, but handle text if error
        const text = await response.text();
        let result;
        try {
            result = JSON.parse(text);
        } catch (e) {
            result = { error: 'Invalid JSON', raw: text };
        }

        if (response.ok) {
            console.log('\n✅ INTEL REGENERATED SUCCESSFULLY!');
            console.log('-----------------------------------');
            console.log('Recommended Pick:', result.recommended_pick);
            console.log('Thesis:', result.thesis);
            console.log('-----------------------------------');
        } else {
            console.error('❌ Function Error:', result);
        }

    } catch (err) {
        console.error('❌ Invocation Failed:', err);
    }
}

regenerateIntel();
