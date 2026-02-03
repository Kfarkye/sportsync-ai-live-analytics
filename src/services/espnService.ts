import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { setEspnProxyInvoker } from '@shared/espnService';

// Wire the optional Edge proxy hook for the shared ESPN service.
if (isSupabaseConfigured()) {
  setEspnProxyInvoker(async (endpoint, signal) => {
    try {
      const { data, error } = await supabase.functions.invoke('espn-proxy', {
        body: { endpoint },
        signal,
      });

      if (!error && data && !data.error) {
        return { ok: true, status: 200, json: () => Promise.resolve(data) };
      }
    } catch {
      // Swallow and let shared fallback logic handle other channels
    }
    return null;
  });
}

export * from '@shared/espnService';
