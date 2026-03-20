import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type PlanLimits = {
  perMin: number;
  perDay: number;
};

type EndpointConfig = {
  table?: string;
  free: boolean;
  premium: boolean;
  defaultLimit: number;
  maxLimit: number;
  description: string;
};

type ValidApiKey = {
  id: string;
  customer_id: string;
  tier: string;
  key_prefix: string | null;
  is_primary: boolean;
  active: boolean;
  revoked_at: string | null;
  expires_at: string | null;
  rotation_grace_until: string | null;
};

type RateLimitResult = {
  limited: boolean;
  retryAfter: number;
  minuteRemaining: number;
  dailyRemaining: number;
  minuteLimit: number;
  dailyLimit: number;
  resetEpoch: number;
};

const VERSION = '2026-03-18.gateway.v1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
};

const endpointConfigs: Record<string, EndpointConfig> = {
  health: {
    free: true,
    premium: false,
    defaultLimit: 1,
    maxLimit: 1,
    description: 'Gateway health status',
  },
  openapi: {
    free: true,
    premium: false,
    defaultLimit: 1,
    maxLimit: 1,
    description: 'OpenAPI 3.0 spec',
  },
  scores: {
    table: 'match_feed',
    free: true,
    premium: false,
    defaultLimit: 30,
    maxLimit: 200,
    description: 'Live and scheduled scores by league/date/status',
  },
  lines: {
    table: 'opening_lines',
    free: true,
    premium: false,
    defaultLimit: 30,
    maxLimit: 200,
    description: 'Opening lines by sport/league',
  },
  trends: {
    table: 'trends',
    free: true,
    premium: false,
    defaultLimit: 30,
    maxLimit: 200,
    description: 'Trend rows by league and sample size',
  },
  picks: {
    table: 'daily_picks',
    free: true,
    premium: false,
    defaultLimit: 25,
    maxLimit: 100,
    description: "Today's picks",
  },
  logos: {
    table: 'team_logos',
    free: true,
    premium: false,
    defaultLimit: 260,
    maxLimit: 400,
    description: 'Team logos by league',
  },
  splits_ou: {
    table: 'team_ou_splits',
    free: true,
    premium: false,
    defaultLimit: 60,
    maxLimit: 300,
    description: 'Team totals splits',
  },
  splits_ats: {
    table: 'team_ats_splits',
    free: true,
    premium: false,
    defaultLimit: 60,
    maxLimit: 300,
    description: 'Team ATS splits',
  },
  intel: {
    table: 'pregame_intel',
    free: false,
    premium: true,
    defaultLimit: 20,
    maxLimit: 100,
    description: 'Pregame match context',
  },
  consensus: {
    table: 'v_market_consensus',
    free: false,
    premium: true,
    defaultLimit: 20,
    maxLimit: 100,
    description: 'Consensus view',
  },
  fair_line: {
    table: 'espn_fair_line',
    free: false,
    premium: true,
    defaultLimit: 20,
    maxLimit: 150,
    description: 'ESPN fair line snapshots',
  },
  kalshi: {
    table: 'kalshi_markets',
    free: false,
    premium: true,
    defaultLimit: 25,
    maxLimit: 200,
    description: 'Kalshi market curve',
  },
  kalshi_live: {
    table: 'kalshi_live_snapshots',
    free: false,
    premium: true,
    defaultLimit: 25,
    maxLimit: 200,
    description: 'Kalshi live snapshots',
  },
  signals: {
    table: 'drip_signals',
    free: false,
    premium: true,
    defaultLimit: 25,
    maxLimit: 150,
    description: 'Signal rows',
  },
};

const FREE_ENDPOINTS = new Set(
  Object.entries(endpointConfigs)
    .filter(([, cfg]) => cfg.free)
    .map(([endpoint]) => endpoint),
);

const PREMIUM_ENDPOINTS = new Set(
  Object.entries(endpointConfigs)
    .filter(([, cfg]) => cfg.premium)
    .map(([endpoint]) => endpoint),
);

const PAID_ALLOWED_PLANS = new Set(['pro', 'drip_live', 'operator', 'enterprise']);

