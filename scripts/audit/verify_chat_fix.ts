
import fs from 'fs';

// Load env
const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split('\n').filter(l => l.includes('=')).map(l => l.split('=')));
const url = `${env.VITE_SUPABASE_URL}/functions/v1/ai-chat`;
const key = env.SUPABASE_SERVICE_ROLE_KEY;

(async () => {
    console.log('Verifying ai-chat fix (Non-streaming)...');

    const payload = {
        messages: [
            { role: 'user', content: 'Tell me about the Miami vs Indiana championship game. Confirm you see it in the verified schedule context.' }
        ],
        session_id: 'verify-session-' + Date.now(),
        conversation_id: null,
        current_match: {
            match_id: '401769076_ncaaf',
            home_team: 'Indiana Hoosiers',
            away_team: 'Miami Hurricanes',
            league: 'college-football',
            start_time: '2026-01-20T00:30:00Z'
        }
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${key}`
            },
            body: JSON.stringify(payload),
            signal: controller.signal
        });

        clearTimeout(timeout);

        if (!res.ok) {
            console.error('FAILED:', res.status, await res.text());
            return;
        }

        // The response might still be a stream since ai-chat is designed for streaming.
        // If it's a stream, we'll read it fully here.
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
                        fullResponse += data.content;
                    }
                } catch (e) { }
            }
        }

        console.log('Verification Response:');
        console.log('--------------------');
        console.log(fullResponse);
        console.log('--------------------');

        if (fullResponse.toLowerCase().includes('miami') && fullResponse.toLowerCase().includes('indiana')) {
            console.log('SUCCESS: AI recognized the matchup.');
        } else {
            console.log('WARNING: AI response seems incomplete or missing team names.');
        }

    } catch (e: any) {
        console.error('VERIFICATION ERROR:', e.message);
    }
})();
