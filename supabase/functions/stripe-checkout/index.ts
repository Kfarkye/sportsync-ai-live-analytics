import Stripe from 'https://esm.sh/stripe@14?target=denonext';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

type CheckoutBody = {
  product?: 'api' | 'drip';
  email?: string;
};

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(trimmed) ? trimmed : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed', message: 'Use POST' }, 405);
  }

  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
  const apiPriceId = Deno.env.get('STRIPE_API_PRICE_ID') ?? '';
  const dripPriceId = Deno.env.get('STRIPE_DRIP_PRICE_ID') ?? '';
  const sportsyncSiteUrl = Deno.env.get('SPORTSYNC_SITE_URL') ?? 'https://sportsync-api.com';
  const dripSiteUrl = Deno.env.get('DRIP_SITE_URL') ?? 'https://thedrip.to';

  if (!stripeSecretKey || !apiPriceId || !dripPriceId) {
    return jsonResponse(
      {
        error: 'server_not_configured',
        message: 'Stripe secrets are missing',
      },
      500,
    );
  }

  const stripe = new Stripe(stripeSecretKey, {
    apiVersion: '2024-11-20',
  });

  let body: CheckoutBody;
  try {
    body = (await req.json()) as CheckoutBody;
  } catch {
    return jsonResponse({ error: 'invalid_json', message: 'Request body must be valid JSON' }, 400);
  }

  const product = body.product;
  if (product !== 'api' && product !== 'drip') {
    return jsonResponse({ error: 'invalid_product', message: 'product must be api or drip' }, 400);
  }

  const email = normalizeEmail(body.email);
  if (!email) {
    return jsonResponse({ error: 'invalid_email', message: 'A valid email is required' }, 400);
  }

  const isApiProduct = product === 'api';
  const priceId = isApiProduct ? apiPriceId : dripPriceId;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer_email: email,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: isApiProduct
        ? `${sportsyncSiteUrl}/welcome?session_id={CHECKOUT_SESSION_ID}`
        : `${dripSiteUrl}/live?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: isApiProduct
        ? `${sportsyncSiteUrl}/pricing`
        : `${dripSiteUrl}/pricing`,
      metadata: {
        product,
      },
    });

    if (!session.url) {
      return jsonResponse(
        {
          error: 'checkout_session_failed',
          message: 'Stripe did not return a checkout URL',
        },
        500,
      );
    }

    return jsonResponse({
      checkout_url: session.url,
      session_id: session.id,
      product,
    });
  } catch (error) {
    return jsonResponse(
      {
        error: 'stripe_error',
        message: error instanceof Error ? error.message : 'Checkout session creation failed',
      },
      500,
    );
  }
});
