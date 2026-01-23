/**
 * DEBUG GRADING ENGINE
 * Manually invokes the grade-picks-cron Edge Function.
 */

const PROJECT_REF = 'qffzvrnbzabcokqqrwbv';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NTM1NzY2OCwiZXhwIjoyMDcwOTMzNjY4fQ.jytFbYNCZVeMOM8dB7CDmfd5kEDkrIyc_eY9lKSrJjk';

async function runGradingAudit() {
    console.log("🚀 [Audit] Triggering Grade Picks Engine...");

    try {
        const response = await fetch(`https://${PROJECT_REF}.supabase.co/functions/v1/grade-picks-cron`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SERVICE_ROLE_KEY}`
            },
            body: JSON.stringify({})
        });

        const result = await response.json();
        console.log("\n📊 [Result] Status:", result.status);
        console.log("✅ [Graded] Count:", result.graded || 0);
        console.log("🏆 [Performance] Wins:", result.wins || 0, "| Losses:", result.losses || 0);

        console.log("\n🔍 [Trace Log]:");
        result.trace?.forEach((line: string) => console.log(`  ${line}`));

    } catch (err: any) {
        console.error("❌ [Fatal] Audit Failed:", err.message);
    }
}

runGradingAudit();
