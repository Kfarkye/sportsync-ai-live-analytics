
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

async function checkIngestTrace() {
    const targetIds = ['401814519_ncaab', '401822897_ncaab', '401822899_ncaab', '401814518_ncaab', '401825439_ncaab', '401830268_ncaab'];
    console.log('--- CHECKING INGEST TRACE ---');
    const { data, error } = await supabase
        .from('pregame_intel')
        .select('match_id, ingest_trace, last_error, generated_at')
        .in('match_id', targetIds);

    if (error) {
        console.error('Fetch Error:', error);
        return;
    }

    data.forEach(i => {
        console.log(`\nMatch: ${i.match_id} | Generated At: ${i.generated_at}`);
        console.log(`Last Error: ${i.last_error}`);
        console.log('Ingest Trace:');
        try {
            const trace = Array.isArray(i.ingest_trace) ? i.ingest_trace : JSON.parse(i.ingest_trace || '[]');
            trace.forEach((t: any) => console.log(`  ${typeof t === 'string' ? t : JSON.stringify(t)}`));
        } catch (e) {
            console.log(`  Raw: ${i.ingest_trace}`);
        }
    });
}

checkIngestTrace();
