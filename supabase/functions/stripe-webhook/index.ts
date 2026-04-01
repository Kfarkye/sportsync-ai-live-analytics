import Stripe from 'https://esm.sh/stripe@14?target=denonext';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type CustomerRow = {
  id: string;
  email: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  product: string | null;
  plan: string | null;
  status: string | null;
};

const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const stripeWebhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';
const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

if (!stripeSecretKey || !stripeWebhookSecret || !supabaseUrl || !serviceRoleKey) {
  console.error('stripe-webhook missing required env vars');
}

const stripe = new Stripe(stripeSecretKey, {
  apiVersion: '2024-11-20',
});

const cryptoProvider = Stripe.createSubtleCryptoProvider();

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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

async function hasProcessedEvent(
  supabase: ReturnType<typeof createClient>,
  stripeEventId: string,
): Promise<boolean> {
  const columnCandidates = ['event_id', 'stripe_event_id', 'id'];

  for (const column of columnCandidates) {
    const { data, error } = await supabase
      .from('stripe_events')
      .select(column)
      .eq(column, stripeEventId)
      .limit(1)
      .maybeSingle();

    if (!error && data) return true;
    if (error && !/column|schema cache|does not exist/i.test(error.message)) {
      console.warn(`stripe_events idempotency check failed for ${column}: ${error.message}`);
    }
  }

  return false;
}

async function recordStripeEvent(
  supabase: ReturnType<typeof createClient>,
  event: Stripe.Event,
  status: 'processed' | 'failed' = 'processed',
  errorMessage?: string,
): Promise<void> {
  const nowIso = new Date().toISOString();
  const payloadBase = {
    event_type: event.type,
    payload: event,
    status,
    processed_at: nowIso,
    error_message: errorMessage ?? null,
  };

  const attempts: Record<string, unknown>[] = [
    { event_id: event.id, ...payloadBase },
    { stripe_event_id: event.id, type: event.type, payload: event, status, processed_at: nowIso, error_message: errorMessage ?? null },
    { id: event.id, ...payloadBase },
    { id: event.id, type: event.type, payload: event, created_at: nowIso },
  ];

  for (const row of attempts) {
    const { error } = await supabase.from('stripe_events').insert(row);
    if (!error) return;
    if (!/column|schema cache|does not exist/i.test(error.message)) {
      console.warn(`stripe_events insert failed: ${error.message}`);
    }
  }
}

