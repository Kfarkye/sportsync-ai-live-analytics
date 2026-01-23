export default async function handler(req, res) {
    // 1. SECURITY: Verify Vercel Cron Secret (or CRON_SECRET)
    const authHeader = req.headers.get?.('authorization') || req.headers['authorization'];
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        console.log("[Vercel-Cron] Triggering Pregame Intel Researcher...");
        const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/pregame-intel-cron`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ is_cron: true })
        });

        const data = await response.json();
        return res.status(response.status).json(data);
    } catch (error) {
        console.error("[Vercel-Cron] Failed:", error);
        return res.status(500).json({ error: error.message });
    }
}
