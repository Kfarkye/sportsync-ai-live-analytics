
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

async function verifyDb() {
    console.log('--- DB STATE VERIFICATION ---');

    // 1. Audit Environment
    const envContent = fs.readFileSync('.env', 'utf8');
    const env: any = {};
    envContent.split('\n').forEach(line => {
        const [key, ...value] = line.split('=');
        if (key && value) env[key.trim()] = value.join('=').trim().replace(/"/g, '').replace(/'/g, '');
    });

    const SUPABASE_URL = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
    const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_SERVICE_ROLE_KEY;

    console.log(`Target URL: ${SUPABASE_URL}`);
    console.log(`Service Key Present: ${!!SERVICE_KEY}`);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const matchId = '401810420_nba'; // Bulls @ Rockets

    console.log(`\nQuerying for match_id: ${matchId}...`);

    const { data, error } = await supabase
        .from('pregame_intel')
        .select('*')
        .eq('match_id', matchId);

    if (error) {
        console.error("❌ QUERY ERROR:", error);
    } else {
        if (data.length === 0) {
            console.log("❌ NO RECORDS FOUND for this match ID.");
        } else {
            console.log(`✅ FOUND ${data.length} RECORD(S):`);
            data.forEach(row => {
                console.log(`- Generated At: ${row.generated_at}`);
                console.log(`- Headline: ${row.headline}`);
                console.log(`- ID: ${row.id || 'N/A'}`); // Assuming there's a PK 'id' or purely match_id
            });
        }
    }
}

verifyDb();