const PLAN_DEFAULT_LIMITS: Record<string, PlanLimits> = {
  sandbox: { perMin: 10, perDay: 1000 },
  production: { perMin: 60, perDay: 100000 },
  enterprise: { perMin: 120, perDay: 500000 },
  pro: { perMin: 30, perDay: 50000 },
  drip_live: { perMin: 30, perDay: 50000 },
  operator: { perMin: 45, perDay: 120000 },
  builder: { perMin: 20, perDay: 20000 },
};

const freeMinuteBuckets = new Map<string, { windowStartMs: number; count: number }>();
const freeDayBuckets = new Map<string, { windowStartMs: number; count: number }>();
const keyMinuteFallbackBuckets = new Map<string, { windowStartMs: number; count: number }>();
const keyDayFallbackBuckets = new Map<string, { windowStartMs: number; count: number }>();

function jsonResponse(payload: Record<string, unknown>, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      ...headers,
      'Content-Type': 'application/json',
    },
  });
}

function toPositiveInt(value: string | null, fallback: number, max: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.round(parsed);
  return Math.min(max, Math.max(1, rounded));
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseIsoDate(value: unknown): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function lower(value: unknown): string {
  return normalizeText(value)?.toLowerCase() ?? '';
}

function resolveClientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded && forwarded.trim().length > 0) {
    return forwarded.split(',')[0].trim();
  }
  const realIp = req.headers.get('x-real-ip');
  if (realIp && realIp.trim().length > 0) return realIp.trim();
  return 'unknown';
}

function minuteWindowStart(date: Date): Date {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    0,
    0,
  ));
}

function dayWindowStart(date: Date): Date {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    0,
    0,
    0,
    0,
  ));
}

function nextMinuteResetEpoch(date: Date): number {
  return Math.floor((minuteWindowStart(new Date(date.getTime() + 60_000))).getTime() / 1000);
}

function extractPlanLimitsFromFeatures(plan: string, features: unknown): PlanLimits {
  const fallback = PLAN_DEFAULT_LIMITS[plan] ?? { perMin: 30, perDay: 50000 };
  if (!features || typeof features !== 'object') return fallback;

  const source = features as Record<string, unknown>;
  const limitsNested = source.limits && typeof source.limits === 'object'
    ? (source.limits as Record<string, unknown>)
    : {};

  const perMinCandidates = [
    source.rate_limit_per_minute,
    source.requests_per_minute,
    source.per_min,
    limitsNested.per_minute,
    limitsNested.requests_per_minute,
    limitsNested.per_min,
  ];

  const perDayCandidates = [
    source.rate_limit_per_day,
    source.requests_per_day,
    source.per_day,
    limitsNested.per_day,
    limitsNested.requests_per_day,
  ];

  const pickNumber = (values: unknown[], fallbackValue: number): number => {
    for (const value of values) {
      const parsed = typeof value === 'number' ? value : Number(value);
      if (Number.isFinite(parsed) && parsed > 0) return Math.round(parsed);
    }
    return fallbackValue;
  };

  return {
    perMin: pickNumber(perMinCandidates, fallback.perMin),
    perDay: pickNumber(perDayCandidates, fallback.perDay),
  };
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function buildRateLimitHeaders(rateLimit: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(rateLimit.minuteLimit),
    'X-RateLimit-Remaining': String(Math.max(0, rateLimit.minuteRemaining)),
    'X-RateLimit-Reset': String(rateLimit.resetEpoch),
    'X-RateLimit-Daily-Remaining': String(Math.max(0, rateLimit.dailyRemaining)),
    'Retry-After': String(Math.max(0, rateLimit.retryAfter)),
  };
}

function bumpMemoryBucket(
  map: Map<string, { windowStartMs: number; count: number }>,
  key: string,
  windowStartMs: number,
): number {
  const existing = map.get(key);
  if (!existing || existing.windowStartMs !== windowStartMs) {
    map.set(key, { windowStartMs, count: 1 });
    return 1;
  }
  existing.count += 1;
  map.set(key, existing);
  return existing.count;
}

