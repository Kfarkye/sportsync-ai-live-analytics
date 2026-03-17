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
  const respondJson = (status, body) => {
    setCorsHeaders(res);
    res.setHeader('Cache-Control', 'public, max-age=10');
    res.setHeader('Content-Type', 'application/json');
    return res.status(status).json(body);
  };

  if (req.method === 'OPTIONS') {
    return respondJson(200, {});
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return respondJson(405, { error: 'Method not allowed' });
  }

  let endpoint = req.query?.endpoint;
  if (typeof endpoint === 'undefined' && req.url) {
    const parsed = new URL(req.url, 'https://sportsync-ai-live-analytics.vercel.app');
    endpoint = parsed.searchParams.get('endpoint');
  }

  if (req.method === 'POST' && !endpoint) {
    const getBodyText = async () => {
      if (typeof req.text === 'function') {
        return await req.text();
      }
      if (typeof req.body === 'string') {
        return req.body;
      }
      if (req.body && typeof req.body === 'object') {
        return JSON.stringify(req.body);
      }
      return '';
    };

    try {
      const bodyText = await getBodyText();
      const body = bodyText ? JSON.parse(bodyText) : {};
      endpoint = body?.endpoint;
    } catch {
      endpoint = null;
    }
  }

  const cleanedEndpoint = sanitizeEndpoint(endpoint);
  if (!cleanedEndpoint) {
    return respondJson(400, { error: 'Missing or invalid endpoint parameter' });
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
      return respondJson(upstream.status, {
        error: `ESPN API error ${upstream.status}: ${upstream.statusText}`
      });
    }

    const payload = await upstream.json();
    return respondJson(200, payload);
  } catch (error) {
    clearTimeout(timeout);
    console.error('[ESPN Proxy] Upstream fetch failed:', error);
    return respondJson(502, { error: 'Upstream fetch failed' });
  }
}
