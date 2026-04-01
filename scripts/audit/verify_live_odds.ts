import { createClient } from '@supabase/supabase-js';

const sb = createClient('https://qffzvrnbzabcokqqrwbv.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUzNTc2NjgsImV4cCI6MjA3MDkzMzY2OH0.PCSnC5E7sG7FvasHy_9DdwiN61xW0GzFROLzZ0bTVnc');

async function verify() {
    const { data: liveMatches } = await sb.from('matches')
        .select('*')
        .or('status.eq.STATUS_IN_PROGRESS,status.eq.IN_PROGRESS')
        .limit(50);

    if (liveMatches && liveMatches.length > 0) {
        console.log('\n--- VERIFYING LIVE SYNC DELTAS ---');
        const now = Date.now();
        liveMatches.forEach(m => {
            const upd = new Date(m.last_odds_update || 0).getTime();
            const deltaSec = Math.round((now - upd) / 1000);
            console.log(`\nGAME: ${m.home_team} vs ${m.away_team} [${m.league_id}]`);
            console.log(`ID: ${m.id} | Canonical: ${m.canonical_id}`);
            console.log(`Status: ${m.status}`);
            console.log(`Last Sync: ${m.last_odds_update} (${deltaSec}s ago)`);
            console.log(`Current Total: ${m.current_odds?.total} (${m.current_odds?.provider})`);
            console.log(`Current Spread: ${m.current_odds?.homeSpread} (${m.current_odds?.provider})`);
        });
    } else {
        console.log('\n--- NO LIVE MATCHES FOUND IN TABLE ---');
    }
}
verify();