function checkFreeIpLimit(ip: string, now: Date): RateLimitResult {
  const minuteStart = minuteWindowStart(now);
  const dayStart = dayWindowStart(now);

  const minuteCount = bumpMemoryBucket(freeMinuteBuckets, ip, minuteStart.getTime());
  const dayCount = bumpMemoryBucket(freeDayBuckets, ip, dayStart.getTime());

  const minuteLimit = 60;
  const dayLimit = 10000;
  const limited = minuteCount > minuteLimit || dayCount > dayLimit;

  return {
    limited,
    retryAfter: Math.max(1, 60 - now.getUTCSeconds()),
    minuteRemaining: Math.max(0, minuteLimit - minuteCount),
    dailyRemaining: Math.max(0, dayLimit - dayCount),
    minuteLimit,
    dailyLimit: dayLimit,
    resetEpoch: nextMinuteResetEpoch(now),
  };
}

async function callIncrementRateLimitRpc(
  supabase: ReturnType<typeof createClient>,
  keyId: string,
  windowStartIso: string,
  windowType: 'minute' | 'day',
): Promise<number> {
  const rpcPayloadVariants = [
    { p_key_id: keyId, p_window_start: windowStartIso, p_window_type: windowType },
    { key_id: keyId, window_start: windowStartIso, window_type: windowType },
  ];

  for (const payload of rpcPayloadVariants) {
    const { data, error } = await supabase.rpc('increment_rate_limit', payload);
    if (error) continue;

    if (Array.isArray(data) && data.length > 0 && data[0] && typeof data[0].request_count !== 'undefined') {
      const parsed = Number(data[0].request_count);
      return Number.isFinite(parsed) ? parsed : 0;
    }

    if (data && typeof data === 'object' && 'request_count' in (data as Record<string, unknown>)) {
      const parsed = Number((data as Record<string, unknown>).request_count);
      return Number.isFinite(parsed) ? parsed : 0;
    }

    const numericData = Number(data);
    return Number.isFinite(numericData) ? numericData : 0;
  }

  throw new Error('increment_rate_limit rpc unavailable');
}

function checkKeyFallbackLimit(keyId: string, now: Date, limits: PlanLimits): RateLimitResult {
  const minuteStart = minuteWindowStart(now);
  const dayStart = dayWindowStart(now);

  const minuteCount = bumpMemoryBucket(keyMinuteFallbackBuckets, keyId, minuteStart.getTime());
  const dayCount = bumpMemoryBucket(keyDayFallbackBuckets, keyId, dayStart.getTime());

  const limited = minuteCount > limits.perMin || dayCount > limits.perDay;

  return {
    limited,
    retryAfter: Math.max(1, 60 - now.getUTCSeconds()),
    minuteRemaining: Math.max(0, limits.perMin - minuteCount),
    dailyRemaining: Math.max(0, limits.perDay - dayCount),
    minuteLimit: limits.perMin,
    dailyLimit: limits.perDay,
    resetEpoch: nextMinuteResetEpoch(now),
  };
}

async function checkPaidRateLimit(
  supabase: ReturnType<typeof createClient>,
  keyId: string,
  limits: PlanLimits,
): Promise<RateLimitResult> {
  const now = new Date();
  const minuteStartIso = minuteWindowStart(now).toISOString();
  const dayStartIso = dayWindowStart(now).toISOString();

  try {
    const minuteCount = await callIncrementRateLimitRpc(supabase, keyId, minuteStartIso, 'minute');
    const dayCount = await callIncrementRateLimitRpc(supabase, keyId, dayStartIso, 'day');

    const limited = minuteCount > limits.perMin || dayCount > limits.perDay;

    return {
      limited,
      retryAfter: Math.max(1, 60 - now.getUTCSeconds()),
      minuteRemaining: Math.max(0, limits.perMin - minuteCount),
      dailyRemaining: Math.max(0, limits.perDay - dayCount),
      minuteLimit: limits.perMin,
      dailyLimit: limits.perDay,
      resetEpoch: nextMinuteResetEpoch(now),
    };
  } catch {
    return checkKeyFallbackLimit(keyId, now, limits);
  }
}

