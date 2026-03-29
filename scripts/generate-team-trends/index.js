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
  const pctClass = (pct) => {
    if (pct >= 55) return 'hot';
    if (pct <= 45) return 'cold';
    return '';
  };

  const rows = teamSummaries
    .sort((a, b) => b.home.overPct - a.home.overPct)
    .map(s => {
      const team = NBA_TEAMS.find(t => t.name === s.teamName);
      if (!team) return '';
      const homeOvUn = `${s.home.overs}-${s.home.unders}`;
      const awayOvUn = `${s.away.overs}-${s.away.unders}`;
      const homeOverClass = pctClass(s.home.overPct);
      const homeAtsClass = pctClass(s.home.coverPct);
      const awayOverClass = pctClass(s.away.overPct);
      return `            <tr>
              <td class="team-cell"><a href="/trends/${team.slug}">${team.name}</a></td>
              <td class="gp-cell">${s.totalGames}</td>
              <td class="record-cell ${homeOverClass}">${homeOvUn} <span class="record-pct">(${s.home.overPct}%)</span></td>
              <td class="vs-cell ${s.home.avgVsClose >= 0 ? 'pos' : 'neg'}">${s.home.avgVsClose >= 0 ? '+' : ''}${s.home.avgVsClose}</td>
              <td class="record-cell ${homeAtsClass}">${s.home.covers}-${s.home.nonCovers} <span class="record-pct">(${s.home.coverPct}%)</span></td>
              <td class="record-cell ${awayOverClass}">${awayOvUn} <span class="record-pct">(${s.away.overPct}%)</span></td>
            </tr>`;
    })
    .filter(Boolean)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NBA Betting Profiles | SportsSync</title>
  <meta name="description" content="Over/under and ATS trends for all 30 NBA teams. Sorted by home over rate." />
  <link rel="canonical" href="https://sportsync-evidence.web.app/trends/" />
  <link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700&family=DM+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #FAFAF8;
      --surface: #FFFFFF;
      --text-primary: #1A1A18;
      --text-secondary: #6B6B63;
      --text-tertiary: #9B9B91;
      --accent: #C85A3A;
      --border: #E8E7E3;
      --green: #2D8F5C;
      --mono: 'JetBrains Mono', monospace;
      --serif: 'Source Serif 4', serif;
      --sans: 'DM Sans', sans-serif;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: var(--sans);
      background: var(--bg);
      color: var(--text-primary);
      -webkit-font-smoothing: antialiased;
      line-height: 1.6;
      font-variant-numeric: tabular-nums;
    }
    nav {
      max-width: 1080px;
      margin: 0 auto;
      padding: 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .nav-brand {
      font-family: var(--mono);
      font-weight: 500;
      font-size: 15px;
      color: var(--text-primary);
      letter-spacing: -0.02em;
      text-decoration: none;
    }
    .nav-links {
      display: flex;
      gap: 32px;
      list-style: none;
    }
    .nav-links a {
      font-size: 14px;
      color: var(--text-secondary);
      text-decoration: none;
      font-weight: 500;
    }
    .nav-links a:hover { color: var(--text-primary); }
    .nav-links a.active { color: var(--text-primary); font-weight: 600; }
    .hero {
      max-width: 1080px;
      margin: 0 auto;
      padding: 48px 24px 32px;
    }
    .hero h1 {
      font-family: var(--serif);
      font-size: clamp(28px, 4vw, 40px);
      font-weight: 700;
      line-height: 1.1;
      letter-spacing: -0.025em;
      margin-bottom: 12px;
    }
    .hero-sub {
      font-size: 15px;
      color: var(--text-secondary);
      max-width: 520px;
      line-height: 1.6;
    }
    .table-section {
      max-width: 1080px;
      margin: 0 auto;
      padding: 0 24px 80px;
    }
    .table-wrap {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    thead th {
      font-family: var(--mono);
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--text-tertiary);
      text-align: left;
      padding: 14px 16px;
      border-bottom: 1px solid var(--border);
      background: var(--bg);
      position: sticky;
      top: 0;
      z-index: 1;
    }
    thead th:not(:first-child) { text-align: center; }
    tbody tr { transition: background 0.1s; }
    tbody tr:hover { background: #FDFCFA; }
    tbody td {
      padding: 12px 16px;
      font-size: 14px;
      border-bottom: 1px solid rgba(232,231,227,0.5);
      vertical-align: middle;
    }
    tbody td:not(:first-child) { text-align: center; }
    tbody tr:last-child td { border-bottom: none; }
    .team-cell { font-weight: 600; color: var(--text-primary); }
    .team-cell a { color: inherit; text-decoration: none; }
    .team-cell a:hover { text-decoration: underline; }
    .gp-cell {
      font-family: var(--mono);
      font-size: 13px;
      color: var(--text-tertiary);
    }
    .record-cell {
      font-family: var(--mono);
      font-size: 13px;
      font-weight: 500;
      color: var(--text-secondary);
    }
    .record-cell.hot {
      color: var(--green);
      font-weight: 600;
    }
    .record-cell.cold { color: var(--text-tertiary); }
    .record-pct {
      font-size: 11px;
      color: var(--text-tertiary);
      margin-left: 2px;
    }
    .record-cell.hot .record-pct { color: var(--green); }
    .vs-cell {
      font-family: var(--mono);
      font-size: 13px;
      font-weight: 600;
    }
    .vs-cell.pos { color: var(--green); }
    .vs-cell.neg { color: var(--accent); }
    footer {
      max-width: 1080px;
      margin: 0 auto;
      padding: 24px;
      border-top: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    footer span {
      font-size: 13px;
      color: var(--text-tertiary);
    }
    footer a {
      font-size: 13px;
      color: var(--text-secondary);
      text-decoration: none;
    }
    .footer-links { display: flex; gap: 24px; }
    @media (max-width: 768px) {
      .nav-links { display: none; }
      .hero { padding: 32px 20px 24px; }
      .table-section { padding: 0 12px 48px; }
      .table-wrap { overflow-x: auto; }
      table { min-width: 700px; }
      thead th, tbody td { padding: 10px 12px; }
    }
  </style>
</head>
<body>
<nav>
  <a class="nav-brand" href="/">SportsSync</a>
  <ul class="nav-links">
    <li><a href="/props">Props</a></li>
    <li><a href="/trends/" class="active">Trends</a></li>
    <li><a href="/pregame">Matchups</a></li>
    <li><a href="https://ref-tendencies.web.app/">Referees</a></li>
  </ul>
</nav>

<section class="hero">
  <h1>NBA Betting Profiles</h1>
  <p class="hero-sub">Over/under and ATS trends for all 30 NBA teams. Sorted by home over rate.</p>
</section>

<section class="table-section">
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Team</th>
          <th>GP</th>
          <th>Home O/U</th>
          <th>vs Close</th>
          <th>Home ATS</th>
          <th>Away O/U</th>
        </tr>
      </thead>
      <tbody>
${rows}
      </tbody>
    </table>
  </div>
</section>

<footer>
  <span>&copy; 2026 SportsSync</span>
  <div class="footer-links">
    <a href="/props">Props</a>
    <a href="/pregame">Matchups</a>
    <a href="mailto:api@sportsync.io">Contact</a>
  </div>
</footer>
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
