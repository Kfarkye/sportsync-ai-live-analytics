#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// generate-props.mjs — Static Prop Profile Generator
//
// Fetches the live evidence pack from Cloud Run, then writes one static HTML
// file per player to public/props/{slug}.html so each detail route is a
// durable first-load player object page.
//
// Usage:
//   node scripts/generate-props.mjs              # full build (all players)
//   node scripts/generate-props.mjs --limit 20   # staged rollout (top N)
// ══════════════════════════════════════════════════════════════════════════════

const PACK_URL = 'https://refreshpropevidencepack-7r57xex2ea-uc.a.run.app';
const TEAM_ALIAS_URL = 'https://qffzvrnbzabcokqqrwbv.supabase.co/rest/v1/player_prop_identity_aliases?select=canonical_player_name,team_name,sample_count&league_id=eq.nba&team_name=not.is.null&order=sample_count.desc&limit=2000';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUzNTc2NjgsImV4cCI6MjA3MDkzMzY2OH0.PCSnC5E7sG7FvasHy_9DdwiN61xW0GzFROLzZ0bTVnc';
const BASE_URL = 'https://sportsync-evidence.web.app';
const OUTPUT_DIR = new URL('../public/props', import.meta.url).pathname;

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// ── Config ──────────────────────────────────────────────────────────────────
const MARKET_LABEL = {
  threes_made: 'Threes Made', rebounds: 'Rebounds',
  assists: 'Assists', points: 'Points', pra: 'Pts+Reb+Ast'
};

// ── Pure helpers (ported from props.html) ────────────────────────────────────
function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
function rateClass(rate) {
  const r = Number(rate);
  if (r >= 60) return 'over';
  if (r <= 40) return 'under';
  return 'neutral';
}
function rateLabel(rate) {
  const r = Number(rate);
  if (r >= 60) return 'rate-high';
  if (r <= 40) return 'rate-low';
  return '';
}
function dirClass(dir) {
  if (dir === 'over') return 'dir-over';
  if (dir === 'under') return 'dir-under';
  return 'dir-none';
}
function dirLabel(dir) {
  if (dir === 'over') return 'OVER LEAN';
  if (dir === 'under') return 'UNDER LEAN';
  return 'MIXED';
}
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function pickTeamName(card) {
  if (!card || typeof card !== 'object') return '';
  const candidates = [card.team_name, card.team, card.team_abbr];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return '';
}

