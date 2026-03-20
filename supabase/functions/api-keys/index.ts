import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type ApiKeyRow = {
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

type RetrievedKeyPayload = {
  key: string;
  plan?: string | null;
  product?: string | null;
  email?: string | null;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
};

function jsonResponse(payload: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      ...extraHeaders,
      'Content-Type': 'application/json',
    },
  });
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getSupabaseClient() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((part) => part.toString(16).padStart(2, '0'))
    .join('');
}

function isApiKeyValid(key: ApiKeyRow): boolean {
  if (!key.active) return false;
  if (key.revoked_at) return false;

  const now = new Date();

  if (key.expires_at) {
    const expiresAt = new Date(key.expires_at);
    if (!Number.isNaN(expiresAt.getTime()) && expiresAt <= now) return false;
  }

  if (!key.is_primary && key.rotation_grace_until) {
    const graceUntil = new Date(key.rotation_grace_until);
    if (!Number.isNaN(graceUntil.getTime()) && graceUntil <= now) return false;
  }

  return true;
}

async function resolveApiKey(
  supabase: ReturnType<typeof createClient>,
  rawApiKey: string,
): Promise<{ key: ApiKeyRow; keyHash: string } | null> {
  const keyHash = await sha256Hex(rawApiKey);

  const { data, error } = await supabase
    .from('api_keys')
    .select('id,customer_id,tier,key_prefix,is_primary,active,revoked_at,expires_at,rotation_grace_until')
    .eq('key_hash', keyHash)
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as ApiKeyRow;
  if (!isApiKeyValid(row)) return null;

  return { key: row, keyHash };
}

async function callRpcWithVariants<T = unknown>(
  supabase: ReturnType<typeof createClient>,
  fnName: string,
  variants: Record<string, unknown>[],
): Promise<T> {
  let lastError: string | null = null;

  for (const payload of variants) {
    const { data, error } = await supabase.rpc(fnName, payload);
    if (!error) {
      return data as T;
    }
    lastError = error.message;
  }

  throw new Error(lastError ?? `${fnName} failed`);
}

function unwrapRecord(data: unknown): Record<string, unknown> | null {
  if (!data) return null;
  if (Array.isArray(data)) {
    if (data.length === 0) return null;
    const first = data[0];
    return first && typeof first === 'object' ? (first as Record<string, unknown>) : null;
  }
  return typeof data === 'object' ? (data as Record<string, unknown>) : null;
}

function pickString(source: Record<string, unknown> | null, keys: string[]): string | null {
  if (!source) return null;
  for (const key of keys) {
    const value = normalizeText(source[key]);
    if (value) return value;
  }
  return null;
}

function pickBoolean(source: Record<string, unknown> | null, keys: string[], fallback = false): boolean {
  if (!source) return fallback;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      if (value.toLowerCase() === 'true') return true;
      if (value.toLowerCase() === 'false') return false;
    }
  }
  return fallback;
}

