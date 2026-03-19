export type CheckoutProduct = 'api' | 'drip';

const DEFAULT_SPORTSYNC_PROJECT_URL = 'https://hylnixnuabtnmjcdnujm.supabase.co';

function normalizeBaseUrl(raw: string | undefined | null): string {
  const value = (raw ?? '').trim();
  if (!value) return DEFAULT_SPORTSYNC_PROJECT_URL;
  return value.replace(/\/+$/, '');
}

export function getSportsyncProjectUrl(): string {
  const env = import.meta.env as Record<string, string | undefined>;
  return normalizeBaseUrl(env.VITE_SPORTSYNC_SUPABASE_URL || env.NEXT_PUBLIC_SPORTSYNC_SUPABASE_URL);
}

export function getSportsyncFunctionsBaseUrl(): string {
  return `${getSportsyncProjectUrl()}/functions/v1`;
}

export function getGatewayUrl(): string {
  return `${getSportsyncFunctionsBaseUrl()}/api`;
}

export function getApiKeysUrl(): string {
  return `${getSportsyncFunctionsBaseUrl()}/api-keys`;
}

export function getStripeCheckoutUrl(): string {
  return `${getSportsyncFunctionsBaseUrl()}/stripe-checkout`;
}

export async function createCheckoutSession(product: CheckoutProduct, email: string): Promise<string> {
  const response = await fetch(getStripeCheckoutUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ product, email }),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = typeof payload?.message === 'string' ? payload.message : 'Could not start checkout.';
    throw new Error(message);
  }

  const checkoutUrl = typeof payload?.checkout_url === 'string' ? payload.checkout_url : null;
  if (!checkoutUrl) {
    throw new Error('Checkout URL was not returned.');
  }

  return checkoutUrl;
}

export async function retrieveApiKey(sessionId: string): Promise<{ key: string; plan?: string; product?: string; email?: string }> {
  const url = `${getApiKeysUrl()}?action=retrieve&session_id=${encodeURIComponent(sessionId)}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = typeof payload?.message === 'string' ? payload.message : 'Could not retrieve API key.';
    throw new Error(message);
  }

  if (typeof payload?.key !== 'string' || payload.key.trim().length === 0) {
    throw new Error('Retrieved payload did not include an API key.');
  }

  return {
    key: payload.key,
    plan: typeof payload?.plan === 'string' ? payload.plan : undefined,
    product: typeof payload?.product === 'string' ? payload.product : undefined,
    email: typeof payload?.email === 'string' ? payload.email : undefined,
  };
}

export async function validateGatewayKey(apiKey: string): Promise<boolean> {
  const response = await fetch(`${getGatewayUrl()}?endpoint=health`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
  });

  return response.ok;
}