async function findOrCreateCustomer(
  supabase: ReturnType<typeof createClient>,
  input: {
    email: string;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
    product: 'api' | 'drip';
    plan: string;
  },
): Promise<CustomerRow> {
  const desiredProduct = input.product === 'drip' ? 'drip_live' : 'api';

  if (input.stripeCustomerId) {
    const { data: existingByStripe } = await supabase
      .from('customers')
      .select('id,email,stripe_customer_id,stripe_subscription_id,product,plan,status')
      .eq('stripe_customer_id', input.stripeCustomerId)
      .limit(1)
      .maybeSingle();

    if (existingByStripe) {
      const { data: updated, error: updateError } = await supabase
        .from('customers')
        .update({
          email: input.email,
          product: desiredProduct,
          plan: input.plan,
          status: 'active',
          stripe_subscription_id: input.stripeSubscriptionId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingByStripe.id)
        .select('id,email,stripe_customer_id,stripe_subscription_id,product,plan,status')
        .limit(1)
        .maybeSingle();

      if (!updateError && updated) return updated as CustomerRow;
      if (updateError) {
        throw new Error(`customer_update_failed:${updateError.message}`);
      }
    }
  }

  const { data: existingByEmail } = await supabase
    .from('customers')
    .select('id,email,stripe_customer_id,stripe_subscription_id,product,plan,status')
    .eq('email', input.email)
    .limit(1)
    .maybeSingle();

  if (existingByEmail) {
    const { data: updated, error: updateError } = await supabase
      .from('customers')
      .update({
        stripe_customer_id: input.stripeCustomerId,
        stripe_subscription_id: input.stripeSubscriptionId,
        product: desiredProduct,
        plan: input.plan,
        status: 'active',
        updated_at: new Date().toISOString(),
      })
      .eq('id', existingByEmail.id)
      .select('id,email,stripe_customer_id,stripe_subscription_id,product,plan,status')
      .limit(1)
      .maybeSingle();

    if (updateError || !updated) {
      throw new Error(`customer_update_failed:${updateError?.message ?? 'unknown'}`);
    }
    return updated as CustomerRow;
  }

  const insertPayloads: Record<string, unknown>[] = [
    {
      email: input.email,
      stripe_customer_id: input.stripeCustomerId,
      stripe_subscription_id: input.stripeSubscriptionId,
      product: desiredProduct,
      plan: input.plan,
      status: 'active',
      created_at: new Date().toISOString(),
    },
    {
      email: input.email,
      stripe_customer_id: input.stripeCustomerId,
      stripe_subscription_id: input.stripeSubscriptionId,
      product: desiredProduct,
      tier: input.plan,
      status: 'active',
      created_at: new Date().toISOString(),
    },
  ];

  for (const payload of insertPayloads) {
    const { data, error } = await supabase
      .from('customers')
      .insert(payload)
      .select('id,email,stripe_customer_id,stripe_subscription_id,product,plan,status')
      .limit(1)
      .maybeSingle();

    if (!error && data) return data as CustomerRow;
    if (error && !/column|schema cache|does not exist/i.test(error.message)) {
      throw new Error(`customer_insert_failed:${error.message}`);
    }
  }

  throw new Error('customer_insert_failed:could_not_insert_customer');
}

async function insertKeyRetrievalToken(
  supabase: ReturnType<typeof createClient>,
  input: {
    sessionId: string;
    customerId: string;
    apiKeyPlaintext: string;
  },
): Promise<void> {
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  const payloads: Record<string, unknown>[] = [
    {
      stripe_session_id: input.sessionId,
      customer_id: input.customerId,
      api_key_plaintext: input.apiKeyPlaintext,
      expires_at: expiresAt,
      created_at: new Date().toISOString(),
    },
    {
      session_id: input.sessionId,
      customer_id: input.customerId,
      key_plaintext: input.apiKeyPlaintext,
      expires_at: expiresAt,
      created_at: new Date().toISOString(),
    },
    {
      stripe_session_id: input.sessionId,
      customer_id: input.customerId,
      api_key: input.apiKeyPlaintext,
      expires_at: expiresAt,
      created_at: new Date().toISOString(),
    },
  ];

  for (const payload of payloads) {
    const { error } = await supabase.from('key_retrieval_tokens').insert(payload);
    if (!error) return;
    if (!/column|schema cache|does not exist/i.test(error.message)) {
      throw new Error(`key_retrieval_insert_failed:${error.message}`);
    }
  }

  throw new Error('key_retrieval_insert_failed:no_supported_column_layout');
}

async function resolveCustomerIdByStripeCustomer(
  supabase: ReturnType<typeof createClient>,
  stripeCustomerId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('customers')
    .select('id')
    .eq('stripe_customer_id', stripeCustomerId)
    .limit(1)
    .maybeSingle();

  return data?.id ?? null;
}

async function handleCheckoutCompleted(
  supabase: ReturnType<typeof createClient>,
  event: Stripe.Event,
): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;
  const sessionId = normalizeText(session.id);
  const email = normalizeText(session.customer_details?.email ?? session.customer_email);

  if (!sessionId || !email) {
    throw new Error('checkout_missing_session_or_email');
  }

  const product = (session.metadata?.product === 'drip' ? 'drip' : 'api') as 'api' | 'drip';
  const plan = product === 'drip' ? 'drip_live' : 'pro';

  const stripeCustomerId = typeof session.customer === 'string' ? session.customer : null;
  const stripeSubscriptionId = typeof session.subscription === 'string' ? session.subscription : null;
  const customerName = normalizeText(session.customer_details?.name);

  const customer = await findOrCreateCustomer(supabase, {
    email,
    stripeCustomerId,
    stripeSubscriptionId,
    product,
    plan,
  });

  const generated = await callRpcWithVariants<unknown>(supabase, 'generate_api_key_for_customer', [
    {
      p_customer_id: customer.id,
      p_email: email,
      p_name: customerName,
      p_plan: plan,
    },
    {
      customer_id: customer.id,
      email,
      name: customerName,
      plan,
    },
  ]);

  const generatedRecord = unwrapRecord(generated);
  const apiKey =
    (typeof generated === 'string' ? generated : null) ??
    pickString(generatedRecord, ['key', 'new_key', 'api_key', 'plaintext_key']);

  if (!apiKey) {
    throw new Error('generate_api_key_failed:no_key_returned');
  }

  await insertKeyRetrievalToken(supabase, {
    sessionId,
    customerId: customer.id,
    apiKeyPlaintext: apiKey,
  });

  const retrievalBase = Deno.env.get('KEY_RETRIEVAL_BASE_URL') ?? `${supabaseUrl}/functions/v1/api-keys`;
  console.log(`KEY RETRIEVAL: ${retrievalBase}?action=retrieve&session_id=${sessionId}`);
}

