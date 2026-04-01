
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

async function debugWorker() {
    console.log('🏀 [DEBUG-WORKER] Starting Fresh Generation for Cleveland @ Philadelphia...');

    const envContent = fs.readFileSync('.env', 'utf8');
    const env: any = {};
    envContent.split('\n').forEach(line => {
        const [key, ...value] = line.split('=');
        if (key && value) env[key.trim()] = value.join('=').trim().replace(/"/g, '').replace(/'/g, '');
    });

    const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.SERVICE_ROLE_KEY;
    const SUPABASE_URL = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const matchId = '401810427_nba';

    // 1. CLEAR OLD DATA
    console.log(`🗑  Cleaning up any old intel for ${matchId}...`);
    await supabase.from('pregame_intel').delete().eq('match_id', matchId);

    // 2. INVOKE WORKER
    console.log(`🚀 Invoking 'pregame-intel-worker' for ${matchId}...`);
    const startTime = Date.now();

    const { data, error } = await supabase.functions.invoke('pregame-intel-worker', {
        body: {
            match_id: matchId,
            league: 'nba',
            sport: 'basketball',
            trigger_source: "debug_script"
        }
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    if (error) {
        console.error(`❌ [ERROR] Worker failed after ${duration}s:`, error);
        return;
    }

    console.log(`✅ [SUCCESS] Worker responded in ${duration}s.`);
    console.log(`📝 [HEADLINE] ${data.headline}`);

    // 3. VERIFY PERSISTENCE
    console.log('\n🔍 [VERIFICATION] Checking database...');
    const { data: row } = await supabase
        .from('pregame_intel')
        .select('*')
        .eq('match_id', matchId)
        .order('generated_at', { ascending: false })
        .limit(1)
        .single();

    if (row) {
        console.log(`💎 [DATABASE_RECORD_FOUND]`);
        console.log(`   - Generated At: ${row.generated_at}`);
        console.log(`   - Logic: ${row.logic_authority}`);
    } else {
        console.error(`❌ [VERIFICATION_FAILED] No record found in 'pregame_intel' table.`);
    }
}

debugWorker();
