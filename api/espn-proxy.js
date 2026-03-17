const API_BASE = "https://site.api.espn.com/apis/site/v2/sports";
const ENDPOINT_RE = /^[a-z0-9._/-]+(?:\?[a-z0-9._~%=&:-]*)?$/i;

function withTimestamp(url) {
    return url.includes("?") ? `${url}&_t=${Date.now()}` : `${url}?_t=${Date.now()}`;
}

export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    const rawEndpoint = typeof req.query?.endpoint === "string" ? req.query.endpoint : "";
    const cleanEndpoint = rawEndpoint.trim().replace(/^\/+/, "");

    if (!cleanEndpoint) {
        return res.status(400).json({ error: "Missing endpoint" });
    }

    if (cleanEndpoint.includes("://") || !ENDPOINT_RE.test(cleanEndpoint)) {
        return res.status(400).json({ error: "Invalid endpoint" });
    }

    const targetUrl = withTimestamp(`${API_BASE}/${cleanEndpoint}`);

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4500);
        const upstream = await fetch(targetUrl, {
            signal: controller.signal,
            headers: {
                "User-Agent": "sportsync-ai-live-analytics/espn-proxy",
                "Accept": "application/json",
            },
        });
        clearTimeout(timeoutId);

        if (!upstream.ok) {
            return res.status(upstream.status).json({ error: `ESPN API Error: ${upstream.status}` });
        }

        const data = await upstream.json();
        res.setHeader("Cache-Control", "public, max-age=10, stale-while-revalidate=20");
        res.setHeader("Content-Type", "application/json");
        return res.status(200).json(data);
    } catch (error) {
        return res.status(502).json({ error: "Proxy request failed" });
    }
}