function pickNumber(source: Record<string, unknown> | null, keys: string[]): number | null {
  if (!source) return null;
  for (const key of keys) {
    const raw = source[key];
    const num = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const action = normalizeText(new URL(req.url).searchParams.get('action'))?.toLowerCase();
  if (!action) {
    return jsonResponse({ error: 'missing_action', message: 'Provide action query parameter' }, 400);
  }

  let supabase: ReturnType<typeof createClient>;
  try {
    supabase = getSupabaseClient();
  } catch (error) {
    return jsonResponse(
      {
        error: 'server_not_configured',
        message: error instanceof Error ? error.message : 'Missing server config',
      },
      500,
    );
  }

  try {
    if (action === 'retrieve') {
      if (req.method !== 'GET') {
        return jsonResponse({ error: 'method_not_allowed', message: 'Use GET for retrieve' }, 405);
      }

      const url = new URL(req.url);
      const sessionId = normalizeText(url.searchParams.get('session_id'));
      if (!sessionId) {
        return jsonResponse({ error: 'missing_session_id', message: 'session_id is required' }, 400);
      }

      const rpcData = await callRpcWithVariants<unknown>(supabase, 'retrieve_api_key', [
        { p_session_id: sessionId },
        { session_id: sessionId },
        { p_stripe_session_id: sessionId },
        { stripe_session_id: sessionId },
      ]);

      const record = unwrapRecord(rpcData);
      if (!record) {
        return jsonResponse({ error: 'invalid_session', message: 'Session is invalid, expired, or already used' }, 404, {
          'Cache-Control': 'no-store',
        });
      }

      const key = pickString(record, ['key', 'api_key', 'api_key_plaintext', 'plaintext_key', 'new_key']);
      if (!key) {
        return jsonResponse({ error: 'key_not_available', message: 'Key was not returned for this session' }, 404, {
          'Cache-Control': 'no-store',
        });
      }

      const payload: RetrievedKeyPayload = {
        key,
        plan: pickString(record, ['plan', 'tier']),
        product: pickString(record, ['product']),
        email: pickString(record, ['email', 'customer_email']),
      };

      return jsonResponse(payload, 200, {
        'Cache-Control': 'no-store',
      });
    }

    const rawApiKey = normalizeText(req.headers.get('x-api-key'));
    if (!rawApiKey) {
      return jsonResponse(
        {
          error: 'missing_api_key',
          message: 'Valid x-api-key header is required',
        },
        401,
      );
    }

    const keyContext = await resolveApiKey(supabase, rawApiKey);
    if (!keyContext) {
      return jsonResponse(
        {
          error: 'invalid_api_key',
          message: 'API key is invalid, revoked, expired, or outside grace period',
        },
        401,
      );
    }

    if (action === 'list') {
      if (req.method !== 'GET') {
        return jsonResponse({ error: 'method_not_allowed', message: 'Use GET for list' }, 405);
      }

      let keysData: unknown = null;
      try {
        keysData = await callRpcWithVariants<unknown>(supabase, 'list_customer_keys', [
          { p_customer_id: keyContext.key.customer_id },
          { customer_id: keyContext.key.customer_id },
          { p_customer: keyContext.key.customer_id },
        ]);
      } catch {
        const { data, error } = await supabase
          .from('api_keys')
          .select('key_prefix,active,is_primary,tier,created_at,expires_at,rotation_grace_until,revoked_at')
          .eq('customer_id', keyContext.key.customer_id)
          .order('created_at', { ascending: false });

        if (error) {
          return jsonResponse({ error: 'list_failed', message: error.message }, 500);
        }
        keysData = data ?? [];
      }

      return jsonResponse(Array.isArray(keysData) ? keysData : [keysData].filter(Boolean), 200, {
        'Cache-Control': 'no-store',
      });
    }

    if (action === 'rotate') {
      if (req.method !== 'POST') {
        return jsonResponse({ error: 'method_not_allowed', message: 'Use POST for rotate' }, 405);
      }

      const rpcData = await callRpcWithVariants<unknown>(supabase, 'rotate_api_key', [
        { p_old_key_hash: keyContext.keyHash },
        { old_key_hash: keyContext.keyHash },
        { p_key_hash: keyContext.keyHash },
        { key_hash: keyContext.keyHash },
      ]);

      const record = unwrapRecord(rpcData);
      const newKey = pickString(record, ['new_key', 'api_key', 'plaintext_key', 'key']);

      if (!newKey) {
        return jsonResponse(
          {
            error: 'rotate_failed',
            message: 'Rotation did not return a new key',
          },
          500,
        );
      }

      return jsonResponse(
        {
          new_key: newKey,
          new_prefix: pickString(record, ['new_prefix', 'new_key_prefix']),
          old_key_prefix: pickString(record, ['old_key_prefix', 'old_prefix']) ?? keyContext.key.key_prefix,
          old_key_grace_until: pickString(record, ['old_key_grace_until', 'rotation_grace_until', 'grace_until']),
        },
        200,
        {
          'Cache-Control': 'no-store',
        },
      );
    }

    if (action === 'revoke') {
      if (req.method !== 'POST') {
        return jsonResponse({ error: 'method_not_allowed', message: 'Use POST for revoke' }, 405);
      }

      let body: Record<string, unknown> = {};
      try {
        body = (await req.json()) as Record<string, unknown>;
      } catch {
        return jsonResponse({ error: 'invalid_json', message: 'Request body must be valid JSON' }, 400);
      }

      const keyPrefix = normalizeText(body.key_prefix);
      if (!keyPrefix) {
        return jsonResponse({ error: 'missing_key_prefix', message: 'key_prefix is required' }, 400);
      }

      let revoked = false;
      let remainingActiveKeys: number | null = null;

      try {
        const rpcData = await callRpcWithVariants<unknown>(supabase, 'revoke_api_key', [
          { p_customer_id: keyContext.key.customer_id, p_key_prefix: keyPrefix },
          { customer_id: keyContext.key.customer_id, key_prefix: keyPrefix },
          { p_customer: keyContext.key.customer_id, p_prefix: keyPrefix },
        ]);

        const record = unwrapRecord(rpcData);
        revoked = pickBoolean(record, ['revoked', 'ok', 'success'], true);
        remainingActiveKeys = pickNumber(record, ['remaining_active_keys', 'active_keys_remaining']);
      } catch {
        const { data: revokeData, error: revokeError } = await supabase
          .from('api_keys')
          .update({ active: false, revoked_at: new Date().toISOString() })
          .eq('customer_id', keyContext.key.customer_id)
          .eq('key_prefix', keyPrefix)
          .eq('active', true)
          .select('id');

        if (revokeError) {
          return jsonResponse({ error: 'revoke_failed', message: revokeError.message }, 500);
        }

        revoked = Array.isArray(revokeData) && revokeData.length > 0;
      }

      if (remainingActiveKeys === null) {
        const { count } = await supabase
          .from('api_keys')
          .select('id', { count: 'exact', head: true })
          .eq('customer_id', keyContext.key.customer_id)
          .eq('active', true)
          .is('revoked_at', null);
        remainingActiveKeys = count ?? 0;
      }

      return jsonResponse(
        {
          revoked,
          remaining_active_keys: remainingActiveKeys,
        },
        200,
      );
    }

    return jsonResponse({ error: 'unsupported_action', message: `Unknown action: ${action}` }, 400);
  } catch (error) {
    return jsonResponse(
      {
        error: 'request_failed',
        message: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
});
