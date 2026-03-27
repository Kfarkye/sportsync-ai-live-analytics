/**
 * Cloud Function: regenerateTeamTrends
 * ─────────────────────────────────────
 * Triggered by Cloud Scheduler (daily 6 AM ET).
 * 1. Fetches all NBA game data from Supabase
 * 2. Computes stats for all 30 teams
 * 3. Generates HTML files
 * 4. Deploys to Firebase Hosting via REST API
 *
 * Environment:
 *   SUPABASE_URL, SUPABASE_ANON_KEY — set in Cloud Function config
 *   FIREBASE_SITE_ID — Firebase Hosting site ID (default: project ID)
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onRequest } from 'firebase-functions/v2/https';
import { initializeApp } from 'firebase-admin/app';
import { GoogleAuth } from 'google-auth-library';
import { createHash } from 'node:crypto';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';

// Compute + render modules (copied from scripts/generate-team-trends/ into functions/lib/)
import { NBA_TEAMS } from './lib/teams.js';
import { computeTeamStats } from './lib/compute.js';
import { renderTeamPage } from './lib/render.js';

const gzipAsync = promisify(gzip);
initializeApp();

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qffzvrnbzabcokqqrwbv.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_API_KEY || '';

// ── Refresh Materialized Views (pre-step) ────────────────────────────────────

async function refreshMasterViews() {
  console.log('⏳ Refreshing NBA master materialized views...');
  const rpcUrl = `${SUPABASE_URL}/rest/v1/rpc/refresh_nba_master_views`;
  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    if (!res.ok) {
      const errText = await res.text();
      console.warn(`⚠️  Master view refresh failed (${res.status}): ${errText}`);
      return false;
    }
    console.log('✅ Master views refreshed');
    return true;
  } catch (err) {
    console.warn('⚠️  Master view refresh error (non-fatal):', err.message);
    return false;
  }
}

// ── Data Fetching (raw matches — compute pipeline expects this column shape) ─

async function fetchGames(status) {
  const filter = status === 'completed' ? 'status=eq.STATUS_FINAL' : 'status=neq.STATUS_FINAL';
  const baseUrl = `${SUPABASE_URL}/rest/v1/matches?league_id=eq.nba&${filter}` +
    `&select=id,start_time,home_team,away_team,home_score,away_score,status,closing_odds,opening_odds` +
    `&order=start_time.desc`;

  const PAGE_SIZE = 1000;
  let allRows = [];
  let offset = 0;

  while (true) {
    const res = await fetch(`${baseUrl}&limit=${PAGE_SIZE}&offset=${offset}`, {
      headers: { 'apikey': SUPABASE_KEY, 'Accept': 'application/json' },
    });
    if (!res.ok) throw new Error(`Supabase ${status} fetch failed: ${res.status}`);
    const rows = await res.json();
    allRows = allRows.concat(rows);
    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return allRows;
}

// ── Index Page (simplified for Cloud Function) ──────────────────────────────

function renderIndexPage(teamSummaries) {
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

  const today = new Date().toISOString().slice(0, 10);
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>NBA Team Betting Profiles — 2025-26 Season</title>
<meta name="description" content="Over/under and ATS trends for all 30 NBA teams."/><link rel="canonical" href="https://sportsync-evidence.web.app/trends/"/>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700&display=swap" rel="stylesheet"/>
<style>:root{--font-sans:"DM Sans",sans-serif;--font-serif:"Source Serif 4",Georgia,serif;--font-mono:"SF Mono","Menlo",monospace}*{margin:0;padding:0;box-sizing:border-box}body{font-family:var(--font-sans);background:#fdfbf7;color:#1a1a1a;line-height:1.6;font-size:15px;-webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums}a{color:#2d5da1;text-decoration:none;font-weight:500}a:hover{text-decoration:underline}.p{max-width:960px;margin:0 auto;padding:56px 24px}h1{font-family:var(--font-serif);font-size:42px;font-weight:700;margin-bottom:12px}.s{font-size:18px;color:#454545;margin-bottom:48px;max-width:640px}.tc{overflow-x:auto;background:#fff;border:1px solid #ece6de;border-radius:14px;box-shadow:0 1px 3px rgba(0,0,0,.04)}table{width:100%;border-collapse:collapse;text-align:left;font-size:14px;white-space:nowrap}thead th{padding:14px 20px;font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#454545;border-bottom:1px solid #e2ddd5}tbody td{padding:14px 20px;border-bottom:1px solid #ece6de;font-family:var(--font-mono);font-size:13px;color:#454545}tbody tr:last-child td{border-bottom:none}tbody tr:hover{background:#faf9f6}.f{padding-top:40px;font-size:14px;color:#454545}</style></head>
<body><main class="p"><h1>NBA Betting Profiles</h1><p class="s">Over/under and ATS trends for all 30 NBA teams. Sorted by home over rate. Updated ${today}.</p>
<div class="tc"><table><thead><tr><th>Team</th><th style="text-align:right">GP</th><th style="text-align:right">Home O/U</th><th style="text-align:right">vs Close</th><th style="text-align:right">Home ATS</th><th style="text-align:right">Away O/U</th></tr></thead><tbody>${rows}</tbody></table></div>
<div class="f"><p>Auto-generated ${today}. <a href="https://ref-tendencies.web.app/">Ref Tendencies →</a></p></div></main></body></html>`;
}

// ── Firebase Hosting REST API Deploy ─────────────────────────────────────────

async function deployToHosting(files, projectId) {
  const siteId = process.env.FIREBASE_SITE_ID || projectId;
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/firebase.hosting'] });
  const client = await auth.getClient();
  const API_BASE = 'https://firebasehosting.googleapis.com/v1beta1';
  const baseUrl = `${API_BASE}/sites/${siteId}`;

  // 1. Create a new version
  console.log('Creating new Hosting version...');
  const versionRes = await client.request({ url: `${baseUrl}/versions`, method: 'POST', data: { config: { cleanUrls: true, headers: [{ glob: '**', headers: { 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff' } }] } } });
  const versionName = versionRes.data.name; // resource path: sites/{site}/versions/{id}
  const versionUrl = `${API_BASE}/${versionName}`; // full URL for subsequent requests
  console.log(`Version created: ${versionName}`);

  // 2. Hash and populate files
  const fileHashes = {};
  const hashToContent = {};

  for (const [path, content] of Object.entries(files)) {
    const gzipped = await gzipAsync(Buffer.from(content, 'utf-8'));
    const hash = createHash('sha256').update(gzipped).digest('hex');
    fileHashes[`/${path}`] = hash;
    hashToContent[hash] = gzipped;
  }

  console.log(`Populating ${Object.keys(fileHashes).length} files...`);
  const populateRes = await client.request({
    url: `${versionUrl}:populateFiles`,
    method: 'POST',
    data: { files: fileHashes },
  });

  // 3. Upload files that need uploading
  const uploadUrl = populateRes.data.uploadUrl;
  const requiredHashes = populateRes.data.uploadRequiredHashes || [];
  console.log(`Uploading ${requiredHashes.length} new files...`);

  for (const hash of requiredHashes) {
    await client.request({
      url: `${uploadUrl}/${hash}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: hashToContent[hash],
    });
  }

  // 4. Finalize version
  console.log('Finalizing version...');
  await client.request({
    url: versionUrl,
    method: 'PATCH',
    params: { updateMask: 'status' },
    data: { status: 'FINALIZED' },
  });

  // 5. Release
  console.log('Releasing...');
  await client.request({
    url: `${baseUrl}/releases`,
    method: 'POST',
    params: { versionName },
  });

  console.log('✅ Deployed to Firebase Hosting');
}

// ── Core regeneration logic ──────────────────────────────────────────────────

async function regenerate() {
  // Pre-step: refresh materialized views so data is current
  await refreshMasterViews();

  console.log('⏳ Fetching completed games...');
  const completedGames = await fetchGames('completed');
  console.log(`   → ${completedGames.length} completed games`);

  console.log('⏳ Fetching upcoming games...');
  const upcomingGames = await fetchGames('upcoming');
  console.log(`   → ${upcomingGames.length} upcoming games`);

  const files = {};
  const allStats = [];

  for (const team of NBA_TEAMS) {
    const stats = computeTeamStats(team.name, completedGames, upcomingGames);
    if (!stats) { console.warn(`⚠️  No games for ${team.name}`); continue; }
    allStats.push(stats);
    files[`trends/${team.slug}.html`] = renderTeamPage(team, stats);
    console.log(`✅ ${team.name} (${stats.totalGames} GP)`);
  }

  if (allStats.length > 0) {
    files['trends/index.html'] = renderIndexPage(allStats);
    console.log(`✅ Index (${allStats.length} teams)`);
  }

  return files;
}

// ── Scheduled Function (daily 6 AM ET = 10:00 UTC) ──────────────────────────

export const regenerateTeamTrends = onSchedule(
  {
    schedule: '0 10 * * *',
    timeZone: 'America/New_York',
    region: 'us-central1',
    timeoutSeconds: 300,
    memory: '512MiB',
    secrets: ['SUPABASE_SERVICE_KEY'],
  },
  async (event) => {
    console.log('🏀 Scheduled: regenerating team trends...');
    const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
    const files = await regenerate();
    await deployToHosting(files, projectId);
    console.log('🏁 Done');
  }
);

// ── Manual HTTP trigger (for testing) ────────────────────────────────────────

export const regenerateTeamTrendsHttp = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 300,
    memory: '512MiB',
    secrets: ['SUPABASE_SERVICE_KEY'],
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('POST only');
      return;
    }
    console.log('🏀 Manual: regenerating team trends...');
    const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
    const files = await regenerate();
    await deployToHosting(files, projectId);
    res.json({ status: 'ok', files: Object.keys(files).length });
  }
);
