/**
 * TRIGGER REFRESH
 * Forces the pre-game cron to run once. 
 * This should catch the [VOLATILE] games and generate NEW intel for them.
 */

const PROJECT_REF = 'qffzvrnbzabcokqqrwbv';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NTM1NzY2OCwiZXhwIjoyMDcwOTMzNjY4fQ.jytFbYNCZVeMOM8dB7CDmfd5kEDkrIyc_eY9lKSrJjk';

async function triggerCron() {
    console.log("🌪️ [Action] Triggering Pregame Intel Cron (Discovery Mode)...");

    try {
        const response = await fetch(`https://${PROJECT_REF}.supabase.co/functions/v1/pregame-intel-cron`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SERVICE_ROLE_KEY}`
            },
            body: JSON.stringify({ is_cron: true })
        });

        const result = await response.json();
        console.log("\n🛰️ [Cron Result]:", result.status);
        console.log("📝 [Matches Found]:", result.found);
        console.log("⚡ [Priority Match]:", result.queue?.length || 0, "games queued for refresh.");

        console.log("\n🚀 [Success] The Volatile games are being re-analyzed in the background.");
        console.log("⏳ Wait ~20 seconds, then run 'npx tsx scripts/debug_volatility.ts' again to see the results.");

    } catch (err: any) {
        console.error("❌ [Error]:", err.message);
    }
}

triggerCron();
