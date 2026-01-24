export default async function handler(req, res) {
    const authHeader = req.headers.get?.('authorization') || req.headers['authorization'];
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    // 50s timeout (leave 10s buffer for Vercel's 60s limit on Hobby)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 50000);

    try {
        console.log("[Vercel-Cron] Triggering Odds Ingestion...");
        const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/ingest-odds`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
                'Content-Type': 'application/json',
                'x-cron-secret': process.env.CRON_SECRET || ''
            },
            body: JSON.stringify({ leagues: ["nba", "nfl", "nhl", "mens-college-basketball", "soccer_epl", "soccer_spain_la_liga", "soccer_italy_serie_a", "tennis_atp_australian_open", "tennis_wta_australian_open"] }),
            signal: controller.signal
        });
        clearTimeout(timeout);

        // Handle non-JSON responses gracefully
        const text = await response.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch {
            console.error("[Vercel-Cron] Non-JSON response:", text.slice(0, 200));
            return res.status(response.status).json({
                error: 'Non-JSON response from Edge Function',
                status: response.status,
                preview: text.slice(0, 200)
            });
        }

        return res.status(response.status).json(data);
    } catch (error) {
        clearTimeout(timeout);
        if (error.name === 'AbortError') {
            console.error("[Vercel-Cron] Timeout after 50s");
            return res.status(504).json({ error: 'Edge Function timeout (50s)' });
        }
        console.error("[Vercel-Cron] Failed:", error);
        return res.status(500).json({ error: error.message });
    }
}
