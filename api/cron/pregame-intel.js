export default async function handler(req, res) {
    // 1. SECURITY: Verify Vercel Cron Secret (or CRON_SECRET)
    const authHeader = req.headers.get?.('authorization') || req.headers['authorization'];
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    // 5s timeout - just waiting for Edge Function to ACK (return 202)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
        console.log("[Vercel-Cron] Triggering Pregame Intel Researcher...");
        const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/pregame-intel-cron`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ is_cron: true }),
            signal: controller.signal
        });
        clearTimeout(timeout);

        // Handle response
        const text = await response.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch {
            console.error("[Vercel-Cron] Non-JSON response:", text.slice(0, 200));
            return res.status(response.status).json({
                error: 'Non-JSON response from Edge Function',
                preview: text.slice(0, 200)
            });
        }

        // 202 = ACCEPTED (background processing started)
        // 200 = THROTTLED or other immediate response
        const accepted = response.status === 202 || data.status === 'ACCEPTED';
        console.log(`[Vercel-Cron] Response: status=${response.status} accepted=${accepted} batchId=${data.batchId || 'N/A'}`);

        return res.status(200).json({
            ok: response.ok,
            accepted,
            status: response.status,
            ...data
        });
    } catch (error) {
        clearTimeout(timeout);
        if (error.name === 'AbortError') {
            console.error("[Vercel-Cron] Timeout waiting for ACK (5s)");
            return res.status(504).json({ error: 'Edge Function ACK timeout (5s)' });
        }
        console.error("[Vercel-Cron] Failed:", error);
        return res.status(500).json({ error: error.message });
    }
}
