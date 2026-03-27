export type CheckoutProduct = 'api' | 'drip';

// Google-native Cloud Functions base URL (Phase 4 migration)
const DEFAULT_FUNCTIONS_BASE_URL = 'https://us-central1-sportsync-evidence.cloudfunctions.net';

function normalizeBaseUrl(raw: string | undefined | null): string {
  const value = (raw ?? '').trim();
  if (!value) return DEFAULT_FUNCTIONS_BASE_URL;
  return value.replace(/\/+$/, '');
}

function sanitizeAccessErrorMessage(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string' || raw.trim().length === 0) return fallback;
  const redacted = raw
    .replace(/\b(?:sk|rk|pk)_(?:test|live)_[A-Za-z0-9]+\b/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim();

  const sensitivePattern = /(invalid api key|api key provided|secret key|authentication|permission denied|not configured)/i;
  if (sensitivePattern.test(redacted)) return fallback;
  if (redacted.length > 180) return fallback;
  return redacted;
}

export function getSportsyncFunctionsBaseUrl(): string {
  const env = import.meta.env as Record<string, string | undefined>;
  return normalizeBaseUrl(env.VITE_SPORTSYNC_FUNCTIONS_URL || env.NEXT_PUBLIC_SPORTSYNC_FUNCTIONS_URL);
}

export function getGatewayUrl(): string {
  return `${getSportsyncFunctionsBaseUrl()}/apiGateway`;
}

export function getApiKeysUrl(): string {
  return `${getSportsyncFunctionsBaseUrl()}/apiKeys`;
}

export function getStripeCheckoutUrl(): string {
  return `${getSportsyncFunctionsBaseUrl()}/stripeCheckout`;
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
    const message = sanitizeAccessErrorMessage(
      payload?.message,
      'Checkout is temporarily unavailable. Please try again in a minute.',
    );
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
    const message = sanitizeAccessErrorMessage(
      payload?.message,
      'Could not verify live access right now. Please try again.',
    );
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
  const trimmed = apiKey.trim();
  if (!/^ssk_[A-Za-z0-9]/.test(trimmed)) {
    return false;
  }

  const response = await fetch(`${getGatewayUrl()}?endpoint=health`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': trimmed,
    },
  });

  return response.ok;
}