function normNameKey(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function buildTeamLookup(rows) {
  const lookup = new Map();
  for (const row of rows || []) {
    const key = normNameKey(row?.canonical_player_name);
    const teamName = String(row?.team_name || '').trim();
    if (!key || !teamName) continue;
    const sampleCount = Number(row?.sample_count || 0);
    const existing = lookup.get(key);
    if (!existing || sampleCount > existing.sampleCount || (sampleCount === existing.sampleCount && teamName.length > existing.teamName.length)) {
      lookup.set(key, { teamName, sampleCount });
    }
  }
  return lookup;
}

async function enrichCardTeamsFromAliasMap(cards) {
  if (!Array.isArray(cards) || cards.length === 0) return;
  const missingTeam = cards.some(card => !pickTeamName(card));
  if (!missingTeam) return;

  try {
    const response = await fetch(TEAM_ALIAS_URL, {
      headers: {
        'apikey': SUPABASE_ANON,
        'Authorization': `Bearer ${SUPABASE_ANON}`,
      },
    });
    if (!response.ok) throw new Error(`team-alias ${response.status}`);
    const rows = await response.json();
    const teamLookup = buildTeamLookup(rows);
    for (const card of cards) {
      if (pickTeamName(card)) continue;
      const fallbackTeam = teamLookup.get(normNameKey(card?.player_name))?.teamName;
      if (fallbackTeam) {
        card.team_name = fallbackTeam;
      }
    }
  } catch (err) {
    console.warn('[generate-props] Team alias fallback unavailable:', err.message);
  }
}

// ── Data processing (ported from props.html buildPlayerIndex) ────────────────
function buildPlayerIndex(cards) {
  const map = {};
  for (const c of cards) {
    const slug = slugify(c.player_name);
    const teamName = pickTeamName(c);
    if (!map[slug]) {
      map[slug] = { name: c.player_name, team: teamName, slug, cards: [], heroCount: 0, maxTier: 'display' };
    }
    if (teamName && (!map[slug].team || teamName.length > map[slug].team.length)) {
      map[slug].team = teamName;
    }
    map[slug].cards.push(c);
    if (c.baseline.is_hero) map[slug].heroCount++;
    if (c.baseline.tier === 'feature') map[slug].maxTier = 'feature';
    else if (c.baseline.tier === 'edge' && map[slug].maxTier !== 'feature') map[slug].maxTier = 'edge';
  }
  return map;
}

// ── Sort players by signal strength (same ranking as SPA directory) ──────────
function sortPlayers(players) {
  const tierRank = { feature: 3, edge: 2, display: 1 };
  return Object.values(players).sort((a, b) => {
    if (b.heroCount !== a.heroCount) return b.heroCount - a.heroCount;
    if (tierRank[b.maxTier] !== tierRank[a.maxTier]) return tierRank[b.maxTier] - tierRank[a.maxTier];
    return a.name.localeCompare(b.name);
  });
}

function getTopMarketBySample(cards) {
  if (!cards || cards.length === 0) return null;
  return [...cards].sort((a, b) => Number(b?.baseline?.gp || 0) - Number(a?.baseline?.gp || 0))[0];
}

// ── Build neutral-safe summary for a player ──────────────────────────────────
function buildPlayerSummary(player) {
  const hero = player.cards.find(c => c?.baseline?.is_hero && (c.direction === 'over' || c.direction === 'under'));
  if (hero) {
    const dir = hero.direction === 'over' ? 'Over' : 'Under';
    return `${MARKET_LABEL[hero.market] || hero.market} ${Number(hero.baseline.rate).toFixed(1)}% ${dir} (${hero.baseline.gp} GP)`;
  }
  const topBySample = getTopMarketBySample(player.cards);
  if (!topBySample) return 'No strong signal — no qualified cards';
  return `No strong signal — Top market by sample: ${MARKET_LABEL[topBySample.market] || topBySample.market} ${Number(topBySample.baseline.rate).toFixed(1)}% (${topBySample.baseline.gp} GP)`;
}

function parseRecord(record) {
  const parts = String(record || '')
    .split('-')
    .map(v => parseInt(v.trim(), 10))
    .map(v => (Number.isFinite(v) ? v : 0));
  const over = parts[0] || 0;
  const under = parts[1] || 0;
  const push = parts[2] || 0;
  return { over, under, push, total: over + under + push };
}

function signalFromRate(rate) {
  const r = Number(rate);
  if (!Number.isFinite(r)) {
    return { cls: 'flat', direction: 'none', text: 'No Lean' };
  }
  if (r >= 60) {
    return { cls: 'over', direction: 'over', text: `Over ${r.toFixed(1)}%` };
  }
  if (r <= 40) {
    return { cls: 'under', direction: 'under', text: `Under ${(100 - r).toFixed(1)}%` };
  }
  return { cls: 'flat', direction: 'none', text: `${r.toFixed(1)}%` };
}

function contextSignalClass(rate) {
  const r = Number(rate);
  if (!Number.isFinite(r)) return 'neutral';
  if (r >= 55) return 'over';
  if (r <= 45) return 'under';
  return 'neutral';
}

function humanizeContextLabel(label) {
  const raw = String(label || '').trim();
  if (!raw) return 'Context';
  const norm = raw.toUpperCase();
  if (norm === 'HOME') return 'At home';
  if (norm === 'AWAY') return 'On the road';
  if (norm === 'B2B') return 'Back-to-back';
  if (norm === 'REST_1' || norm === 'REST 1') return 'On one day rest';
  if (norm === 'REST_2' || norm === 'REST 2') return 'On two days rest';
  if (norm.startsWith('PACE_')) {
    return `Against ${norm.replace('PACE_', '').toLowerCase()}-pace teams`;
  }
  return raw
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase());
}

function getPrimaryCard(player) {
  return [...(player.cards || [])].sort((a, b) => {
    const ah = Boolean(a?.baseline?.is_hero) ? 1 : 0;
    const bh = Boolean(b?.baseline?.is_hero) ? 1 : 0;
    if (bh !== ah) return bh - ah;
    const aDev = Math.abs(Number(a?.baseline?.rate || 50) - 50);
    const bDev = Math.abs(Number(b?.baseline?.rate || 50) - 50);
    if (bDev !== aDev) return bDev - aDev;
    return Number(b?.baseline?.gp || 0) - Number(a?.baseline?.gp || 0);
  })[0] || null;
}

