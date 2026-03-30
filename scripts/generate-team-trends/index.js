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
import { NBA_TEAMS } from '../../functions/lib/teams.js';
import { computeTeamStats } from '../../functions/lib/compute.js';
import {
  buildTeamTrendPayload,
  renderTeamTrendPage,
  buildTrendsIndexPayload,
  renderTrendsIndexPage,
} from '../../functions/lib/render.js';

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
    `&select=id,start_time,home_team,away_team,home_score,away_score,status,closing_odds,opening_odds,odds_total_safe,odds_home_spread_safe,odds_home_ml_safe,odds_away_ml_safe` +
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
  const latestDataDate = completedGames.length > 0
    ? new Date(completedGames[0].start_time).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

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

  const teamPayloads = [];
  let generated = 0;

  for (const team of teamsToGenerate) {
    const stats = computeTeamStats(team.name, completedGames, upcomingGames);
    if (!stats) {
      console.warn(`⚠️  No games found for ${team.name}, skipping`);
      continue;
    }

    const teamPayload = buildTeamTrendPayload(team, stats, {
      generatedDate: latestDataDate,
    });
    teamPayloads.push(teamPayload);

    if (dryRun) {
      console.log(`📊 ${team.name}: ${stats.totalGames} GP | Home O/U: ${stats.home.overs}-${stats.home.unders} (${stats.home.overPct}%) | Away O/U: ${stats.away.overs}-${stats.away.unders} (${stats.away.overPct}%) | Home ATS: ${stats.home.covers}-${stats.home.nonCovers} (${stats.home.coverPct}%)`);
    } else {
      const html = renderTeamTrendPage(teamPayload);
      const outPath = join(OUTPUT_DIR, `${team.slug}.html`);
      writeFileSync(outPath, html, 'utf-8');
      writeFileSync(join(OUTPUT_DIR, `${team.slug}.json`), JSON.stringify(teamPayload, null, 2), 'utf-8');
      generated++;
      console.log(`✅ ${team.name} → ${team.slug}.html (${stats.totalGames} games)`);
    }
  }

  // Generate index page
  if (!dryRun && !singleSlug && teamPayloads.length > 0) {
    const indexPayload = buildTrendsIndexPayload(teamPayloads, {
      generatedDate: latestDataDate,
    });
    const indexHtml = renderTrendsIndexPage(indexPayload);
    writeFileSync(join(OUTPUT_DIR, 'index.html'), indexHtml, 'utf-8');
    writeFileSync(join(OUTPUT_DIR, 'index.json'), JSON.stringify(indexPayload, null, 2), 'utf-8');
    console.log(`✅ Index page → index.html (${teamPayloads.length} teams)`);
    generated++;
  }

  console.log(`\n🏁 Done. ${dryRun ? 'Dry run — no files written.' : `${generated} files written to ${OUTPUT_DIR}`}`);
}

main().catch(err => {
  console.error('❌ Fatal error:', err.message);
  process.exit(1);
});
