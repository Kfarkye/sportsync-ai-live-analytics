import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { getRequestId, jsonResponse, safeJsonBody, weakEtag, type TimingMetric } from '../_shared/http.ts';

declare const Deno: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id, x-trace-id',
  'Access-Control-Max-Age': '86400',
  'X-Content-Type-Options': 'nosniff',
};

const SUMMARY_SELECT = [
  'total_picks',
  'total_wins',
  'total_losses',
  'global_win_rate',
  'best_category_win_rate',
  'best_category',
].join(',');

const LEAGUES_SELECT = [
  'league_id',
  'total_picks',
  'wins',
  'losses',
  'pushes',
  'win_rate',
].join(',');

const BUCKETS_SELECT = [
  'bucket_id',
  'total_picks',
  'wins',
  'losses',
  'win_rate',
].join(',');

const HEATMAP_SELECT = [
  'category',
  'wins',
  'losses',
  'win_rate',
].join(',');

const TRENDS_SELECT = [
  'game_date',
  'daily_picks',
  'daily_wins',
  'daily_losses',
  'daily_pushes',
].join(',');

let supabaseClient: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!supabaseClient) {
    const url = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) throw new Error('Missing Supabase configuration');

    supabaseClient = createClient(url, key, {
      auth: { persistSession: false },
      global: { headers: { 'X-Client-Info': 'titan-analytics-edge' } },
    });
  }
  return supabaseClient;
}

function toTrendDays(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 21;
  return Math.max(7, Math.min(90, Math.floor(parsed)));
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const requestId = getRequestId(req);
  const startedAt = Date.now();
  const timings: TimingMetric[] = [];

  try {
    const parseStart = Date.now();
    const query = new URL(req.url).searchParams;

    let body: Record<string, unknown> = {};
    if (req.method === 'POST') {
      const parsed = await safeJsonBody<Record<string, unknown>>(req, 8 * 1024);
      if (!parsed.ok) {
        return jsonResponse(
          { error: parsed.error, error_code: 'INVALID_BODY' },
          { status: 400, cors: corsHeaders, requestId, cacheControl: 'no-store' }
        );
      }
      body = parsed.value;
    }

    const trendDays = toTrendDays(query.get('trend_days') ?? body.trend_days);
    timings.push({ name: 'parse', dur: Date.now() - parseStart, desc: 'parse+validate' });

    const dbStart = Date.now();
    const supabase = getSupabase();

    const [summaryRes, leaguesRes, bucketsRes, heatmapRes, trendsRes] = await Promise.all([
      supabase.from('vw_titan_summary').select(SUMMARY_SELECT).single(),
      supabase.from('vw_titan_leagues').select(LEAGUES_SELECT),
      supabase.from('vw_titan_buckets').select(BUCKETS_SELECT),
      supabase.from('vw_titan_heatmap').select(HEATMAP_SELECT),
      supabase.from('vw_titan_trends').select(TRENDS_SELECT).order('game_date', { ascending: false }).limit(trendDays),
    ]);

    timings.push({ name: 'db', dur: Date.now() - dbStart, desc: 'views_parallel' });

    const dbError = summaryRes.error || leaguesRes.error || bucketsRes.error || heatmapRes.error || trendsRes.error;
    if (dbError) {
      console.error(JSON.stringify({
        level: 'error',
        requestId,
        fn: 'titan-analytics',
        message: 'db_query_failed',
        error: dbError.message,
      }));

      return jsonResponse(
        { error: 'Failed to fetch analytics', error_code: 'DB_QUERY_FAILED' },
        {
          status: 500,
          cors: corsHeaders,
          requestId,
          cacheControl: 'no-store',
          timings: [...timings, { name: 'total', dur: Date.now() - startedAt, desc: 'request total' }],
        }
      );
    }

    const summary = summaryRes.data ?? null;
    const leagues = leaguesRes.data ?? [];
    const buckets = bucketsRes.data ?? [];
    const heatmap = heatmapRes.data ?? [];
    const trends = [...(trendsRes.data ?? [])].reverse();

    const payload = {
      summary,
      leagues,
      buckets,
      heatmap,
      trends,
      metadata: {
        trend_days: trendDays,
        generated_at: new Date().toISOString(),
      },
    };

    const latestTrendDay = trends.length > 0 ? String(trends[trends.length - 1].game_date ?? '') : '';
    const etag = weakEtag(`${trendDays}|${summary?.total_picks ?? 0}|${leagues.length}|${buckets.length}|${heatmap.length}|${latestTrendDay}`);
    const cacheControl = 'public, max-age=20, stale-while-revalidate=60';

    if (req.headers.get('if-none-match') === etag) {
      return new Response(null, {
        status: 304,
        headers: {
          ...corsHeaders,
          'Cache-Control': cacheControl,
          ETag: etag,
          'X-Request-Id': requestId,
        },
      });
    }

    const elapsed = Date.now() - startedAt;
    console.log(JSON.stringify({
      level: 'info',
      requestId,
      fn: 'titan-analytics',
      trendDays,
      leagueCount: leagues.length,
      bucketCount: buckets.length,
      trendPoints: trends.length,
      elapsedMs: elapsed,
    }));

    return jsonResponse(payload, {
      cors: corsHeaders,
      requestId,
      cacheControl,
      timings: [...timings, { name: 'total', dur: elapsed, desc: 'request total' }],
      extraHeaders: {
        ETag: etag,
        'X-League-Count': String(leagues.length),
        'X-Trend-Points': String(trends.length),
      },
    });
  } catch (error: any) {
    const elapsed = Date.now() - startedAt;
    const message = error?.message || 'Internal server error';

    console.error(JSON.stringify({
      level: 'error',
      requestId,
      fn: 'titan-analytics',
      message,
      elapsedMs: elapsed,
    }));

    return jsonResponse(
      { error: message, error_code: 'INTERNAL' },
      {
        status: 500,
        cors: corsHeaders,
        requestId,
        cacheControl: 'no-store',
        timings: [...timings, { name: 'total', dur: elapsed, desc: 'request total' }],
      }
    );
  }
});