function buildLeadCopy(player) {
  const focus = getPrimaryCard(player);
  if (!focus) {
    return `${player.name} has no qualified markets yet.`;
  }

  const marketLabel = (MARKET_LABEL[focus.market] || focus.market).toLowerCase();
  const cl = focus.current_line;

  if (cl && Number(cl.gp) >= 3) {
    const lineValue = Number(cl.line);
    const lineText = Number.isFinite(lineValue) ? lineValue.toFixed(1) : '—';
    const record = parseRecord(cl.record);
    const rate = Number(cl.rate);
    if (rate <= 40) {
      if (record.over === 0 && record.total > 0) {
        return `DraftKings has posted ${player.name}'s ${marketLabel} at ${lineText} ${record.total} times this season. ${player.name} has gone under all ${record.total}.`;
      }
      return `DraftKings has posted ${player.name}'s ${marketLabel} at ${lineText} ${record.total} times this season. ${player.name} trends under at that number (${cl.record}).`;
    }
    if (rate >= 60) {
      if (record.under === 0 && record.total > 0) {
        return `DraftKings has posted ${player.name}'s ${marketLabel} at ${lineText} ${record.total} times this season. ${player.name} has gone over all ${record.total}.`;
      }
      return `DraftKings has posted ${player.name}'s ${marketLabel} at ${lineText} ${record.total} times this season. ${player.name} trends over at that number (${cl.record}).`;
    }
    return `DraftKings has posted ${player.name}'s ${marketLabel} at ${lineText} ${record.total} times this season. Results are mixed at that line (${cl.record}).`;
  }

  const b = focus.baseline || {};
  const rate = Number(b.rate);
  if (Number.isFinite(rate) && rate <= 40) {
    return `${player.name} has stayed under in ${(100 - rate).toFixed(1)}% of ${b.gp} ${marketLabel} games this season (${b.record}).`;
  }
  if (Number.isFinite(rate) && rate >= 60) {
    return `${player.name} has gone over in ${rate.toFixed(1)}% of ${b.gp} ${marketLabel} games this season (${b.record}).`;
  }
  return `${player.name}'s ${marketLabel} profile is mixed this season (${b.record}, ${b.gp} GP).`;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceMarkerBlock(html, startMarker, endMarker, content) {
  const pattern = new RegExp(`(${escapeRegExp(startMarker)})([\\s\\S]*?)(${escapeRegExp(endMarker)})`);
  if (!pattern.test(html)) {
    throw new Error(`Marker block missing: ${startMarker} ... ${endMarker}`);
  }
  return html.replace(pattern, `$1${content}$3`);
}

function formatGeneratedAt(value) {
  if (!value) return 'Unknown';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  });
}

