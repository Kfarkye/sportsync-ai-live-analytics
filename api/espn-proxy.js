export const maxDuration = 60;

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports';
const TIMEOUT_MS = 8000;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS'
};

const setCorsHeaders = (res) => {
  Object.entries(CORS_HEADERS).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
};

const sanitizeEndpoint = (endpoint) => {
  if (!endpoint || typeof endpoint !== 'string') return null;
  let decoded = endpoint;
  try {
    decoded = decodeURIComponent(endpoint);
  } catch {}

  const trimmed = decoded.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.origin !== 'https://site.api.espn.com') return null;
      const normalized = parsed.pathname + parsed.search + parsed.hash;
      return normalized.startsWith('/apis/site/v2/sports/')
        ? normalized.replace('/apis/site/v2/sports/', '')
        : null;
    } catch {
      return null;
    }
  }

  if (trimmed.includes('://')) return null;
  return trimmed.startsWith('/') ? trimmed.substring(1) : trimmed;
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res);
    res.setHeader('Cache-Control', 'public, max-age=10');
    return res.status(200).end();
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    setCorsHeaders(res);
    res.setHeader('Cache-Control', 'public, max-age=10');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let endpoint = req.query?.endpoint;

  if (req.method === 'POST' && !endpoint) {
    try {
      const bodyText = await req.text();
      const body = bodyText ? JSON.parse(bodyText) : {};
      endpoint = body?.endpoint;
    } catch {
      endpoint = null;
    }
  }

  const cleanedEndpoint = sanitizeEndpoint(endpoint);
  if (!cleanedEndpoint) {
    setCorsHeaders(res);
    res.setHeader('Cache-Control', 'public, max-age=10');
    return res.status(400).json({ error: 'Missing or invalid endpoint parameter' });
  }

  const targetUrl = `${ESPN_BASE}/${cleanedEndpoint}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const upstream = await fetch(targetUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'sportsync-drip-proxy/1.0',
        Accept: 'application/json'
      }
    });
    clearTimeout(timeout);

    if (!upstream.ok) {
      setCorsHeaders(res);
      res.setHeader('Cache-Control', 'public, max-age=10');
      return res.status(upstream.status).json({
        error: `ESPN API error ${upstream.status}: ${upstream.statusText}`
      });
    }

    const payload = await upstream.json();
    setCorsHeaders(res);
    res.setHeader('Cache-Control', 'public, max-age=10');
    return res.status(200).json(payload);
  } catch (error) {
    clearTimeout(timeout);
    console.error('[ESPN Proxy] Upstream fetch failed:', error);
    setCorsHeaders(res);
    res.setHeader('Cache-Control', 'public, max-age=10');
    return res.status(502).json({ error: 'Upstream fetch failed' });
  }
}
