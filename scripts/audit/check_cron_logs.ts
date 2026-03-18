
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const envContent = fs.readFileSync('.env', 'utf8');
const env: any = {};
envContent.split('\n').forEach(line => {
    const [key, ...value] = line.split('=');
    if (key && value) env[key.trim()] = value.join('=').trim().replace(/"/g, '').replace(/'/g, '');
});

const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_URL = env.VITE_SUPABASE_URL || env.SUPABASE_URL;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function checkLogs() {
    console.log('--- CRON LOGS REPORT ---');
    const { data, error } = await supabase
        .from('pregame_intel_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5);

    if (error) {
        console.error('Log Fetch Error:', error);
        return;
    }

    data.forEach(log => {
        console.log(`\nBatch: ${log.batch_id} | Created: ${log.created_at}`);
        console.log(`Succeeded: ${log.matches_succeeded} | Failed: ${log.matches_failed} | Duration: ${log.duration_ms}ms`);
        console.log('Trace:');
        log.trace?.forEach((t: string) => console.log(`  ${t}`));
    });
}

checkLogs();
