
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

// Load env
const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split('\n').filter(l => l.includes('=')).map(l => l.split('=')));
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

(async () => {
    console.log('Force Triggering Cron to verify fix...');

    // We send is_cron: true to bypass the manual routing and force the discovery logic
    // We send force: true to bypass the 15-minute throttling guard
    const { data, error } = await supabase.functions.invoke('pregame-intel-cron', {
        body: { is_cron: true, force: true }
    });

    if (error) {
        console.error('❌ CRASHED:', error);
    } else {
        console.log('✅ SUCCESS:', JSON.stringify(data, null, 2));
    }
})();
