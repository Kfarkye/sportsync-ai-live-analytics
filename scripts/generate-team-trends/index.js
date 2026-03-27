#!/usr/bin/env node
/**
 * Team Trends Generator
 * ─────────────────────
 * Fetches all NBA game data from Supabase, computes betting profile stats
 * for every team, and writes static HTML pages to public/trends/.
 *
 * Usage:
 *   node index.js                    # Generate all 30 teams
 *   node index.js --team utah-jazz   # Generate one team
 *   node index.js --dry-run          # Compute stats, print summary, no file writes
 *
 * Environment:
 *   SUPABASE_URL       (default: hardcoded project URL)
 *   SUPABASE_ANON_KEY  (default: hardcoded anon key)
 *   OUTPUT_DIR          (default: ../../public/trends)
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NBA_TEAMS, teamBySlug } from './teams.js';
import { computeTeamStats } from './compute.js';
import { renderTeamPage } from './render.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ───────────────────────────────────────────────────────────────────

const SUPABASE_URL  = process.env.SUPABASE_URL  || 'https://qffzvrnbzabcokqqrwbv.supabase.co';
const SUPABASE_KEY  = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUzNTc2NjgsImV4cCI6MjA3MDkzMzY2OH0.PCSnC5E7sG7FvasHy_9DdwiN61xW0GzFROLzZ0bTVnc';
const OUTPUT_DIR    = process.env.OUTPUT_DIR     || resolve(__dirname, '../../public/trends');

// ── Data Fetching ────────────────────────────────────────────────────────────

async function fetchGames(status) {
  const filter = status === 'completed'
    ? 'status=eq.STATUS_FINAL'
    : 'status=neq.STATUS_FINAL';

  const baseUrl = `${SUPABASE_URL}/rest/v1/matches?league_id=eq.nba&${filter}` +
    `&select=id,start_time,home_team,away_team,home_score,away_score,status,closing_odds,opening_odds` +
    `&order=start_time.desc`;

  const PAGE_SIZE = 1000;
  let allRows = [];
  let offset = 0;

  while (true) {
    const res = await fetch(`${baseUrl}&limit=${PAGE_SIZE}&offset=${offset}`, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Accept': 'application/json',
      },
    });
    if (!res.ok) throw new Error(`Supabase ${status} fetch failed: ${res.status} ${res.statusText}`);
    const rows = await res.json();
    allRows = allRows.concat(rows);
    if (rows.length < PAGE_SIZE) break; // Last page
    offset += PAGE_SIZE;
  }

  return allRows;
}

// ── Index Page Generator ─────────────────────────────────────────────────────

function renderIndexPage(teamSummaries) {
  const rows = teamSummaries
    .sort((a, b) => b.home.overPct - a.home.overPct)
    .map(s => {
      const team = NBA_TEAMS.find(t => t.name === s.teamName);
      if (!team) return '';
      const homeOvUn = `${s.home.overs}-${s.home.unders}`;
      const awayOvUn = `${s.away.overs}-${s.away.unders}`;
      return `            <tr>
              <td class="text-cell"><a href="/trends/${team.slug}" class="fw-600">${team.name}</a></td>
              <td class="align-right">${s.totalGames}</td>
              <td class="align-right ${s.home.overPct >= 55 ? 'color-green' : ''}">${homeOvUn} (${s.home.overPct}%)</td>
              <td class="align-right ${s.home.avgVsClose >= 0 ? 'color-green' : 'color-red'}">${s.home.avgVsClose >= 0 ? '+' : ''}${s.home.avgVsClose}</td>
              <td class="align-right ${s.home.coverPct >= 55 ? 'color-green' : ''}">${s.home.covers}-${s.home.nonCovers} (${s.home.coverPct}%)</td>
              <td class="align-right ${s.away.overPct >= 55 ? 'color-green' : ''}">${awayOvUn} (${s.away.overPct}%)</td>
            </tr>`;
    })
    .filter(Boolean)
    .join('\n');

  const today = new Date().toISOString().slice(0, 10);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>NBA Team Betting Profiles — 2025-26 Season | SportsSync</title>
  <meta name="description" content="Over/under and ATS trends for all 30 NBA teams. Home vs away splits, rest patterns, and strongest plays for the 2025-26 season." />
  <meta name="robots" content="index, follow" />
  <link rel="canonical" href="https://sportsync-evidence.web.app/trends/" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;0,8..60,700&display=swap" rel="stylesheet" />
  <style>
    :root{--bg-canvas:#fdfbf7;--bg-surface:#fff;--bg-surface-hover:#faf9f6;--bg-subtle:#f5f2ed;--text-primary:#1a1a1a;--text-secondary:#454545;--text-tertiary:#666;--border-subtle:#ece6de;--border-strong:#e2ddd5;--color-accent:#2d5da1;--color-success:#1f6b2e;--color-danger:#8f281f;--radius-lg:14px;--shadow-sm:0 1px 3px rgba(0,0,0,.04),0 1px 2px rgba(0,0,0,.02);--font-sans:"DM Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;--font-serif:"Source Serif 4",Georgia,serif;--font-mono:"SF Mono","Menlo",monospace}
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:var(--font-sans);background:var(--bg-canvas);color:var(--text-primary);line-height:1.6;font-size:15px;-webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums}
    a{color:var(--color-accent);text-decoration:none;font-weight:500}a:hover{text-decoration:underline}
    .page{max-width:960px;margin:0 auto;padding:56px 24px}
    .page-title{font-family:var(--font-serif);font-size:42px;font-weight:700;letter-spacing:-.01em;line-height:1.1;margin-bottom:12px}
    .page-subtitle{font-size:18px;color:var(--text-secondary);margin-bottom:48px;max-width:640px}
    .table-container{overflow-x:auto;background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:var(--radius-lg);box-shadow:var(--shadow-sm)}
    table{width:100%;border-collapse:collapse;text-align:left;font-size:14px;white-space:nowrap}
    thead th{padding:14px 20px;font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--text-secondary);border-bottom:1px solid var(--border-strong)}
    tbody td{padding:14px 20px;border-bottom:1px solid var(--border-subtle);font-family:var(--font-mono);font-size:13px;color:var(--text-secondary);vertical-align:middle}
    tbody tr:last-child td{border-bottom:none}tbody tr:hover{background:var(--bg-surface-hover)}
    .text-cell{font-family:var(--font-sans);font-size:14px}.fw-600{font-weight:600;color:var(--text-primary)}
    .align-right{text-align:right}.color-green{color:var(--color-success)!important;font-weight:600}.color-red{color:var(--color-danger)!important;font-weight:600}
    .page-footer{padding-top:40px;font-size:14px;color:var(--text-secondary)}
    @media(max-width:768px){.page-title{font-size:32px}}
  </style>
</head>
<body>
  <main class="page">
    <h1 class="page-title">NBA Betting Profiles</h1>
    <p class="page-subtitle">Over/under and ATS trends for all 30 NBA teams. Sorted by home over rate. Updated ${today}.</p>
    <div class="table-container" tabindex="0">
      <table>
        <thead>
          <tr>
            <th class="align-left">Team</th>
            <th class="align-right">GP</th>
            <th class="align-right">Home O/U</th>
            <th class="align-right">vs Close</th>
            <th class="align-right">Home ATS</th>
            <th class="align-right">Away O/U</th>
          </tr>
        </thead>
        <tbody>
${rows}
        </tbody>
      </table>
    </div>
    <div class="page-footer">
      <p>Auto-generated ${today}. For live intelligence, visit <a href="https://ref-tendencies.web.app/">Ref Tendencies</a>.</p>
    </div>
  </main>
</body>
</html>`;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun    = args.includes('--dry-run');
  const teamFlag  = args.indexOf('--team');
  const singleSlug = teamFlag >= 0 ? args[teamFlag + 1] : null;

  console.log('⏳ Fetching completed games from Supabase...');
  const completedGames = await fetchGames('completed');
  console.log(`   → ${completedGames.length} completed games`);

  console.log('⏳ Fetching upcoming games...');
  const upcomingGames = await fetchGames('upcoming');
  console.log(`   → ${upcomingGames.length} upcoming games`);

  const teamsToGenerate = singleSlug
    ? NBA_TEAMS.filter(t => t.slug === singleSlug)
    : NBA_TEAMS;

  if (teamsToGenerate.length === 0) {
    console.error(`❌ No team found for slug: ${singleSlug}`);
    process.exit(1);
  }

  if (!dryRun && !existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const allStats = [];
  let generated = 0;

  for (const team of teamsToGenerate) {
    const stats = computeTeamStats(team.name, completedGames, upcomingGames);
    if (!stats) {
      console.warn(`⚠️  No games found for ${team.name}, skipping`);
      continue;
    }

    allStats.push(stats);

    if (dryRun) {
      console.log(`📊 ${team.name}: ${stats.totalGames} GP | Home O/U: ${stats.home.overs}-${stats.home.unders} (${stats.home.overPct}%) | Away O/U: ${stats.away.overs}-${stats.away.unders} (${stats.away.overPct}%) | Home ATS: ${stats.home.covers}-${stats.home.nonCovers} (${stats.home.coverPct}%)`);
    } else {
      const html = renderTeamPage(team, stats);
      const outPath = join(OUTPUT_DIR, `${team.slug}.html`);
      writeFileSync(outPath, html, 'utf-8');
      generated++;
      console.log(`✅ ${team.name} → ${team.slug}.html (${stats.totalGames} games)`);
    }
  }

  // Generate index page
  if (!dryRun && !singleSlug && allStats.length > 0) {
    const indexHtml = renderIndexPage(allStats);
    writeFileSync(join(OUTPUT_DIR, 'index.html'), indexHtml, 'utf-8');
    console.log(`✅ Index page → index.html (${allStats.length} teams)`);
    generated++;
  }

  console.log(`\n🏁 Done. ${dryRun ? 'Dry run — no files written.' : `${generated} files written to ${OUTPUT_DIR}`}`);
}

main().catch(err => {
  console.error('❌ Fatal error:', err.message);
  process.exit(1);
});