function isKeyCurrentlyValid(apiKey: ValidApiKey): boolean {
  if (!apiKey.active) return false;
  if (apiKey.revoked_at) return false;

  const now = new Date();

  if (apiKey.expires_at) {
    const expiresAt = new Date(apiKey.expires_at);
    if (!Number.isNaN(expiresAt.getTime()) && expiresAt <= now) return false;
  }

  if (!apiKey.is_primary && apiKey.rotation_grace_until) {
    const graceUntil = new Date(apiKey.rotation_grace_until);
    if (!Number.isNaN(graceUntil.getTime()) && graceUntil <= now) return false;
  }

  return true;
}

async function resolveApiKey(
  supabase: ReturnType<typeof createClient>,
  rawApiKey: string,
): Promise<{ key: ValidApiKey; features: unknown; keyHash: string } | null> {
  const keyHash = await sha256Hex(rawApiKey);

  const { data: keyRow, error: keyError } = await supabase
    .from('api_keys')
    .select('id,customer_id,tier,key_prefix,is_primary,active,revoked_at,expires_at,rotation_grace_until')
    .eq('key_hash', keyHash)
    .limit(1)
    .maybeSingle();

  if (keyError || !keyRow) return null;

  const validKey = keyRow as ValidApiKey;
  if (!isKeyCurrentlyValid(validKey)) return null;

  const { data: entitlement } = await supabase
    .from('plan_entitlements')
    .select('features')
    .eq('plan', validKey.tier)
    .limit(1)
    .maybeSingle();

  return {
    key: validKey,
    features: entitlement?.features ?? null,
    keyHash,
  };
}

function rowMatchesToken(row: Record<string, unknown>, token: string, keys: string[]): boolean {
  const tokenLower = token.toLowerCase();
  return keys.some((key) => {
    const value = row[key];
    if (value === null || value === undefined) return false;
    return String(value).toLowerCase() === tokenLower;
  });
}

function filterRows(
  rows: Record<string, unknown>[],
  endpoint: string,
  query: URLSearchParams,
): Record<string, unknown>[] {
  let output = rows;

  const league = normalizeText(query.get('league'));
  const sport = normalizeText(query.get('sport'));
  const status = normalizeText(query.get('status'));
  const date = parseIsoDate(query.get('date'));
  const minSampleSize = Number(query.get('min_sample_size') ?? query.get('sample_size') ?? '');

  if (league) {
    output = output.filter((row) => rowMatchesToken(row, league, ['league', 'league_id', 'sport_league', 'competition']));
  }

  if (sport) {
    output = output.filter((row) => rowMatchesToken(row, sport, ['sport', 'sport_id']));
  }

  if (status) {
    output = output.filter((row) => rowMatchesToken(row, status, ['status', 'game_status', 'match_status']));
  }

  if (date) {
    output = output.filter((row) => {
      const candidates = ['date', 'game_date', 'match_date', 'start_date', 'start_time', 'captured_at', 'created_at'];
      for (const key of candidates) {
        const parsed = parseIsoDate(row[key]);
        if (parsed === date) return true;
      }
      return false;
    });
  }

  if (Number.isFinite(minSampleSize) && minSampleSize > 0 && endpoint === 'trends') {
    output = output.filter((row) => {
      const value = Number(row.sample_size ?? row.games_sampled ?? row.n ?? row.sample);
      return Number.isFinite(value) && value >= minSampleSize;
    });
  }

  return output;
}

async function fetchEndpointRows(
  supabase: ReturnType<typeof createClient>,
  endpoint: string,
  config: EndpointConfig,
  requestedLimit: number,
  query: URLSearchParams,
): Promise<Record<string, unknown>[]> {
  if (!config.table) return [];

  const fetchLimit = Math.min(config.maxLimit, Math.max(config.defaultLimit, requestedLimit * 3));

  const { data, error } = await supabase
    .from(config.table)
    .select('*')
    .limit(fetchLimit);

  if (error) {
    throw new Error(`data_fetch_failed:${error.message}`);
  }

  const rows = (data ?? []) as Record<string, unknown>[];
  const filtered = filterRows(rows, endpoint, query);
  return filtered.slice(0, requestedLimit);
}

