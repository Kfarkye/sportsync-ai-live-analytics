
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

// Load env
const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split('\n').filter(l => l.includes('=')).map(l => l.split('=')));
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

(async () => {
    console.log('Testing ai-chat endpoint...');

    // Payload mimicking a real user request
    const payload = {
        messages: [
            { role: 'user', content: 'Who is favored in the Oregon vs Indiana game?' }
        ],
        session_id: 'debug-session-' + Date.now(),
        conversation_id: null,
        current_match: {
            id: '401769074',
            home_team_name: 'Indiana Hoosiers',
            away_team_name: 'Oregon Ducks',
            start_time: '2026-01-09T00:30:00Z'
        }
    };

    const start = Date.now();
    const { data, error } = await supabase.functions.invoke('ai-chat', {
        body: payload,
        headers: { 'x-trace-id': 'debug-chat-001' }
    });

    const duration = Date.now() - start;
    console.log(`Duration: ${duration}ms`);

    if (error) {
        console.error('FAILED:', error);
        if (error.context) console.error('Context:', await error.context.text());
    } else {
        console.log('SUCCESS:', data);
    }
})();
