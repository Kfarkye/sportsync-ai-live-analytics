/**
 * Cloud Function: regenerateTeamTrends
 * ─────────────────────────────────────
 * Enterprise Grade — "Paste n Go" Zero Regression
 *
 * Final SRE Hardening Updates:
 * 1. Fail-Fast Config: Execution aborts immediately on missing secrets or site ID.
 * 2. Time-Bounded Fetches: 'Upcoming' requires STATUS_SCHEDULED and start_time >= now().
 * 3. Nearest-First Upcoming: Upcoming games ordered start_time.asc.
 * 4. Diff-Aware Publishing: Aborts the Firebase release if 0 bytes changed.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onRequest } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { initializeApp } from 'firebase-admin/app';
import { GoogleAuth } from 'google-auth-library';
import { createHash, createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

// ── Migrated endpoint deps (formerly @vercel/functions) ─────────────────────
import { GoogleGenAI } from '@google/genai';
import { generateObject } from 'ai';
import { google } from '@ai-sdk/google';
import { BettingPickSchema } from './lib/picks.js';
import { AIParsedSlipSchema } from './lib/betSlipSchema.js';
import { checkRateLimit } from './lib/rateLimit.js';
import { LruTtlCache } from './lib/lruTtlCache.js';
import { buildNbaPromptContextBlock } from './lib/nbaContextPolicy.js';
import { generateSatelliteSlug, isSatelliteConfigured } from './lib/satellite.js';
import {
  hasProcessedEvent,
  recordEvent,
  findOrCreateCustomer,
  generateApiKeyForCustomer,
  insertKeyRetrievalToken,
  deactivateCustomerKeys,
  reactivateCustomerKeys,
  updateCustomerStatus,
  resolveCustomerByStripe,
  validateApiKey,
  listCustomerKeys,
  rotateApiKey,
  revokeApiKeyByPrefix,
  retrieveKeyToken,
} from './lib/billing.js';

// ── Compute + render modules ─────────────────────────────────────────────────
import { NBA_TEAMS } from './lib/teams.js';
import { computeTeamStats } from './lib/compute.js';
import {
  buildTeamTrendPayload,
  renderTeamTrendPage,
  buildTrendsIndexPayload,
  renderTrendsIndexPage,
} from './lib/render.js';

const gzipAsync = promisify(gzip);
initializeApp();

// ── 1. Configuration & Fail-Fast ─────────────────────────────────────────────

class ConfigManager {
  static get() {
    const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_API_KEY;

    if (!supabaseKey) {
      const errMsg = 'CRITICAL: Supabase credentials are missing. Execution aborted.';
      logger.error(errMsg);
      throw new Error(errMsg);
    }

    if (!projectId) {
      logger.warn('⚠️ GCP Project ID missing from environment. Relying on defaults.');
    }

    return {
      supabaseUrl: process.env.SUPABASE_URL || 'https://qffzvrnbzabcokqqrwbv.supabase.co',
      supabaseKey,
      projectId: projectId || '',
      siteId: process.env.FIREBASE_SITE_ID || projectId || '',
    };
  }
}

// ── 2. Resiliency Utilities ──────────────────────────────────────────────────

class NetworkUtils {
  static async fetchWithRetry(url, options = {}, maxRetries = 3, timeoutMs = 15000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timeoutId);

        if (!response.ok) {
          const errText = await response.text().catch(() => 'Unknown Error');
          throw new Error(`HTTP ${response.status}: ${errText}`);
        }
        return response;
      } catch (error) {
        clearTimeout(timeoutId);

        if (attempt === maxRetries) {
          logger.error(`Fetch failed permanently after ${maxRetries} attempts`, { url: url.toString(), error: error.message });
          throw error;
        }

        const delayMs = Math.pow(2, attempt) * 500 + Math.random() * 200;
        logger.warn(`Fetch attempt ${attempt} failed, retrying in ${Math.round(delayMs)}ms...`, { url: url.toString() });
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }
}

// ── 3. Data Access Layer ─────────────────────────────────────────────────────

class SupabaseClient {
  constructor(config) {
    this.config = config;
    this.headers = {
      'apikey': this.config.supabaseKey,
      'Authorization': `Bearer ${this.config.supabaseKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
  }

  static normalizePropEvidencePack(rawPack) {
    const source = rawPack && typeof rawPack === 'object' ? rawPack : {};
    const cards = Array.isArray(source.cards) ? source.cards : [];
    const derivedMarkets = [...new Set(cards.map(card => card?.market).filter(Boolean))];
    const markets = Array.isArray(source.markets) && source.markets.length > 0 ? source.markets : derivedMarkets;
    const heroCards = cards.filter(card => Boolean(card?.baseline?.is_hero)).length;

    return {
      ...source,
      cards,
      markets,
      total_cards: Number.isFinite(Number(source.total_cards)) ? Number(source.total_cards) : cards.length,
      hero_cards: Number.isFinite(Number(source.hero_cards)) ? Number(source.hero_cards) : heroCards,
      generated_at: source.generated_at || new Date().toISOString(),
      version: source.version || 'v2',
      model: source.model || '3-layer: market_baseline + book_normalized + supporting_context',
      gates: source.gates || {
        book_min_gp: 3,
        edge_min_gp: 15,
        feature_min_gp: 30,
        support_min_gp: 5,
        baseline_min_gp: 10,
        max_support_chips: 3,
        hero_rate_threshold: 65,
      },
    };
  }

  async refreshMasterViews() {
    logger.info('⏳ Refreshing NBA master materialized views...');
    const nbaUrl = `${this.config.supabaseUrl}/rest/v1/rpc/refresh_nba_master_views`;
    const refUrl = `${this.config.supabaseUrl}/rest/v1/rpc/refresh_ref_tendencies_records`;

    try {
      await NetworkUtils.fetchWithRetry(nbaUrl, { method: 'POST', headers: this.headers, body: '{}' }, 1, 25000);
      logger.info('✅ Master views refreshed');

      logger.info('⏳ Refreshing ref tendencies aggregates...');
      await NetworkUtils.fetchWithRetry(
        refUrl,
        { method: 'POST', headers: this.headers, body: JSON.stringify({ p_sport: 'basketball' }) },
        1,
        25000
      );
      logger.info('✅ Ref tendencies refreshed');
    } catch (error) {
      logger.warn('⚠️ Master/ref refresh error (non-fatal):', { error: error.message });
    }
  }

  async generatePropEvidencePack() {
    logger.info('⏳ Generating prop evidence pack...');
    const url = `${this.config.supabaseUrl}/rest/v1/rpc/generate_prop_evidence_pack`;
    try {
      const res = await NetworkUtils.fetchWithRetry(
        url,
        { method: 'POST', headers: this.headers, body: '{}' },
        1,
        30000
      );
      const pack = SupabaseClient.normalizePropEvidencePack(await res.json());
      logger.info('✅ Prop evidence pack generated', {
        total_cards: pack?.total_cards,
        hero_cards: pack?.hero_cards,
      });
      return pack;
    } catch (error) {
      logger.error('❌ Prop evidence pack generation failed:', { error: error.message });
      throw error;
    }
  }

  async fetchGames(status) {
    const isCompleted = status === 'completed';
    const nowIso = new Date().toISOString();

    // Strict time boundaries prevent historical ghost-data from polluting upcoming
    const filter = isCompleted
      ? 'status=eq.STATUS_FINAL'
      : `status=eq.STATUS_SCHEDULED&start_time=gte.${nowIso}`;

    // [FIX 1] Nearest-first ordering for upcoming, most-recent-first for completed
    const order = isCompleted ? 'start_time.desc' : 'start_time.asc';

    const baseUrl = `${this.config.supabaseUrl}/rest/v1/matches?league_id=eq.nba&${filter}` +
      `&select=id,start_time,home_team,away_team,home_score,away_score,status,closing_odds,opening_odds` +
      `&order=${order}`;

    const PAGE_SIZE = 1000;
    const MAX_PAGES = 50;

    const allRows = [];
    let offset = 0;

    for (let page = 0; page < MAX_PAGES; page++) {
      const pageUrl = `${baseUrl}&limit=${PAGE_SIZE}&offset=${offset}`;
      const res = await NetworkUtils.fetchWithRetry(pageUrl, { headers: this.headers });

      const rows = await res.json();
      allRows.push(...rows);

      if (rows.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;

      if (page === MAX_PAGES - 1) {
        logger.error('CRITICAL: Supabase fetchGames reached max pagination circuit breaker.');
      }
    }

    return allRows;
  }
}

// ── 4. Infrastructure Layer (Deploy) ─────────────────────────────────────────

class FirebaseHostingDeployer {
  static API_BASE = 'https://firebasehosting.googleapis.com/v1beta1';
  static UPLOAD_CONCURRENCY = 20;

  constructor(config) {
    this.config = config;
  }

  async deploy(files) {
    // [FIX 2] Hard fail. The entire purpose of this pipeline is to deploy.
    if (!this.config.siteId) {
      const errMsg = 'CRITICAL: Cannot deploy. FIREBASE_SITE_ID or Project ID is missing.';
      logger.error(errMsg);
      throw new Error(errMsg);
    }

    const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/firebase.hosting'] });
    const client = await auth.getClient();
    const siteUrl = `${FirebaseHostingDeployer.API_BASE}/sites/${this.config.siteId}`;

    logger.info('Creating new Hosting version draft...');

    const versionRes = await client.request({
      url: `${siteUrl}/versions`,
      method: 'POST',
      data: {
        config: {
          cleanUrls: true,
          headers: [{ glob: '**', headers: { 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff' } }]
        }
      }
    });
    const versionName = versionRes.data.name;
    const versionUrl = `${FirebaseHostingDeployer.API_BASE}/${versionName}`;

    const fileHashes = {};
    const hashToContent = {};

    await Promise.all(
      Object.entries(files).map(async ([path, content]) => {
        const gzipped = await gzipAsync(Buffer.from(content, 'utf-8'));
        const hash = createHash('sha256').update(gzipped).digest('hex');
        fileHashes[`/${path}`] = hash;
        hashToContent[hash] = gzipped;
      })
    );

    logger.info(`Populating ${Object.keys(fileHashes).length} files...`);
    const populateRes = await client.request({
      url: `${versionUrl}:populateFiles`,
      method: 'POST',
      data: { files: fileHashes },
    });

    const uploadUrl = populateRes.data.uploadUrl;
    const requiredHashes = populateRes.data.uploadRequiredHashes || [];

    // Diff-Aware Publish Check
    if (requiredHashes.length === 0) {
      logger.info('🛑 Diff-Aware Check: 0 files modified. Abandoning release draft to maintain clean history.');
      await client.request({
        url: versionUrl,
        method: 'PATCH',
        params: { updateMask: 'status' },
        data: { status: 'ABANDONED' }
      }).catch(e => logger.warn('Failed to abandon release.', { error: e.message }));
      return false;
    }

    logger.info(`Uploading ${requiredHashes.length} changed file(s)...`);
    for (let i = 0; i < requiredHashes.length; i += FirebaseHostingDeployer.UPLOAD_CONCURRENCY) {
      const batch = requiredHashes.slice(i, i + FirebaseHostingDeployer.UPLOAD_CONCURRENCY);
      await Promise.all(
        batch.map(hash =>
          client.request({
            url: `${uploadUrl}/${hash}`,
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            data: hashToContent[hash],
            body: hashToContent[hash],
          })
        )
      );
    }

    logger.info('Finalizing version...');
    await client.request({ url: versionUrl, method: 'PATCH', params: { updateMask: 'status' }, data: { status: 'FINALIZED' } });

    logger.info('Releasing...');
    await client.request({ url: `${siteUrl}/releases`, method: 'POST', params: { versionName } });

    logger.info('✅ Deployed new content to Firebase Hosting');
    return true;
  }
}

// ── 5. Core Orchestration ────────────────────────────────────────────────────

async function orchestratePipeline(config) {
  const db = new SupabaseClient(config);
  const hosting = new FirebaseHostingDeployer(config);

  await db.refreshMasterViews();

  logger.info('⏳ Fetching completed and upcoming games...');
  const [completedGames, upcomingGames] = await Promise.all([
    db.fetchGames('completed'),
    db.fetchGames('upcoming')
  ]);
  logger.info(`   → ${completedGames.length} completed games`);
  logger.info(`   → ${upcomingGames.length} upcoming games`);

  // [FIX 3] Compute a data-driven date to anchor "freshness" to the last resolved event
  const latestDataDate = completedGames.length > 0
    ? new Date(completedGames[0].start_time).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  const files = {};
  const teamPayloads = [];

  for (const team of NBA_TEAMS) {
    const stats = computeTeamStats(team.name, completedGames, upcomingGames);
    if (!stats) {
      logger.warn(`⚠️  No games for ${team.name}`);
      continue;
    }
    const teamPayload = buildTeamTrendPayload(team, stats, { generatedDate: latestDataDate });
    teamPayloads.push(teamPayload);
    files[`trends/${team.slug}.html`] = renderTeamTrendPage(teamPayload);
    files[`trends/${team.slug}.json`] = JSON.stringify(teamPayload, null, 2);
  }

  if (teamPayloads.length > 0) {
    const indexPayload = buildTrendsIndexPayload(teamPayloads, { generatedDate: latestDataDate });
    files['trends/index.html'] = renderTrendsIndexPage(indexPayload);
    files['trends/index.json'] = JSON.stringify(indexPayload, null, 2);
    logger.info(`✅ Index (${teamPayloads.length} teams)`);
  }

  const deployed = await hosting.deploy(files);
  return { files: Object.keys(files).length, deployed };
}

// ── 7. Cloud Function Entrypoints ────────────────────────────────────────────

const FUNCTION_OPTS = {
  region: 'us-central1',
  timeoutSeconds: 300,
  memory: '512MiB',
  secrets: ['SUPABASE_SERVICE_KEY'],
};

export const regenerateTeamTrends = onSchedule(
  { ...FUNCTION_OPTS, schedule: '0 10 * * *', timeZone: 'America/New_York' },
  async () => {
    try {
      logger.info('🏀 CRON START: Regenerating team trends...');
      const config = ConfigManager.get();
      await orchestratePipeline(config);
      logger.info('🏁 CRON SUCCESS: Execution completed gracefully.');
    } catch (error) {
      logger.error('CRITICAL FAILURE during scheduled regeneration', { error: error.stack || error.message });
      throw error;
    }
  }
);

export const regenerateTeamTrendsHttp = onRequest(
  FUNCTION_OPTS,
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('POST only');
      return;
    }

    try {
      logger.info('🏀 HTTP START: Manual team trends regeneration...');
      const config = ConfigManager.get();
      const result = await orchestratePipeline(config);

      res.json({ status: 'ok', files: result.files, deployed: result.deployed });
    } catch (error) {
      logger.error('CRITICAL FAILURE during HTTP regeneration', { error: error.stack || error.message });
      res.status(500).json({ status: 'error', message: 'Internal Server Error' });
    }
  }
);


// ── Stripe Billing: Cloud Functions (Phase 4 Migration) ─────────────────────

function corsHeaders(res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, x-api-key, Stripe-Signature');
}

// ── stripeWebhook ────────────────────────────────────────────────────────────
//
// Handles: checkout.session.completed, customer.subscription.updated/deleted
// Idempotent via billing_events collection.
// Stripe signature verification via raw body parsing.

export const stripeWebhook = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 60,
    memory: '256MiB',
    secrets: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'method_not_allowed' });
      return;
    }

    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!stripeSecretKey || !webhookSecret) {
      console.error('stripeWebhook: missing secrets');
      res.status(500).json({ error: 'server_not_configured' });
      return;
    }

    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-11-20' });
    const signature = req.headers['stripe-signature'];
    if (!signature) {
      res.status(400).json({ error: 'missing_signature' });
      return;
    }

    // Cloud Functions v2 provides req.rawBody for webhook verification
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.rawBody, signature, webhookSecret);
    } catch (err) {
      console.error('Signature verification failed:', err.message);
      res.status(400).json({ error: 'invalid_signature', message: err.message });
      return;
    }

    try {
      // Idempotency check
      if (await hasProcessedEvent(event.id)) {
        res.json({ received: true, duplicate: true });
        return;
      }

      // ── checkout.session.completed ──────────────────────────────────────
      if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const email = (session.customer_details?.email || session.customer_email || '').trim().toLowerCase();
        if (!email) throw new Error('checkout_missing_email');

        const product = session.metadata?.product === 'drip' ? 'drip' : 'api';
        const plan = product === 'drip' ? 'drip_live' : 'pro';
        const stripeCustomerId = typeof session.customer === 'string' ? session.customer : null;
        const stripeSubId = typeof session.subscription === 'string' ? session.subscription : null;

        const customer = await findOrCreateCustomer({
          email,
          stripeCustomerId,
          stripeSubscriptionId: stripeSubId,
          product,
          plan,
          name: session.customer_details?.name || null,
        });

        const { plaintext } = await generateApiKeyForCustomer({
          customerId: customer.docId,
          email,
          plan,
        });

        await insertKeyRetrievalToken({
          sessionId: session.id,
          customerId: customer.docId,
          apiKeyPlaintext: plaintext,
        });

        console.log(`✅ checkout.completed: ${email} → ${product}/${plan}`);
      }

      // ── customer.subscription.updated ──────────────────────────────────
      else if (event.type === 'customer.subscription.updated') {
        const sub = event.data.object;
        const stripeCustomerId = typeof sub.customer === 'string' ? sub.customer : null;
        const status = (sub.status || '').toLowerCase();
        if (!stripeCustomerId || !status) {
          console.warn('subscription.updated: missing customer or status');
          await recordEvent(event, 'skipped');
          res.json({ received: true, skipped: true });
          return;
        }

        const customer = await resolveCustomerByStripe(stripeCustomerId);
        if (!customer) {
          console.warn(`subscription.updated: unknown customer ${stripeCustomerId}`);
          await recordEvent(event, 'skipped', 'unknown_customer');
          res.json({ received: true, skipped: true });
          return;
        }

        // Deactivate on lapsed states
        if (['past_due', 'unpaid', 'canceled', 'incomplete_expired'].includes(status)) {
          await deactivateCustomerKeys(customer.docId);
        }
        // Reactivate on active states (FIXES the old bug)
        if (['active', 'trialing'].includes(status)) {
          await reactivateCustomerKeys(customer.docId);
        }

        await updateCustomerStatus(stripeCustomerId, status, sub.id);
        console.log(`✅ subscription.updated: ${stripeCustomerId} → ${status}`);
      }

      // ── customer.subscription.deleted ──────────────────────────────────
      else if (event.type === 'customer.subscription.deleted') {
        const sub = event.data.object;
        const stripeCustomerId = typeof sub.customer === 'string' ? sub.customer : null;
        if (!stripeCustomerId) {
          await recordEvent(event, 'skipped');
          res.json({ received: true, skipped: true });
          return;
        }

        const customer = await resolveCustomerByStripe(stripeCustomerId);
        if (customer) {
          await deactivateCustomerKeys(customer.docId);
          await updateCustomerStatus(stripeCustomerId, 'canceled');
        }
        console.log(`✅ subscription.deleted: ${stripeCustomerId}`);
      }

      await recordEvent(event, 'processed');
      res.json({ received: true, type: event.type });
    } catch (err) {
      console.error(`stripeWebhook failed: ${err.message}`);
      await recordEvent(event, 'failed', err.message);
      res.status(500).json({ error: 'webhook_handler_failed', message: err.message });
    }
  }
);

// ── stripeCheckout ───────────────────────────────────────────────────────────
//
// Creates a Stripe Checkout Session for API or Drip products.
// Returns { checkout_url, session_id, product }.

export const stripeCheckout = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 30,
    memory: '256MiB',
    secrets: ['STRIPE_SECRET_KEY'],
    cors: true,
  },
  async (req, res) => {
    corsHeaders(res);

    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'method_not_allowed' });
      return;
    }

    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      res.status(500).json({ error: 'server_not_configured' });
      return;
    }

    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-11-20' });
    const { product, email } = req.body || {};

    if (product !== 'api' && product !== 'drip') {
      res.status(400).json({ error: 'invalid_product', message: 'product must be api or drip' });
      return;
    }

    const normalizedEmail = (email || '').trim().toLowerCase();
    if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      res.status(400).json({ error: 'invalid_email', message: 'A valid email is required' });
      return;
    }

    // Price IDs — loaded from env or hardcoded fallback
    const API_PRICE_ID = process.env.STRIPE_API_PRICE_ID || 'price_1TEl0Y97mribFvjl1UV7PVUS';
    const DRIP_PRICE_ID = process.env.STRIPE_DRIP_PRICE_ID || 'price_1TEl5r97mribFvjlflsOVX8i';
    const SPORTSYNC_URL = process.env.SPORTSYNC_SITE_URL || 'https://sportsync-api.com';
    const DRIP_URL = process.env.DRIP_SITE_URL || 'https://thedrip.to';

    const isApi = product === 'api';
    const priceId = isApi ? API_PRICE_ID : DRIP_PRICE_ID;
    const baseUrl = isApi ? SPORTSYNC_URL : DRIP_URL;

    try {
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        payment_method_types: ['card'],
        customer_email: normalizedEmail,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${baseUrl}/welcome?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/pricing`,
        metadata: { product },
      });

      if (!session.url) {
        res.status(500).json({ error: 'checkout_session_failed', message: 'Stripe did not return a URL' });
        return;
      }

      res.json({ checkout_url: session.url, session_id: session.id, product });
    } catch (err) {
      console.error('stripeCheckout error:', err.message);
      // Redact sensitive info
      const safeMsg = /invalid api key|secret key|authentication/i.test(err.message)
        ? 'Checkout is temporarily unavailable.'
        : err.message;
      res.status(500).json({ error: 'stripe_error', message: safeMsg });
    }
  }
);

// ── apiKeys (key management endpoint) ────────────────────────────────────────
//
// GET  ?action=retrieve&session_id=...  → post-checkout key retrieval
// GET  ?action=list                     → list customer's keys (auth: x-api-key)
// POST ?action=rotate                   → rotate key (auth: x-api-key)
// POST ?action=revoke { key_prefix }    → revoke specific key (auth: x-api-key)

export const apiKeys = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 30,
    memory: '256MiB',
  },
  async (req, res) => {
    corsHeaders(res);

    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    const action = (req.query.action || '').toLowerCase();
    if (!action) {
      res.status(400).json({ error: 'missing_action' });
      return;
    }

    try {
      // ── Retrieve (no auth — uses session token) ──────────────────────
      if (action === 'retrieve') {
        const sessionId = (req.query.session_id || '').trim();
        if (!sessionId) {
          res.status(400).json({ error: 'missing_session_id' });
          return;
        }

        const token = await retrieveKeyToken(sessionId);
        if (!token) {
          res.status(404).json({ error: 'invalid_session', message: 'Session is invalid, expired, or already used' });
          return;
        }

        res.set('Cache-Control', 'no-store');
        res.json({ key: token.key });
        return;
      }

      // ── Auth required for list/rotate/revoke ─────────────────────────
      const rawKey = (req.headers['x-api-key'] || '').trim();
      if (!rawKey) {
        res.status(401).json({ error: 'missing_api_key' });
        return;
      }

      const keyData = await validateApiKey(rawKey);
      if (!keyData) {
        res.status(401).json({ error: 'invalid_api_key' });
        return;
      }

      if (action === 'list') {
        const keys = await listCustomerKeys(keyData.customer_id);
        res.set('Cache-Control', 'no-store');
        res.json(keys);
      } else if (action === 'rotate') {
        const { createHash: _h } = await import('node:crypto');
        const oldHash = _h('sha256').update(rawKey, 'utf8').digest('hex');
        const result = await rotateApiKey(oldHash);
        res.set('Cache-Control', 'no-store');
        res.json(result);
      } else if (action === 'revoke') {
        const { key_prefix } = req.body || {};
        if (!key_prefix) {
          res.status(400).json({ error: 'missing_key_prefix' });
          return;
        }
        const result = await revokeApiKeyByPrefix(keyData.customer_id, key_prefix);
        res.json(result);
      } else {
        res.status(400).json({ error: 'unsupported_action', message: `Unknown: ${action}` });
      }
    } catch (err) {
      console.error(`apiKeys error: ${err.message}`);
      res.status(500).json({ error: 'request_failed', message: err.message });
    }
  }
);

// ── Prop Evidence Pack Endpoint ──────────────────────────────────────────────
export const refreshPropEvidencePack = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 60,
    memory: '256MiB',
    secrets: ['SUPABASE_SERVICE_KEY'],
    cors: true,
  },
  async (req, res) => {
    try {
      const config = {
        supabaseUrl: process.env.SUPABASE_URL || 'https://qffzvrnbzabcokqqrwbv.supabase.co',
        supabaseKey: process.env.SUPABASE_SERVICE_KEY,
      };
      if (!config.supabaseKey) {
        res.status(500).json({ error: 'missing_config', message: 'SUPABASE_SERVICE_KEY not set' });
        return;
      }
      const client = new SupabaseClient(config);
      const pack = await client.generatePropEvidencePack();
      res.set('Cache-Control', 'public, max-age=300, s-maxage=600');
      res.json(pack);
    } catch (err) {
      logger.error(`refreshPropEvidencePack error: ${err.message}`);
      res.status(500).json({ error: 'generation_failed', message: err.message });
    }
  }
);
// ── Live Satellite Endpoints (Native Cloud Functions) ────────────────────────
//
// Serves HMAC-signed live game data for Gemini's urlContext tool.
// Runs natively on Google infrastructure — no Vercel proxy required.
// Routes: /api/live/scores/{slug}, /api/live/odds/{slug}, /api/live/pbp/{slug}
//
// Migrated from Vercel serverless functions to eliminate domain-blocking issues
// and remove the Vercel dependency from the Gemini grounding data path.

const GAME_ID_RE = /^[\w-]{4,128}$/;
const SLUG_RE = /^[0-9a-f]{64}$/;
const NONCE_RE = /^[0-9a-f]{32}$/;

// In-memory rate limiter (per Cloud Function instance)
const _satHits = new Map();
const _SAT_WINDOW_MS = 60_000;
const _SAT_LIMIT = 60;

function _satRateLimit(req) {
  const ip = req.headers['x-forwarded-for']?.split(',').pop()?.trim()
    || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const record = _satHits.get(ip);
  if (!record || now - record.start > _SAT_WINDOW_MS) {
    _satHits.set(ip, { start: now, count: 1 });
    return true;
  }
  record.count++;
  return record.count <= _SAT_LIMIT;
}

function _validateSlug(slug, gameId, endpoint, nonce) {
  // Read at invocation time — Cloud Functions v2 injects secrets after module load
  const secret = process.env.SATELLITE_SECRET;
  if (!slug || !gameId || !endpoint || !nonce || !secret) return false;
  const now = Math.floor(Date.now() / 60_000);
  for (const bucket of [now, now - 1]) {
    const payload = `${gameId}:${endpoint}:${bucket}:${nonce}`;
    const expected = createHmac('sha512', secret)
      .update(payload)
      .digest('hex')
      .slice(0, 64);
    if (slug.length === expected.length) {
      const a = Buffer.from(slug, 'hex');
      const b = Buffer.from(expected, 'hex');
      if (a.length === b.length && timingSafeEqual(a, b)) return true;
    }
  }
  return false;
}

function _getSatelliteSupabase() {
  const url = process.env.SUPABASE_URL || 'https://qffzvrnbzabcokqqrwbv.supabase.co';
  // Read at invocation time — secrets injected after module load
  const key = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!key) return null;
  return createClient(url, key);
}

export const liveSatellite = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 15,
    memory: '256MiB',
    secrets: ['SATELLITE_SECRET', 'SUPABASE_ANON_KEY'],
    cors: true,
  },
  async (req, res) => {
    if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    if (!_satRateLimit(req)) {
      res.status(429).json({ error: 'Rate limit exceeded' });
      return;
    }

    // Parse path: /api/live/{endpoint}/{slug}
    const pathParts = (req.path || '').replace(/^\/+/, '').split('/');
    // Expected: ['api', 'live', endpoint, slug]
    if (pathParts.length < 4 || pathParts[0] !== 'api' || pathParts[1] !== 'live') {
      res.status(400).json({ error: 'Invalid path', expected: '/api/live/{scores|odds|pbp}/{slug}' });
      return;
    }

    const endpoint = pathParts[2]; // 'scores' | 'odds' | 'pbp'
    const slug = pathParts[3];
    const gameId = req.query.g;
    const nonce = req.query.n;

    if (!['scores', 'odds', 'pbp'].includes(endpoint)) {
      res.status(400).json({ error: 'Invalid endpoint', valid: ['scores', 'odds', 'pbp'] });
      return;
    }

    if (!slug || !SLUG_RE.test(slug)) {
      res.status(400).json({ error: 'Invalid slug' });
      return;
    }
    if (!gameId || !GAME_ID_RE.test(gameId)) {
      res.status(400).json({ error: 'Invalid game_id' });
      return;
    }
    if (!nonce || !NONCE_RE.test(nonce)) {
      res.status(400).json({ error: 'Invalid nonce' });
      return;
    }

    if (!process.env.SATELLITE_SECRET) {
      logger.error('SATELLITE_SECRET not configured');
      res.status(500).json({ error: 'Server not configured' });
      return;
    }

    if (!_validateSlug(slug, gameId, endpoint, nonce)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const supabase = _getSatelliteSupabase();
    if (!supabase) {
      logger.error('Supabase credentials not configured for satellite endpoints');
      res.status(500).json({ error: 'Server not configured' });
      return;
    }

    try {
      if (endpoint === 'scores') {
        const { data, error } = await supabase
          .from('live_game_state')
          .select('id, game_status, period, display_clock, home_team, away_team, home_score, away_score, updated_at')
          .eq('id', gameId)
          .maybeSingle();

        if (error) throw error;
        if (!data) { res.status(404).json({ error: 'Game not found' }); return; }

        res.set('Content-Type', 'application/json');
        res.set('Cache-Control', 'public, max-age=15, stale-while-revalidate=30');
        res.json({
          game_id: data.id,
          status: data.game_status,
          clock: data.display_clock,
          period: data.period,
          home: { team: data.home_team, score: data.home_score },
          away: { team: data.away_team, score: data.away_score },
          updated_at: data.updated_at,
        });

      } else if (endpoint === 'odds') {
        const { data, error } = await supabase
          .from('live_game_state')
          .select('id, odds, t60_snapshot, t0_snapshot, updated_at')
          .eq('id', gameId)
          .maybeSingle();

        if (error) throw error;
        if (!data) { res.status(404).json({ error: 'Game not found' }); return; }

        const current = data.odds || {};
        const opening = data.t60_snapshot?.odds || data.t0_snapshot?.odds || {};
        const movement = [];
        if (data.t0_snapshot?.odds?.spread !== undefined) {
          movement.push({ label: 'open', spread: data.t0_snapshot.odds.spread, total: data.t0_snapshot.odds.total });
        }
        if (data.t60_snapshot?.odds?.spread !== undefined) {
          movement.push({ label: 't-60', spread: data.t60_snapshot.odds.spread, total: data.t60_snapshot.odds.total });
        }
        if (current.spread !== undefined) {
          movement.push({ label: 'current', spread: current.spread, total: current.total });
        }

        res.set('Content-Type', 'application/json');
        res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
        res.json({
          game_id: data.id,
          consensus: {
            spread: current.spread,
            total: current.total,
            moneyline_home: current.moneyline_home ?? current.moneylineHome,
            moneyline_away: current.moneyline_away ?? current.moneylineAway,
          },
          opening: { spread: opening.spread, total: opening.total },
          movement,
          updated_at: data.updated_at,
        });

      } else if (endpoint === 'pbp') {
        const { data, error } = await supabase
          .from('live_game_state')
          .select('id, home_team, away_team, home_score, away_score, leaders, recent_plays, last_play, updated_at')
          .eq('id', gameId)
          .maybeSingle();

        if (error) throw error;
        if (!data) { res.status(404).json({ error: 'Game not found' }); return; }

        const leaders = data.leaders || {};
        const recentPlays = Array.isArray(data.recent_plays)
          ? data.recent_plays
          : [];

        res.set('Content-Type', 'application/json');
        res.set('Cache-Control', 'public, max-age=15, stale-while-revalidate=30');
        res.json({
          game_id: data.id,
          last_play: data.last_play || null,
          leaders,
          recent_plays: recentPlays,
          score: { home: data.home_score, away: data.away_score },
          updated_at: data.updated_at,
        });
      }
    } catch (err) {
      logger.error(`liveSatellite [${endpoint}] error`, { gameId, message: err.message });
      res.status(500).json({ error: 'Internal error' });
    }
  }
);

// ── ESPN Proxy (Native Cloud Function) ──────────────────────────────────────
const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports';
const ESPN_TIMEOUT_MS = 8000;

function sanitizeEspnEndpoint(endpoint) {
  if (!endpoint || typeof endpoint !== 'string') return null;
  let decoded = endpoint;
  try { decoded = decodeURIComponent(endpoint); } catch {}
  const trimmed = decoded.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.origin !== 'https://site.api.espn.com') return null;
      const normalized = parsed.pathname + parsed.search + parsed.hash;
      return normalized.startsWith('/apis/site/v2/sports/')
        ? normalized.replace('/apis/site/v2/sports/', '') : null;
    } catch { return null; }
  }
  if (trimmed.includes('://')) return null;
  return trimmed.startsWith('/') ? trimmed.substring(1) : trimmed;
}

export const espnProxy = onRequest(
  { region: 'us-central1', timeoutSeconds: 15, memory: '256MiB', cors: true },
  async (req, res) => {
    corsHeaders(res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' }); return;
    }
    let endpoint = req.query?.endpoint;
    if (!endpoint && req.method === 'POST') {
      try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        endpoint = body?.endpoint;
      } catch { endpoint = null; }
    }
    const cleaned = sanitizeEspnEndpoint(endpoint);
    if (!cleaned) { res.status(400).json({ error: 'Missing or invalid endpoint parameter' }); return; }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ESPN_TIMEOUT_MS);
    try {
      const upstream = await fetch(`${ESPN_BASE}/${cleaned}`, {
        method: 'GET', signal: controller.signal,
        headers: { 'User-Agent': 'sportsync-drip-proxy/1.0', Accept: 'application/json' }
      });
      clearTimeout(timeout);
      if (!upstream.ok) { res.status(upstream.status).json({ error: `ESPN API error ${upstream.status}` }); return; }
      const payload = await upstream.json();
      res.set('Cache-Control', 'public, max-age=10');
      res.status(200).json(payload);
    } catch (error) {
      clearTimeout(timeout);
      logger.error('[ESPN Proxy] Upstream fetch failed:', error?.message);
      res.status(502).json({ error: 'Upstream fetch failed' });
    }
  }
);

// ── Re-export migrated handlers (formerly Vercel serverless) ────────────────
export { baseballLive } from './handlers/baseballLive.js';
export { extractSlip } from './handlers/extractSlip.js';
export { chatHandler } from './handlers/chatHandler.js';
export { cronHandler } from './handlers/cronHandler.js';

// ── Live Game Intelligence (unified endpoint for Human + AI + SEO) ──────────
import { handleLiveGameIntel } from './handlers/liveGameIntel.js';
export const liveGameIntel = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 15,
    memory: '256MiB',
    secrets: ['SUPABASE_ANON_KEY'],
    cors: true,
  },
  handleLiveGameIntel
);