async function logApiRequest(supabase: ReturnType<typeof createClient>, payload: Record<string, unknown>) {
  const attempts = [
    payload,
    {
      api_key_id: payload.api_key_id,
      customer_id: payload.customer_id,
      endpoint: payload.endpoint,
      request_path: payload.request_path,
      method: payload.method,
      status_code: payload.status_code,
      response_time_ms: payload.response_time_ms,
      ip_address: payload.ip_address,
      request_query: payload.request_query,
      created_at: payload.created_at,
    },
  ];

  for (const attempt of attempts) {
    const { error } = await supabase.from('api_request_logs').insert(attempt);
    if (!error) return;
  }
}

function buildOpenApiSpec(baseUrl: string) {
  const paths: Record<string, unknown> = {};

  for (const [endpoint, config] of Object.entries(endpointConfigs)) {
    paths['/functions/v1/api'] = paths['/functions/v1/api'] || { get: { parameters: [] as unknown[] } };
    const get = (paths['/functions/v1/api'] as { get: Record<string, unknown> }).get;
    const endpointInfo = {
      name: endpoint,
      free: config.free,
      premium: config.premium,
      table: config.table ?? null,
      description: config.description,
      max_limit: config.maxLimit,
    };

    if (!Array.isArray(get['x-endpoints'])) get['x-endpoints'] = [];
    (get['x-endpoints'] as unknown[]).push(endpointInfo);
  }

  return {
    openapi: '3.0.3',
    info: {
      title: 'SportsSync API',
      version: VERSION,
      description: 'Game data API gateway',
    },
    servers: [{ url: baseUrl }],
    paths: {
      '/functions/v1/api': {
        get: {
          summary: 'API gateway',
          parameters: [
            {
              name: 'endpoint',
              in: 'query',
              required: true,
              schema: { type: 'string' },
            },
            {
              name: 'league',
              in: 'query',
              required: false,
              schema: { type: 'string' },
            },
            {
              name: 'sport',
              in: 'query',
              required: false,
              schema: { type: 'string' },
            },
            {
              name: 'status',
              in: 'query',
              required: false,
              schema: { type: 'string' },
            },
            {
              name: 'date',
              in: 'query',
              required: false,
              schema: { type: 'string', format: 'date' },
            },
            {
              name: 'limit',
              in: 'query',
              required: false,
              schema: { type: 'integer', minimum: 1, maximum: 400 },
            },
          ],
          responses: {
            '200': { description: 'Success' },
            '401': { description: 'Missing/invalid API key' },
            '403': { description: 'Plan not allowed' },
            '429': { description: 'Rate limited' },
          },
          'x-endpoints': Object.entries(endpointConfigs).map(([endpoint, cfg]) => ({
            endpoint,
            free: cfg.free,
            premium: cfg.premium,
            table: cfg.table ?? null,
            description: cfg.description,
          })),
        },
      },
    },
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed', message: 'Use GET or POST' }, 405);
  }

  const startedAt = Date.now();
  const url = new URL(req.url);
  const endpoint = (url.searchParams.get('endpoint') || '').toLowerCase().trim();
  const endpointConfig = endpointConfigs[endpoint];

  if (!endpoint || !endpointConfig) {
    return jsonResponse(
      {
        error: 'invalid_endpoint',
        message: 'Unknown endpoint',
        available_endpoints: Object.keys(endpointConfigs),
      },
      400,
    );
  }

  const now = new Date();
  const clientIp = resolveClientIp(req);
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'server_not_configured', message: 'Missing Supabase server credentials' }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const xApiKey = normalizeText(req.headers.get('x-api-key'));
  const requestLimit = toPositiveInt(url.searchParams.get('limit'), endpointConfig.defaultLimit, endpointConfig.maxLimit);

  let rateLimit: RateLimitResult | null = null;
  let keyContext: { key: ValidApiKey; features: unknown; keyHash: string } | null = null;
  let planLimits: PlanLimits = { perMin: 60, perDay: 10000 };

  if (endpoint === 'health') {
    const freeLimit = checkFreeIpLimit(clientIp, now);
    const headers = buildRateLimitHeaders(freeLimit);
    return jsonResponse({ status: 'ok', version: VERSION, endpoint: 'health' }, 200, headers);
  }

  if (endpoint === 'openapi') {
    const freeLimit = checkFreeIpLimit(clientIp, now);
    const headers = buildRateLimitHeaders(freeLimit);
    return jsonResponse(buildOpenApiSpec(`${url.origin}`), 200, headers);
  }

  if (!xApiKey && PREMIUM_ENDPOINTS.has(endpoint)) {
    return jsonResponse(
      {
        error: 'api_key_required',
        message: 'Premium endpoint requires x-api-key header',
      },
      401,
    );
  }

  if (xApiKey) {
    keyContext = await resolveApiKey(supabase, xApiKey);
    if (!keyContext) {
      return jsonResponse(
        {
          error: 'invalid_api_key',
          message: 'API key is invalid, revoked, expired, or outside grace period',
        },
        401,
      );
    }

    const tier = (keyContext.key.tier || '').toLowerCase();
    if (PREMIUM_ENDPOINTS.has(endpoint) && !PAID_ALLOWED_PLANS.has(tier)) {
      return jsonResponse(
        {
          error: 'plan_upgrade_required',
          message: 'Upgrade to pro for this endpoint',
          current_plan: tier,
          required: 'pro',
        },
        403,
      );
    }

    planLimits = extractPlanLimitsFromFeatures(tier, keyContext.features);
    rateLimit = await checkPaidRateLimit(supabase, keyContext.key.id, planLimits);
  } else {
    if (!FREE_ENDPOINTS.has(endpoint)) {
      return jsonResponse(
        {
          error: 'api_key_required',
          message: 'This endpoint requires an API key',
        },
        401,
      );
    }
    rateLimit = checkFreeIpLimit(clientIp, now);
  }

  if (rateLimit.limited) {
    return jsonResponse(
      {
        error: 'rate_limited',
        message: 'Rate limit exceeded',
        retry_after: rateLimit.retryAfter,
      },
      429,
      buildRateLimitHeaders(rateLimit),
    );
  }

  try {
    const data = await fetchEndpointRows(supabase, endpoint, endpointConfig, requestLimit, url.searchParams);

    const responseHeaders = buildRateLimitHeaders(rateLimit);

    await logApiRequest(supabase, {
      api_key_id: keyContext?.key.id ?? null,
      customer_id: keyContext?.key.customer_id ?? null,
      endpoint,
      request_path: url.pathname,
      method: req.method,
      status_code: 200,
      response_time_ms: Date.now() - startedAt,
      ip_address: clientIp,
      request_query: Object.fromEntries(url.searchParams.entries()),
      key_prefix: keyContext?.key.key_prefix ?? null,
      tier: keyContext?.key.tier ?? 'free',
      created_at: new Date().toISOString(),
    });

    return jsonResponse(
      {
        endpoint,
        count: data.length,
        data,
      },
      200,
      responseHeaders,
    );
  } catch (error) {
    await logApiRequest(supabase, {
      api_key_id: keyContext?.key.id ?? null,
      customer_id: keyContext?.key.customer_id ?? null,
      endpoint,
      request_path: url.pathname,
      method: req.method,
      status_code: 500,
      response_time_ms: Date.now() - startedAt,
      ip_address: clientIp,
      request_query: Object.fromEntries(url.searchParams.entries()),
      key_prefix: keyContext?.key.key_prefix ?? null,
      tier: keyContext?.key.tier ?? 'free',
      error: error instanceof Error ? error.message : String(error),
      created_at: new Date().toISOString(),
    });

    return jsonResponse(
      {
        error: 'query_failed',
        message: error instanceof Error ? error.message : 'Unknown query failure',
      },
      500,
      buildRateLimitHeaders(rateLimit),
    );
  }
});
