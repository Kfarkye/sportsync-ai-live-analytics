
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

async function checkIntel() {
    const { data: intel, error } = await supabase
        .from('pregame_intel')
        .select('*')
        .eq('match_id', '401810430_nba')
        .single();

    if (error) {
        console.error(error);
        return;
    }

    console.log('--- Current Intel Keys ---');
    console.log(Object.keys(intel));
    console.log('--- Full Object ---');
    console.log(intel);
}

checkIntel();