function normalizePackContract(rawPack) {
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

function renderIndexCards(entries) {
  return entries.map((p, i) => {
    const byMarket = {};
    for (const c of p.cards) {
      if (!byMarket[c.market]) byMarket[c.market] = c;
    }

    const chipHtml = Object.values(byMarket).map(c => {
      const rc = rateClass(c.baseline.rate);
      const lineValue = Number(c?.current_line?.line ?? c?.line);
      const lineText = Number.isFinite(lineValue) ? lineValue.toFixed(1) : '—';
      return `
        <div class="pc-market-chip">
          <div class="pc-market-name">${esc(MARKET_LABEL[c.market] || c.market)}</div>
          <div class="pc-market-rate ${rc}">${Number(c.baseline.rate).toFixed(1)}%</div>
          <div class="pc-market-gp">${c.baseline.record} · ${c.baseline.gp} GP · O/U ${lineText}</div>
        </div>
      `;
    }).join('');

    return `
      <a class="player-card ${p.heroCount > 0 ? 'has-hero' : ''}" href="/props/${p.slug}" style="animation-delay: ${Math.min(i * 40, 600)}ms">
        <div class="pc-top">
          <div class="pc-head">
            <div class="pc-name">${esc(p.name)}</div>
            ${p.team ? `<div class="pc-team">${esc(p.team)}</div>` : ''}
          </div>
          <svg class="pc-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
        <div class="pc-markets">${chipHtml}</div>
        <div class="pc-meta">
          <span class="pc-meta-label">Markets</span>
          <span class="pc-card-count">${p.cards.length} card${p.cards.length > 1 ? 's' : ''}</span>
        </div>
      </a>
    `;
  }).join('');
}

function buildPropsShell(templateHtml, packForShell, entries) {
  const freshness = `Pack ${packForShell.version || 'unknown'} · Generated ${formatGeneratedAt(packForShell.generated_at)}`;
  const resultCount = `${entries.length} player${entries.length !== 1 ? 's' : ''}`;
  const gridHtml = renderIndexCards(entries);
  const preloadedPack = JSON.stringify(packForShell);

  let html = templateHtml;
  html = replaceMarkerBlock(html, '<!-- PRELOADED_INDEX_FRESHNESS_START -->', '<!-- PRELOADED_INDEX_FRESHNESS_END -->', freshness);
  html = replaceMarkerBlock(html, '<!-- PRELOADED_RESULT_COUNT_START -->', '<!-- PRELOADED_RESULT_COUNT_END -->', resultCount);
  html = replaceMarkerBlock(html, '<!-- PRELOADED_PLAYER_GRID_START -->', '<!-- PRELOADED_PLAYER_GRID_END -->', gridHtml);
  html = replaceMarkerBlock(html, '<!-- PRELOADED_PACK_JSON_START -->', '<!-- PRELOADED_PACK_JSON_END -->', preloadedPack);
  return html;
}

// ══════════════════════════════════════════════════════════════════════════════
// CSS — Profile-specific styles (inline, same pattern as trends/)
// ══════════════════════════════════════════════════════════════════════════════
const CSS = `
:root {
  --bg: #FAFAF8;
  --surface: #FFFFFF;
  --text-primary: #1A1A18;
  --text-secondary: #6B6B63;
  --text-tertiary: #9B9B91;
  --accent: #C85A3A;
  --accent-dim: rgba(200,90,58,0.08);
  --border: #E8E7E3;
  --green: #2D8F5C;
  --blue: #3A7BC8;
  --blue-dim: rgba(58,123,200,0.08);
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
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
.skip-link { position: absolute; left: -9999px; top: 0; background: #111; color: #fff; padding: 8px 12px; border-radius: 6px; z-index: 999; }
.skip-link:focus { left: 12px; top: 12px; }

nav {
  max-width: 920px;
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
.nav-links { display: flex; gap: 24px; list-style: none; }
.nav-links a { font-size: 14px; color: var(--text-secondary); text-decoration: none; font-weight: 500; }
.nav-links a:hover { color: var(--text-primary); text-decoration: none; }
.nav-links a.active { color: var(--text-primary); font-weight: 600; }

.page {
  max-width: 920px;
  margin: 0 auto;
  padding: 0 24px 80px;
}
.breadcrumb {
  font-size: 13px;
  color: var(--text-tertiary);
  margin-bottom: 32px;
}
.breadcrumb a { color: var(--text-tertiary); text-decoration: none; }
.breadcrumb a:hover { color: var(--accent); }

.player-name {
  font-family: var(--serif);
  font-size: clamp(32px, 4.5vw, 44px);
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.1;
  margin-bottom: 4px;
}
.player-team {
  font-size: 15px;
  color: var(--text-secondary);
  margin-bottom: 20px;
}

.the-lead {
  font-family: var(--serif);
  font-size: 20px;
  font-weight: 400;
  line-height: 1.45;
  color: var(--text-primary);
  max-width: 620px;
  margin-bottom: 36px;
}
.the-lead strong { font-weight: 600; }

.market-summary {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 1px;
  background: var(--border);
  border-radius: 8px;
  overflow: hidden;
  margin-bottom: 56px;
}
.ms-card {
  background: var(--surface);
  padding: 18px 16px;
}
.ms-market {
  font-family: var(--mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-tertiary);
  margin-bottom: 8px;
}
.ms-direction {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 6px;
}
.ms-direction.under { color: var(--blue); }
.ms-direction.over { color: var(--accent); }
.ms-direction.flat { color: var(--text-tertiary); }
.ms-record {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--text-tertiary);
}
.ms-tag {
  display: inline-block;
  font-family: var(--mono);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 2px 8px;
  border-radius: 4px;
  margin-top: 8px;
}
.ms-tag.edge { background: var(--blue-dim); color: var(--blue); }
.ms-tag.watch { background: rgba(0,0,0,0.04); color: var(--text-tertiary); }

.market-detail { margin-bottom: 44px; }
.md-title {
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-tertiary);
  padding-bottom: 14px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 20px;
}
.layer { margin-bottom: 20px; }
.layer-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 6px;
}
.layer-stats {
  font-family: var(--mono);
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.7;
}
.layer-stats .num {
  font-weight: 600;
  color: var(--text-primary);
}
.layer-stats .num.cold { color: var(--blue); }

.callout {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px 20px;
  margin-bottom: 20px;
}
.callout-text {
  font-size: 15px;
  font-weight: 500;
  color: var(--text-primary);
}
.callout-text .highlight {
  color: var(--blue);
  font-weight: 600;
}

.book-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 20px;
}
.book-chip {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 14px;
  min-width: 110px;
}
.book-chip-line {
  font-family: var(--mono);
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 2px;
}
.book-chip-meta {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-tertiary);
}
.book-chip.cold .book-chip-line { color: var(--blue); }

.context-grid { display: flex; flex-direction: column; gap: 0; }
.context-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid rgba(232,231,227,0.4);
}
.context-row:last-child { border-bottom: none; }
.context-label {
  font-size: 14px;
  color: var(--text-primary);
  font-weight: 500;
}
.context-value {
  font-family: var(--mono);
  font-size: 13px;
  font-weight: 600;
}
.context-value.over { color: var(--accent); }
.context-value.under { color: var(--blue); }
.context-value.neutral { color: var(--text-tertiary); }

.section-divider {
  border: none;
  border-top: 1px solid var(--border);
  margin: 48px 0;
}
.method {
  font-size: 13px;
  color: var(--text-tertiary);
  line-height: 1.7;
  max-width: 560px;
  margin-bottom: 24px;
}
.method a { color: var(--accent); text-decoration: none; font-weight: 500; }

.page-footer {
  padding-top: 24px;
  border-top: 1px solid var(--border);
  font-size: 13px;
  color: var(--text-tertiary);
  display: flex;
  justify-content: space-between;
  gap: 16px;
}
.page-footer a { color: var(--text-secondary); text-decoration: none; }
.page-footer a:hover { color: var(--text-primary); }

@media (max-width: 768px) {
  .nav-links { display: none; }
  .page { padding: 0 20px 48px; }
  .player-name { font-size: 28px; }
  .the-lead { font-size: 17px; }
  .market-summary { grid-template-columns: repeat(2, 1fr); }
}
`;

// ══════════════════════════════════════════════════════════════════════════════
// HTML Renderers (ported from props.html renderProfile)
// ══════════════════════════════════════════════════════════════════════════════

function renderMarketSummaryCards(player) {
  const byMarket = {};
  for (const c of player.cards) {
    if (!byMarket[c.market]) byMarket[c.market] = c;
  }

  return Object.values(byMarket)
    .sort((a, b) => Number(b?.baseline?.gp || 0) - Number(a?.baseline?.gp || 0))
    .map((c) => {
      const signal = signalFromRate(c.baseline.rate);
      let tag = '';
      if (c.baseline.is_hero) {
        tag = '<div class="ms-tag edge">Edge</div>';
      } else if (c.baseline.tier === 'feature' || c.baseline.tier === 'edge') {
        tag = '<div class="ms-tag watch">Watch</div>';
      }

      return `
      <div class="ms-card">
        <div class="ms-market">${esc(MARKET_LABEL[c.market] || c.market)}</div>
        <div class="ms-direction ${signal.cls}">${esc(signal.text)}</div>
        <div class="ms-record">${esc(c.baseline.record)} · ${c.baseline.gp} GP</div>
        ${tag}
      </div>`;
    })
    .join('');
}

function renderMarketSections(player) {
  const byMarket = {};
  for (const c of player.cards) {
    if (!byMarket[c.market]) byMarket[c.market] = [];
    byMarket[c.market].push(c);
  }

  const markets = Object.entries(byMarket)
    .map(([market, cards]) => ({ market, card: cards[0] }))
    .sort((a, b) => {
      const ah = a.card?.baseline?.is_hero ? 1 : 0;
      const bh = b.card?.baseline?.is_hero ? 1 : 0;
      if (bh !== ah) return bh - ah;
      return Number(b.card?.baseline?.gp || 0) - Number(a.card?.baseline?.gp || 0);
    });

  let html = '';
  for (const { market, card } of markets) {
    const b = card.baseline;
    const cl = card.current_line;
    const bc = card.book_context || [];
    const contexts = card.supporting_contexts || [];
    const baseSig = signalFromRate(b.rate);

    html += `
    <div class="market-detail">
      <div class="md-title">${esc(MARKET_LABEL[market] || market)}</div>

      <div class="layer">
        <div class="layer-label">All games</div>
        <div class="layer-stats">
          <span class="num ${baseSig.direction === 'under' ? 'cold' : ''}">${esc(b.record)}</span> over · avg <span class="num">${Number(b.avg).toFixed(1)}</span> · median <span class="num">${Number(b.median).toFixed(1)}</span> · ${b.gp} games
        </div>
      </div>`;

    if (cl) {
      const lineSig = signalFromRate(cl.rate);
      const record = parseRecord(cl.record);
      const lineValue = Number(cl.line);
      const lineText = Number.isFinite(lineValue) ? lineValue.toFixed(1) : '—';
      html += `
      <div class="layer">
        <div class="layer-label">At ${lineText}</div>
        <div class="layer-stats">
          <span class="num ${lineSig.direction === 'under' ? 'cold' : ''}">${esc(cl.record)}</span> over · avg <span class="num">${Number(cl.avg).toFixed(1)}</span> · ${cl.gp} games at this line
        </div>
      </div>`;

      if (Number(cl.gp) >= 3 && (lineSig.direction === 'under' || lineSig.direction === 'over')) {
        const phrase = lineSig.direction === 'under'
          ? `${record.under} under in ${record.total}`
          : `${record.over} over in ${record.total}`;
        const highlight = lineSig.direction === 'under'
          ? `${record.under} of ${record.total} under`
          : `${record.over} of ${record.total} over`;
        html += `
      <div class="callout">
        <div class="callout-text">Most common historical line ${lineText}: ${esc(phrase)}. <span class="highlight">${esc(highlight)}.</span></div>
      </div>`;
      }
    }

    if (bc.length > 0) {
      html += `
      <div class="layer">
        <div class="layer-label">Where the line has been set</div>
      </div>
      <div class="book-row">`;
      for (const bk of bc) {
        const sig = signalFromRate(bk.rate);
        html += `
        <div class="book-chip ${sig.direction === 'under' ? 'cold' : ''}">
          <div class="book-chip-line">O/U ${Number(bk.line).toFixed(1)}</div>
          <div class="book-chip-meta">${bk.gp} GP · ${Number(bk.rate).toFixed(1)}% over</div>
        </div>`;
      }
      html += '</div>';
    }

    html += `
      <div class="layer">
        <div class="layer-label">Does it hold?</div>
      </div>`;

    if (contexts.length > 0) {
      html += '<div class="context-grid">';
      for (const ctx of contexts) {
        const cClass = contextSignalClass(ctx.rate);
        html += `
        <div class="context-row">
          <span class="context-label">${esc(humanizeContextLabel(ctx.label))}</span>
          <span class="context-value ${cClass}">${Number(ctx.rate).toFixed(1)}% over · ${ctx.gp} GP</span>
        </div>`;
      }
      html += '</div>';
    } else {
      html += `
      <div class="layer-stats" style="color: var(--text-tertiary); font-family: var(--sans); font-size: 14px;">
        Small sample. No supporting context yet.
      </div>`;
    }

    html += '</div>';
  }

  return html;
}

// ══════════════════════════════════════════════════════════════════════════════
// Per-player JSON payload (requirement D — same source object as HTML/JSON-LD)
// ══════════════════════════════════════════════════════════════════════════════

function buildPayloadJson(player, generatedAt) {
  const headline = buildPlayerSummary(player);
  const byMarket = {};
  for (const c of player.cards) {
    if (!byMarket[c.market]) byMarket[c.market] = [];
    byMarket[c.market].push(c);
  }

  const marketCards = player.cards.slice(0, 5).map(c => ({
    market: c.market,
    market_label: MARKET_LABEL[c.market] || c.market,
    direction: c.direction,
    tier: c.baseline.tier,
    is_hero: c.baseline.is_hero,
    rate: Number(c.baseline.rate),
    record: c.baseline.record,
    gp: c.baseline.gp,
  }));

  const markets = {};
  for (const [market, cards] of Object.entries(byMarket)) {
    const card = cards[0];
    markets[market] = {
      baseline: {
        rate: Number(card.baseline.rate),
        record: card.baseline.record,
        avg: Number(card.baseline.avg),
        median: Number(card.baseline.median),
        gp: card.baseline.gp,
        direction: card.direction,
        tier: card.baseline.tier,
        is_hero: card.baseline.is_hero,
      },
      current_line: card.current_line ? {
        line: Number(card.current_line.line),
        rate: Number(card.current_line.rate),
        record: card.current_line.record,
        avg: Number(card.current_line.avg),
        gp: card.current_line.gp,
      } : null,
      book_pricing_history: (card.book_context || []).map(bk => ({
        book: bk.book,
        line: Number(bk.line),
        rate: Number(bk.rate),
        gp: bk.gp,
      })),
      supporting_context: (card.supporting_contexts || []).map(ctx => ({
        label: ctx.label,
        rate: Number(ctx.rate),
        record: ctx.record || null,
        gp: ctx.gp,
      })),
    };
  }

  return JSON.stringify({
    object_type: 'player_prop_profile',
    version: 'v2',
    slug: player.slug,
    url: `${BASE_URL}/props/${player.slug}`,
    league: 'NBA',
    season: '2025-26',
    player_name: player.name,
    team_name: player.team || null,
    summary: `${player.name} — ${headline}`,
    generated_at: generatedAt,
    hero_count: player.heroCount,
    market_cards: marketCards,
    markets,
    methodology: {
      baseline: 'All games for this player × market, across all books and lines.',
      current_line: 'Most common historical line (highest GP) across all sportsbooks.',
      book_context: 'Hit rate per sportsbook × line combination.',
      supporting_context: 'Venue, pace tier, rest days, season phase splits at the most common historical line.',
      over_rate: 'Overs / (overs + unders), pushes excluded.',
      display_floor: '10 GP minimum. Feature tier: 30+ GP. Hero: 65%+ or 35%- over rate.',
    },
  }, null, 2);
}

// ══════════════════════════════════════════════════════════════════════════════
// Full page template
// ══════════════════════════════════════════════════════════════════════════════

function playerPage(player, generatedAt) {
  const headline = buildPlayerSummary(player);
  const leadCopy = buildLeadCopy(player);
  const dateStr = generatedAt.split('T')[0];
  const cardCount = player.cards.length;
  const heroCount = player.heroCount;
  const subParts = [`${cardCount} market${cardCount > 1 ? 's' : ''} analyzed`];
  if (heroCount > 0) subParts.push(`${heroCount} strong signal${heroCount > 1 ? 's' : ''}`);

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: `${player.name} — Props | 2025-26 Season`,
    inLanguage: 'en',
    dateModified: dateStr,
    datePublished: dateStr,
    description: `${player.name} prop odds and historical trends for the 2025-26 NBA season. ${headline}.`,
    publisher: { '@type': 'Organization', name: 'SportsSync' },
    mainEntityOfPage: { '@type': 'WebPage', '@id': `${BASE_URL}/props/${player.slug}` },
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>${esc(player.name)} — Props | SportsSync</title>
  <meta name="description" content="${esc(player.name)} prop odds and historical trends. ${esc(headline)}." />
  <meta name="robots" content="index, follow" />
  <link rel="canonical" href="${BASE_URL}/props/${player.slug}" />

  <meta property="og:title" content="${esc(player.name)} — Props | SportsSync" />
  <meta property="og:description" content="${esc(player.name)} prop odds and historical trends. ${esc(headline)}." />
  <meta property="og:type" content="article" />
  <meta property="og:url" content="${BASE_URL}/props/${player.slug}" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(player.name)} — Props | SportsSync" />
  <meta name="twitter:description" content="${esc(player.name)} prop odds and historical trends. ${esc(headline)}." />

  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700&family=DM+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />

  <link rel="alternate" type="application/json" href="${BASE_URL}/props/${player.slug}.json" title="${esc(player.name)} — Prop Data Payload" />

  <script type="application/ld+json">
  ${jsonLd}
  </script>
  <style>${CSS}</style>
</head>
<body>
  <a href="#main-content" class="skip-link">Skip to main content</a>

  <nav>
    <a class="nav-brand" href="/">SportsSync</a>
    <ul class="nav-links">
      <li><a href="/props" class="active">Props</a></li>
      <li><a href="/trends/">Trends</a></li>
      <li><a href="/pregame">Matchups</a></li>
      <li><a href="/referees/">Referees</a></li>
    </ul>
  </nav>

  <main class="page" id="main-content">
    <div class="breadcrumb" aria-label="Breadcrumb">
      <a href="/props">All Players</a> <span aria-hidden="true">›</span> <span>${esc(player.name)}</span>
    </div>

    <h1 class="player-name">${esc(player.name)}</h1>
    ${player.team ? `<div class="player-team">${esc(player.team)}</div>` : ''}

    <p class="the-lead">${esc(leadCopy)}</p>

    <div class="market-summary" aria-label="Market summary">
      ${renderMarketSummaryCards(player)}
    </div>

    ${renderMarketSections(player)}

    <hr class="section-divider">

    <p class="method">
      Over rate = overs ÷ (overs + unders), pushes excluded. Display minimum is 10 games. Edge signals require larger stable samples and strong directional rates.
      <br><br>
      <a href="/props/${player.slug}.json" target="_blank" rel="noopener noreferrer">View raw data</a> · <a href="${PACK_URL}" target="_blank" rel="noopener noreferrer">Full evidence pack</a>
    </p>

    <footer class="page-footer">
      <span>Auto-generated ${dateStr} · ${esc(subParts.join(' · '))}</span>
      <a href="/props">← All players</a>
    </footer>
  </main>
</body>
</html>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// Main
// ══════════════════════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : Infinity;
  const fileIdx = args.indexOf('--file');
  const localFile = fileIdx !== -1 ? args[fileIdx + 1] : null;

  let pack;
  if (localFile) {
    console.log('[generate-props] Reading evidence pack from local file: %s', localFile);
    const raw = readFileSync(localFile, 'utf-8');
    pack = normalizePackContract(JSON.parse(raw));
  } else {
    console.log('[generate-props] Fetching evidence pack from %s', PACK_URL);
    const res = await fetch(PACK_URL);
    if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
    pack = normalizePackContract(await res.json());
  }
  console.log('[generate-props] Received %d cards', pack.cards.length);
  if (pack.cards.length === 0) {
    throw new Error('[generate-props] Evidence pack returned zero cards; refusing to publish an empty props surface.');
  }
  await enrichCardTeamsFromAliasMap(pack.cards);

  const players = buildPlayerIndex(pack.cards);
  const sorted = sortPlayers(players);
  const generatedAt = pack.generated_at || new Date().toISOString();
  const selected = sorted.slice(0, limit);
  const selectedSlugs = new Set(selected.map(p => p.slug));
  const packForShell = {
    ...pack,
    cards: (pack.cards || []).filter(c => selectedSlugs.has(slugify(c.player_name))),
  };

  console.log('[generate-props] Generating %d of %d player pages', selected.length, sorted.length);

  // Ensure output directory exists
  mkdirSync(OUTPUT_DIR, { recursive: true });

  // Render /props and /props/ with static first-load player rows from the same pack version.
  const livePropsTemplate = readFileSync(resolve(OUTPUT_DIR, '../props.html'), 'utf-8');
  const renderedPropsShell = buildPropsShell(livePropsTemplate, packForShell, selected);
  writeFileSync(resolve(OUTPUT_DIR, '../props.html'), renderedPropsShell, 'utf-8');
  writeFileSync(join(OUTPUT_DIR, 'index.html'), renderedPropsShell, 'utf-8');

  let count = 0;
  for (const player of selected) {
    const html = playerPage(player, generatedAt);
    const outPath = join(OUTPUT_DIR, `${player.slug}.html`);
    writeFileSync(outPath, html, 'utf-8');

    // Per-player JSON payload (same source object as HTML + JSON-LD)
    const json = buildPayloadJson(player, generatedAt);
    const jsonPath = join(OUTPUT_DIR, `${player.slug}.json`);
    writeFileSync(jsonPath, json, 'utf-8');

    count++;
    if (count % 50 === 0) console.log('[generate-props] ... %d / %d', count, selected.length);
  }

  console.log('[generate-props] ✓ Wrote %d player pages to %s', count, OUTPUT_DIR);

  // ── Update sitemap ──
  const sitemapPath = resolve(OUTPUT_DIR, '../sitemap.xml');
  try {
    let sitemap = readFileSync(sitemapPath, 'utf-8');
    const dateStr = generatedAt.split('T')[0];

    // Remove any previously generated prop entries
    sitemap = sitemap.replace(/\s*<!-- PROPS_START -->[\s\S]*?<!-- PROPS_END -->/g, '');

    // Build new entries
    let propEntries = '\n  <!-- PROPS_START -->';
    propEntries += `\n  <url>\n    <loc>${BASE_URL}/props/</loc>\n    <lastmod>${dateStr}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.8</priority>\n  </url>`;
    for (const p of selected) {
      propEntries += `\n  <url>\n    <loc>${BASE_URL}/props/${p.slug}</loc>\n    <lastmod>${dateStr}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.7</priority>\n  </url>`;
    }
    propEntries += '\n  <!-- PROPS_END -->';

    sitemap = sitemap.replace('</urlset>', propEntries + '\n</urlset>');
    writeFileSync(sitemapPath, sitemap, 'utf-8');
    console.log('[generate-props] ✓ Sitemap updated with %d prop URLs', selected.length + 1);
  } catch (e) {
    console.warn('[generate-props] ⚠ Could not update sitemap:', e.message);
  }

  console.log('[generate-props] Done.');
}

main().catch(err => {
  console.error('[generate-props] FATAL:', err.message);
  process.exit(1);
});
