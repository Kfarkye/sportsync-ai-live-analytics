
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

async function forensicTest() {
    console.log('--- FORENSIC RLS DIAGNOSTIC ---');

    // 1. Audit Environment
    const envContent = fs.readFileSync('.env', 'utf8');
    const env: any = {};
    envContent.split('\n').forEach(line => {
        const [key, ...value] = line.split('=');
        if (key && value) env[key.trim()] = value.join('=').trim().replace(/"/g, '').replace(/'/g, '');
    });

    const hasServiceKey = !!(env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.SERVICE_ROLE_KEY);
    const hasAnonKey = !!(env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY);

    console.log('Environment Audit:');
    console.log(`- SUPABASE_URL: ${env.VITE_SUPABASE_URL || env.SUPABASE_URL ? '✅ OK' : '❌ MISSING'}`);
    console.log(`- SERVICE_ROLE_KEY: ${hasServiceKey ? '✅ FOUND' : '⚠️ MISSING (Critical for bypassing RLS)'}`);
    console.log(`- ANON_KEY: ${hasAnonKey ? '✅ FOUND' : '❌ MISSING'}`);

    const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
    const SUPABASE_URL = env.VITE_SUPABASE_URL || env.SUPABASE_URL;

    if (!SERVICE_KEY) {
        console.error('CRITICAL: No Supabase key found in .env. Exiting.');
        return;
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // 2. Test Connection & Determine Identity
    console.log('\nIdentity Audit:');
    const { data: profile, error: pErr } = await supabase.from('pregame_intel_log').select('log_id').limit(1);
    if (pErr) {
        console.log(`- Access to pregame_intel_log: ❌ FAILED (${pErr.code} - ${pErr.message})`);
    } else {
        console.log('- Access to pregame_intel_log: ✅ GRANTED (Likely Service Role or High Privilege)');
    }

    // 3. Perform Targeted Write Test
    console.log('\nWrite Audit (pregame_intel):');
    const testId = 'DIAG_TEST_' + Date.now();
    const testDossier = {
        match_id: testId,
        game_date: new Date().toISOString().split('T')[0],
        headline: 'DIAGNOSTIC TEST',
        generated_at: new Date().toISOString(),
        sport: 'SYSTEM',
        league_id: 'SYSTEM',
        home_team: 'SYSTEM',
        away_team: 'SYSTEM',
        briefing: 'Forensic diagnostic active.',
        cards: [{ title: 'Diagnostic', body: 'Constraint Satisfied', category: 'SYSTEM' }],
        freshness: 'LIVE'
    };

    const { data, error } = await supabase
        .from('pregame_intel')
        .insert(testDossier)
        .select();

    if (error) {
        console.error(`- INSERT Result: ❌ FAILED (${error.code})`);
        console.error(`- Error Details: ${JSON.stringify(error, null, 2)}`);

        if (error.code === '42501') {
            console.log('\n--- ROOT CAUSE IDENTIFIED: RLS BLOCK ---');
            console.log('The current key used does NOT have permission to insert into pregame_intel.');
            if (!hasServiceKey) {
                console.log('ADVICE: You are using an ANON key. Add SUPABASE_SERVICE_ROLE_KEY to your .env to bypass RLS.');
            } else {
                console.log('ADVICE: You ARE using a service key but RLS is still blocking it. This implies FORCE ROW LEVEL SECURITY might be enabled on the table without a service_role policy.');
            }
        }
    } else {
        console.log('- INSERT Result: ✅ SUCCESS');
        // Cleanup
        await supabase.from('pregame_intel').delete().eq('match_id', testId);
    }
}

forensicTest();
