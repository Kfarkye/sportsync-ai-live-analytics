
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
    } catch (e) { }
};

loadEnv('.env');
loadEnv('.env.local');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function runRescue() {
    console.log('🛡️ Starting DB Rescue Operations...');

    // 1. UPDATE MAVERICKS SPECIFIC RECORD
    // User confirmed line is -1. Previous picks favored Denver.
    // Recommended selection was Dallas Mavericks.
    // So if line is Denver -1, then it's Dallas +1.
    console.log('🏀 Updating Nuggets vs Mavericks (Dallas Mavericks +1)...');
    const { error: mavsError } = await supabase
        .from('pregame_intel')
        .update({
            analyzed_spread: 1.0, // Mavs are the recommended side, catching 1 point
            recommended_pick: 'Dallas Mavericks +1',
            grading_metadata: { side: 'HOME', type: 'SPREAD', selection: 'Dallas Mavericks' }
        })
        .eq('match_id', '401810430_nba');

    if (mavsError) console.error('❌ Error updating Mavs:', mavsError);
    else console.log('✅ Mavs Intel updated to Dallas Mavericks +1');

    // 2. GLOBAL BACKFILL
    console.log('🔍 Scanning for other picks with missing analyzed_spread...');
    const { data: pending, error: fetchErr } = await supabase
        .from('pregame_intel')
        .select('intel_id, recommended_pick, match_id')
        .is('analyzed_spread', null)
        .eq('pick_result', 'PENDING');

    if (fetchErr) {
        console.error('❌ Error fetching pending:', fetchErr);
        return;
    }

    console.log(`📡 Found ${pending?.length || 0} records to rescue.`);

    for (const pick of (pending || [])) {
        if (!pick.recommended_pick) continue;

        const match = pick.recommended_pick.match(/([+-]?\d+\.?\d*)/);
        if (match) {
            const line = parseFloat(match[0]);
            console.log(`♻️  Rescuing ${pick.match_id}: Found line ${line} in "${pick.recommended_pick}"`);

            await supabase
                .from('pregame_intel')
                .update({ analyzed_spread: line })
                .eq('intel_id', pick.intel_id);
        }
    }

    console.log('✨ Rescue Mission Complete.');
}

runRescue();
