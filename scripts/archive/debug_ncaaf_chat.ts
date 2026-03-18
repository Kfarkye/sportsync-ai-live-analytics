
import fs from 'fs';

// Load env
const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split('\n').filter(l => l.includes('=')).map(l => l.split('=')));
const url = `${env.VITE_SUPABASE_URL}/functions/v1/ai-chat`;
const key = env.SUPABASE_SERVICE_ROLE_KEY;

(async () => {
    console.log('Testing ai-chat endpoint with Streaming NCAAF Championship payload...');

    const payload = {
        messages: [
            { role: 'user', content: 'Tell me about the Miami vs Indiana championship game. Confirm you see it in the verified schedule.' }
        ],
        session_id: 'debug-session-' + Date.now(),
        conversation_id: null,
        current_match: {
            match_id: '401769076_ncaaf',
            home_team: 'Indiana Hoosiers',
            away_team: 'Miami Hurricanes',
            league: 'college-football',
            start_time: '2026-01-20T00:30:00Z'
        }
    };

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key}`
        },
        body: JSON.stringify(payload)
    });

    if (!res.ok) {
        console.error('FAILED:', res.status, await res.text());
        return;
    }

    const reader = res.body?.getReader();
    const decoder = new TextDecoder();
    let fullResponse = "";

    while (true) {
        const { done, value } = await reader?.read() || { done: true, value: undefined };
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter(l => l.trim());

        for (const line of lines) {
            try {
                const data = JSON.parse(line);
                if (data.type === 'text') {
                    process.stdout.write(data.content);
                    fullResponse += data.content;
                } else if (data.type === 'thought') {
                    // console.log('[THOUGHT]', data.content);
                }
            } catch (e) {
                // Not JSON or partial line
            }
        }
    }

    console.log('\n\nFinal Response Length:', fullResponse.length);
})();
