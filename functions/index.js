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
import { createHash } from 'node:crypto';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import Stripe from 'stripe';
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
import { renderTeamPage } from './lib/render.js';

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

// ── 5. Presentation Layer ────────────────────────────────────────────────────

function renderIndexPage(teamSummaries, dataDrivenDate) {
  const rows = teamSummaries
    .sort((a, b) => b.home.overPct - a.home.overPct)
    .map(s => {
      const team = NBA_TEAMS.find(t => t.name === s.teamName);
      if (!team) return '';
      return `<tr>
        <td style="font-family:var(--font-sans);font-size:14px"><a href="/trends/${team.slug}" style="font-weight:600">${team.name}</a></td>
        <td style="text-align:right">${s.totalGames}</td>
        <td style="text-align:right;${s.home.overPct >= 55 ? 'color:#1f6b2e;font-weight:600' : ''}">${s.home.overs}-${s.home.unders} (${s.home.overPct}%)</td>
        <td style="text-align:right;${s.home.avgVsClose >= 0 ? 'color:#1f6b2e;font-weight:600' : 'color:#8f281f;font-weight:600'}">${s.home.avgVsClose >= 0 ? '+' : ''}${s.home.avgVsClose}</td>
        <td style="text-align:right;${s.home.coverPct >= 55 ? 'color:#1f6b2e;font-weight:600' : ''}">${s.home.covers}-${s.home.nonCovers} (${s.home.coverPct}%)</td>
        <td style="text-align:right;${s.away.overPct >= 55 ? 'color:#1f6b2e;font-weight:600' : ''}">${s.away.overs}-${s.away.unders} (${s.away.overPct}%)</td>
      </tr>`;
    }).filter(Boolean).join('\n');

  const today = dataDrivenDate || new Date().toISOString().slice(0, 10);

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>NBA Team Betting Profiles — 2025-26 Season | SportsSync</title>
<meta name="description" content="Over/under and ATS trends for all 30 NBA teams."/><link rel="canonical" href="https://sportsync-evidence.web.app/trends/"/>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700&display=swap" rel="stylesheet"/>
<style>:root{--font-sans:"DM Sans",sans-serif;--font-serif:"Source Serif 4",Georgia,serif;--font-mono:"SF Mono","Menlo",monospace}*{margin:0;padding:0;box-sizing:border-box}body{font-family:var(--font-sans);background:#fdfbf7;color:#1a1a1a;line-height:1.6;font-size:15px;-webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums}a{color:#2d5da1;text-decoration:none;font-weight:500}a:hover{text-decoration:underline}.p{max-width:960px;margin:0 auto;padding:56px 24px}h1{font-family:var(--font-serif);font-size:42px;font-weight:700;margin-bottom:12px}.s{font-size:18px;color:#454545;margin-bottom:48px;max-width:640px}.tc{overflow-x:auto;background:#fff;border:1px solid #ece6de;border-radius:14px;box-shadow:0 1px 3px rgba(0,0,0,.04)}table{width:100%;border-collapse:collapse;text-align:left;font-size:14px;white-space:nowrap}thead th{padding:14px 20px;font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#454545;border-bottom:1px solid #e2ddd5}tbody td{padding:14px 20px;border-bottom:1px solid #ece6de;font-family:var(--font-mono);font-size:13px;color:#454545}tbody tr:last-child td{border-bottom:none}tbody tr:hover{background:#faf9f6}.f{padding-top:40px;font-size:14px;color:#454545}</style></head>
<body><main class="p"><h1>NBA Betting Profiles</h1><p class="s">Over/under and ATS trends for all 30 NBA teams. Sorted by home over rate. Trends as of ${today}.</p>
<div class="tc"><table><thead><tr><th>Team</th><th style="text-align:right">GP</th><th style="text-align:right">Home O/U</th><th style="text-align:right">vs Close</th><th style="text-align:right">Home ATS</th><th style="text-align:right">Away O/U</th></tr></thead><tbody>${rows}</tbody></table></div>
<div class="f"><p>Auto-generated from data thru ${today}. <a href="https://ref-tendencies.web.app/">Ref Tendencies →</a></p></div></main></body></html>`;
}

// ── 6. Core Orchestration ────────────────────────────────────────────────────

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
  const allStats = [];

  for (const team of NBA_TEAMS) {
    const stats = computeTeamStats(team.name, completedGames, upcomingGames);
    if (!stats) {
      logger.warn(`⚠️  No games for ${team.name}`);
      continue;
    }
    allStats.push(stats);
    files[`trends/${team.slug}.html`] = renderTeamPage(team, stats, latestDataDate);
  }

  if (allStats.length > 0) {
    files['trends/index.html'] = renderIndexPage(allStats, latestDataDate);
    logger.info(`✅ Index (${allStats.length} teams)`);
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
