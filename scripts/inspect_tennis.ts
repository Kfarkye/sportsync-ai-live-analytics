
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Manual Env Load
try {
    const envPath = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
        const envConfig = fs.readFileSync(envPath, 'utf-8');
        envConfig.split('\n').forEach(line => {
            const [key, ...values] = line.split('=');
            if (key && values.length > 0) {
                const val = values.join('=').trim().replace(/^["']|["']$/g, '');
                if (!process.env[key.trim()]) process.env[key.trim()] = val;
            }
        });
    }
} catch (e) { console.error("Error loading .env", e); }

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(url, key, { auth: { persistSession: false } });

async function main() {
    const { data: tennisMatches } = await supabase.from('matches')
        .select('*')
        .ilike('id', '%tennis%')
        .limit(5);

    console.log("=== TENNIS MATCHES ===");
    console.log(JSON.stringify(tennisMatches, null, 2));

    const { data: tennisIntel } = await supabase.from('pregame_intel')
        .select('*')
        .eq('sport', 'tennis')
        .limit(5);

    console.log("\n=== TENNIS INTEL ===");
    console.log(JSON.stringify(tennisIntel, null, 2));
}

main();