async function handleSubscriptionDeleted(
  supabase: ReturnType<typeof createClient>,
  event: Stripe.Event,
): Promise<void> {
  const subscription = event.data.object as Stripe.Subscription;
  const stripeCustomerId = typeof subscription.customer === 'string' ? subscription.customer : null;

  if (!stripeCustomerId) return;

  const customerId = await resolveCustomerIdByStripeCustomer(supabase, stripeCustomerId);
  if (!customerId) return;

  try {
    await callRpcWithVariants(supabase, 'deactivate_customer_keys', [
      { p_customer_id: customerId },
      { customer_id: customerId },
    ]);
  } catch (error) {
    console.warn(`deactivate_customer_keys failed: ${error instanceof Error ? error.message : String(error)}`);
    await supabase
      .from('api_keys')
      .update({ active: false, revoked_at: new Date().toISOString() })
      .eq('customer_id', customerId)
      .eq('active', true);
  }

  await supabase
    .from('customers')
    .update({ status: 'canceled', updated_at: new Date().toISOString() })
    .eq('id', customerId);
}

async function handleSubscriptionUpdated(
  supabase: ReturnType<typeof createClient>,
  event: Stripe.Event,
): Promise<void> {
  const subscription = event.data.object as Stripe.Subscription;
  const stripeCustomerId = typeof subscription.customer === 'string' ? subscription.customer : null;
  const status = normalizeText(subscription.status)?.toLowerCase() ?? null;
  const stripeSubscriptionId = normalizeText(subscription.id);

  if (!stripeCustomerId || !status) return;

  const customerId = await resolveCustomerIdByStripeCustomer(supabase, stripeCustomerId);
  if (!customerId) return;

  if (['past_due', 'unpaid', 'canceled', 'incomplete_expired'].includes(status)) {
    try {
      await callRpcWithVariants(supabase, 'deactivate_customer_keys', [
        { p_customer_id: customerId },
        { customer_id: customerId },
      ]);
    } catch {
      await supabase
        .from('api_keys')
        .update({ active: false, revoked_at: new Date().toISOString() })
        .eq('customer_id', customerId)
        .eq('active', true);
    }
  }

  if (['active', 'trialing'].includes(status)) {
    await supabase
      .from('api_keys')
      .update({ active: true, revoked_at: null })
      .eq('customer_id', customerId)
      .is('revoked_at', null);
  }

  await supabase
    .from('customers')
    .update({
      status,
      stripe_subscription_id: stripeSubscriptionId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', customerId);
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed', message: 'Use POST' }, 405);
  }

  if (!stripeSecretKey || !stripeWebhookSecret || !supabaseUrl || !serviceRoleKey) {
    return jsonResponse(
      {
        error: 'server_not_configured',
        message: 'Missing Stripe or Supabase env vars',
      },
      500,
    );
  }

  const signature = request.headers.get('Stripe-Signature');
  if (!signature) {
    return jsonResponse({ error: 'missing_signature', message: 'Stripe-Signature header is required' }, 400);
  }

  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      stripeWebhookSecret,
      undefined,
      cryptoProvider,
    );
  } catch (error) {
    return jsonResponse(
      {
        error: 'invalid_signature',
        message: error instanceof Error ? error.message : 'Signature verification failed',
      },
      400,
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const alreadyProcessed = await hasProcessedEvent(supabase, event.id);
    if (alreadyProcessed) {
      return jsonResponse({ received: true, duplicate: true });
    }

    if (event.type === 'checkout.session.completed') {
      await handleCheckoutCompleted(supabase, event);
    } else if (event.type === 'customer.subscription.deleted') {
      await handleSubscriptionDeleted(supabase, event);
    } else if (event.type === 'customer.subscription.updated') {
      await handleSubscriptionUpdated(supabase, event);
    }

    await recordStripeEvent(supabase, event, 'processed');
    return jsonResponse({ received: true, type: event.type });
  } catch (error) {
    console.error(`stripe-webhook failed: ${error instanceof Error ? error.message : String(error)}`);
    await recordStripeEvent(supabase, event, 'failed', error instanceof Error ? error.message : String(error));
    return jsonResponse(
      {
        error: 'webhook_handler_failed',
        message: error instanceof Error ? error.message : 'Webhook handling failed',
      },
      500,
    );
  }
});
