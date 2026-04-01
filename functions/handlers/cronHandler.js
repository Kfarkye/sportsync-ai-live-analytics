// functions/handlers/cronHandler.js
// Migrated from api/cron/*.js — all 5 cron triggers as a single Cloud Function
// Each cron endpoint is a thin wrapper that auth-checks and forwards to Supabase Edge Functions.

import { onRequest } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';

const CRON_ROUTES = {
  'finalize-games': { edge: 'finalize-games-cron', body: {}, timeoutMs: 50000 },
  'ingest-odds':    { edge: 'ingest-odds', body: { provider: 'the_odds_api', sports: ['basketball_nba','icehockey_nhl','baseball_mlb','basketball_ncaab','americanfootball_nfl','soccer_epl','soccer_spain_la_liga','soccer_italy_serie_a','soccer_germany_bundesliga','soccer_france_ligue_one','soccer_uefa_champs_league'] }, timeoutMs: 50000, extraHeaders: true },
  'pregame-intel':  { edge: 'pregame-intel-cron', body: { is_cron: true }, timeoutMs: 5000 },
  'sharp-picks':    { edge: 'sharp-picks-cron', body: { is_cron: true }, timeoutMs: 50000 },
  'sync-player-props': { edge: 'sync-player-props', body: {}, timeoutMs: 50000 },
};

export const cronHandler = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 60,
    memory: '256MiB',
    cors: false,
    secrets: ['SUPABASE_SERVICE_ROLE_KEY', 'CRON_SECRET'],
  },
  async (req, res) => {
    // Auth: check cron secret
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = req.headers['authorization'] || '';
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Route: /api/cron/{handler-name}
    const path = (req.originalUrl || req.url || req.path || '').replace(/^\/api\/cron\//, '');
    const routeKey = path.replace(/\/$/, '').split('?')[0];
    const route = CRON_ROUTES[routeKey];

    if (!route) {
      res.status(404).json({ error: 'Unknown cron route', available: Object.keys(CRON_ROUTES) });
      return;
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      res.status(500).json({ error: 'Missing Supabase configuration' });
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), route.timeoutMs);

    try {
      const headers = {
        'Authorization': `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      };
      if (route.extraHeaders && cronSecret) {
        headers['x-cron-secret'] = cronSecret;
      }

      const upstream = await fetch(`${supabaseUrl}/functions/v1/${route.edge}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(route.body),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      const data = await upstream.json().catch(() => ({ status: upstream.status }));
      res.status(upstream.status).json(data);

    } catch (error) {
      clearTimeout(timeout);
      const msg = error?.name === 'AbortError' ? 'Upstream timeout' : (error?.message || 'Unknown error');
      logger.error(`[Cron/${routeKey}] Failed:`, msg);
      res.status(502).json({ error: msg });
    }
  }
);
