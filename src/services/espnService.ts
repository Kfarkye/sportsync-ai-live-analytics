import { setEspnProxyInvoker } from '@shared/espnService';

// Wire the optional Edge proxy hook for the shared ESPN service.
if (typeof window !== 'undefined') {
  const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports';

  setEspnProxyInvoker(async (endpoint, signal) => {
    try {
      const fullEndpoint = `${ESPN_BASE}/${endpoint}`;
      const proxyUrl = `/api/espn-proxy?endpoint=${encodeURIComponent(fullEndpoint)}`;
      const res = await fetch(proxyUrl, {
        method: 'GET',
        signal,
      });

      if (!res.ok) return null;

      const data = await res.json();

      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve(data),
      };
    } catch {
      // Swallow and let shared fallback logic handle other channels
      return null;
    }
  });
}

export * from '@shared/espnService';
