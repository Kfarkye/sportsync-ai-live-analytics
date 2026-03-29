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

// ── Data processing (ported from props.html buildPlayerIndex) ────────────────
function buildPlayerIndex(cards) {
  const map = {};
  for (const c of cards) {
    const slug = slugify(c.player_name);
    if (!map[slug]) {
      map[slug] = { name: c.player_name, slug, cards: [], heroCount: 0, maxTier: 'display' };
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
          <div class="pc-market-rate ${rc}">${Number(c.baseline.rate).toFixed(1)}% Over Rate</div>
          <div class="pc-market-gp">${c.baseline.gp} GP · O/U ${lineText}</div>
        </div>
      `;
    }).join('');

    const tierTag = p.maxTier === 'feature'
      ? '<span class="pc-tag hero-tag">Feature</span>'
      : p.maxTier === 'edge'
        ? '<span class="pc-tag edge-tag">Edge</span>'
        : '<span class="pc-tag display-tag">Display</span>';

    const heroTag = p.heroCount > 0
      ? `<span class="pc-tag hero-tag">${p.heroCount} strong signal${p.heroCount > 1 ? 's' : ''}</span>`
      : '';

    return `
      <a class="player-card ${p.heroCount > 0 ? 'has-hero' : ''}" href="/props/${p.slug}" style="animation-delay: ${Math.min(i * 40, 600)}ms">
        <div class="pc-top">
          <div class="pc-name">${esc(p.name)}</div>
          <svg class="pc-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
        <div class="pc-markets">${chipHtml}</div>
        <div class="pc-meta">
          ${tierTag}${heroTag}
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
  --bg: #FAFAF8; --surface: #ffffff;
  --border: #E8E6DF; --border-subtle: #F5F4F0;
  --ink: #1A1917; --ink-secondary: #3D3A35;
  --ink-tertiary: #7D786C; --ink-quaternary: #A8A396;
  --accent: #B85C38; --accent-secondary: #4B9CD3;
  --mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace;
  --serif: 'Source Serif 4', Georgia, serif;
  --sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.04);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.05), 0 1px 3px rgba(0,0,0,0.03);
  --radius: 14px;
  --transition: 180ms cubic-bezier(0.4, 0, 0.2, 1);
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{background:var(--bg);color:var(--ink);font-size:15px}
body{font-family:var(--sans);line-height:1.6;-webkit-font-smoothing:antialiased;
  background-image:radial-gradient(ellipse 80% 50% at 50% 0%,rgba(75,156,211,0.04) 0%,transparent 60%);background-repeat:no-repeat}
a{color:var(--accent);text-decoration:none;font-weight:500;text-underline-offset:2px}a:hover{text-decoration:underline}
.skip-link{position:absolute;left:-9999px;top:0;background:var(--ink);color:var(--surface);padding:12px 16px;border-radius:6px;z-index:1000;font-weight:500;font-size:14px}.skip-link:focus{left:16px;top:16px}

/* Nav */
.nav{position:sticky;top:0;z-index:100;height:48px;background:rgba(250,250,248,0.72);backdrop-filter:saturate(180%) blur(20px);-webkit-backdrop-filter:saturate(180%) blur(20px);border-bottom:1px solid rgba(232,230,223,0.6)}
.nav-inner{max-width:1440px;margin:0 auto;height:48px;padding:0 32px;display:flex;align-items:center;justify-content:space-between}
.nav-brand{font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--ink-tertiary);text-decoration:none}
.nav-tabs{display:flex;gap:6px;align-items:center}
.nav-tab{padding:6px 16px;border:none;background:transparent;font-family:var(--sans);font-size:13px;font-weight:500;color:var(--ink-tertiary);cursor:pointer;border-radius:8px;text-decoration:none;transition:color var(--transition),background var(--transition)}
.nav-tab.active{background:linear-gradient(135deg,var(--accent),#A34F2E);color:#fff;box-shadow:0 1px 4px rgba(184,92,56,0.25),inset 0 1px 0 rgba(255,255,255,0.12)}
.nav-tab:hover:not(.active){color:var(--ink);background:rgba(245,244,240,0.8)}

/* Page shell */
.page{max-width:920px;margin:0 auto;padding:56px 24px}
.breadcrumb{font-size:13px;color:var(--ink-tertiary);margin-bottom:24px}.breadcrumb a{font-weight:400;color:var(--ink-tertiary)}.breadcrumb a:hover{color:var(--accent)}

/* Header */
.player-header{margin-bottom:32px}
.league-tag{font-size:13px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-secondary);margin-bottom:16px}
.player-name{font-family:var(--serif);font-size:48px;font-weight:700;letter-spacing:-.01em;line-height:1.1;margin-bottom:16px}
.headline-stat{font-family:var(--serif);font-size:22px;line-height:1.5;max-width:800px;text-wrap:balance}
.headline-stat strong{color:var(--accent);font-weight:600}

/* Summary grid */
.summary-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:16px;margin-bottom:48px}
.stat-card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:24px;box-shadow:var(--shadow-sm);transition:transform .2s ease,box-shadow .2s ease}
.stat-card:hover{transform:translateY(-2px);box-shadow:var(--shadow-md)}
.stat-card .label{font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--ink-secondary);margin-bottom:12px}
.stat-card .value{font-family:var(--mono);font-size:28px;font-weight:600;letter-spacing:-.02em;line-height:1;margin-bottom:8px}
.stat-card .context{font-size:13px;color:var(--ink-secondary)}.stat-card .context span{font-family:var(--mono);font-weight:600;color:var(--ink)}
.value.rate-high{color:var(--accent)}.value.rate-low{color:#2B6E9C}

/* Market sections */
.section-block{margin-bottom:56px}
.section-title{font-family:var(--serif);font-size:26px;font-weight:600;letter-spacing:-.01em;margin-bottom:12px}
.section-note{font-size:15px;color:var(--ink-secondary);margin-bottom:24px}

.market-section{margin-bottom:32px}
.market-title{font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-tertiary);padding-bottom:12px;border-bottom:1px solid var(--border);margin-bottom:16px;display:flex;align-items:center;justify-content:space-between}
.market-line-label{font-family:var(--mono);font-size:10.5px;font-weight:500;color:var(--ink-quaternary)}

/* Baseline card */
.baseline-card{background:rgba(255,255,255,0.6);border:1px solid rgba(232,230,223,0.4);border-radius:16px;padding:22px 24px;margin-bottom:12px;box-shadow:0 2px 12px rgba(0,0,0,0.03),0 1px 3px rgba(0,0,0,0.02);position:relative;overflow:hidden}
.baseline-card::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3.5px}
.baseline-card.dir-over::before{background:linear-gradient(180deg,var(--accent),#C96830)}
.baseline-card.dir-under::before{background:linear-gradient(180deg,var(--accent-secondary),#3A87BE)}
.baseline-card.dir-none::before{background:linear-gradient(180deg,var(--ink-quaternary),var(--ink-tertiary))}
.bl-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
.bl-label{font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-quaternary)}
.bl-signal{font-family:var(--mono);font-size:10px;font-weight:700;padding:4px 12px;border-radius:8px;white-space:nowrap;letter-spacing:0.02em}
.bl-signal.dir-over{background:linear-gradient(135deg,var(--accent),#A34F2E);color:#fff;box-shadow:0 2px 6px rgba(184,92,56,0.3)}
.bl-signal.dir-under{background:rgba(75,156,211,0.12);color:#2B6E9C;border:1px solid rgba(75,156,211,0.2)}
.bl-signal.dir-none{background:rgba(168,163,150,0.1);color:var(--ink-tertiary);border:1px solid rgba(168,163,150,0.15)}
.bl-tier{font-family:var(--mono);font-size:8.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;padding:2px 8px;border-radius:6px;margin-left:6px}
.bl-tier.feature{background:rgba(184,92,56,0.08);color:var(--accent)}.bl-tier.edge{background:rgba(75,156,211,0.08);color:#2B6E9C}
.bl-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(80px,1fr));gap:16px}
.bl-stat{display:flex;flex-direction:column;gap:2px}
.bl-stat-label{font-size:9px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-quaternary)}
.bl-stat-value{font-family:var(--mono);font-size:20px;font-weight:600;color:var(--ink);letter-spacing:-0.02em}
.bl-stat-value.rate-high{color:var(--accent)}.bl-stat-value.rate-low{color:#2B6E9C}
.bl-stat-value.small{font-size:15px}
.bl-pct-track{width:100%;height:6px;border-radius:4px;background:rgba(0,0,0,0.04);overflow:hidden;margin-top:4px;box-shadow:inset 0 1px 2px rgba(0,0,0,0.06)}
.bl-pct-fill{height:100%;border-radius:4px}
.bl-pct-fill.over{background:linear-gradient(90deg,var(--accent),#C96830)}
.bl-pct-fill.under{background:linear-gradient(90deg,var(--accent-secondary),#3A87BE)}
.bl-pct-fill.neutral{background:rgba(168,163,150,0.4)}

/* Current line card */
.current-line-card{background:rgba(255,255,255,0.5);border:1px solid rgba(232,230,223,0.45);border-radius:12px;padding:16px 20px;margin-bottom:12px}
.cl-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.cl-label{font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-quaternary)}
.cl-line-badge{font-family:var(--mono);font-size:11px;font-weight:700;padding:3px 10px;border-radius:7px;background:rgba(0,0,0,0.04);color:var(--ink-secondary);border:1px solid var(--border-subtle)}
.cl-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(70px,1fr));gap:12px}

/* Book context */
.book-section{margin-top:12px}
.book-title{font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-quaternary);margin-bottom:8px}
.book-chips{display:flex;gap:6px;flex-wrap:wrap}
.book-chip{display:flex;flex-direction:column;gap:2px;padding:8px 12px;border-radius:10px;background:rgba(0,0,0,0.015);border:1px solid var(--border-subtle);min-width:100px}
.book-chip-name{font-size:9px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:var(--ink-quaternary)}
.book-chip-line{font-family:var(--mono);font-size:12px;font-weight:600;color:var(--ink-secondary)}
.book-chip-meta{font-family:var(--mono);font-size:9.5px;color:var(--ink-quaternary)}

/* Context table */
.ctx-section{margin-top:16px}
.ctx-title{font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-quaternary);margin-bottom:8px}
.ctx-table{width:100%;border-collapse:separate;border-spacing:0;background:var(--surface);border:1px solid rgba(232,230,223,0.5);border-radius:10px;overflow:hidden}
.ctx-table th{padding:9px 14px;text-align:left;font-size:9.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--ink-quaternary);background:rgba(250,250,248,0.8);border-bottom:1px solid var(--border)}
.ctx-table th:not(:first-child){text-align:center}
.ctx-table td{padding:10px 14px;font-size:13px;border-bottom:1px solid rgba(232,230,223,0.35);vertical-align:middle}
.ctx-table td:not(:first-child){text-align:center;font-family:var(--mono);font-size:12.5px;font-weight:500}
.ctx-table tr:last-child td{border-bottom:none}
.ctx-table tr:hover{background:rgba(0,0,0,0.015)}
.ctx-label{font-weight:550;color:var(--ink)}.ctx-rate{font-weight:600}
.ctx-rate.over{color:var(--accent)}.ctx-rate.under{color:#2B6E9C}.ctx-rate.neutral{color:var(--ink-secondary)}
.ctx-gp{color:var(--ink-quaternary)}

/* Methodology */
.methodology-list{padding-left:20px;margin-bottom:16px}.methodology-list li{margin-bottom:8px;font-size:14px;color:var(--ink-secondary);line-height:1.6}.methodology-list strong{color:var(--ink);font-weight:500}

/* Footer */
.page-footer{padding-top:40px;padding-bottom:64px;font-size:14px;color:var(--ink-secondary);line-height:1.6}

/* Mobile */
@media(max-width:768px){
  .player-name{font-size:32px}.headline-stat{font-size:18px}
  .page{padding:32px 20px}.summary-grid{grid-template-columns:repeat(2,1fr)}
  .bl-stats{grid-template-columns:repeat(2,1fr)}.cl-stats{grid-template-columns:repeat(2,1fr)}
  .nav-inner{padding:0 16px}.nav-tab{padding:5px 10px;font-size:11.5px}
  .book-chips{gap:4px}.book-chip{min-width:80px;padding:6px 10px}
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
  return Object.values(byMarket).map(c => {
    const rc = rateClass(c.baseline.rate);
    const rl = rateLabel(c.baseline.rate);
    return `
      <article class="stat-card">
        <div class="label">${esc(MARKET_LABEL[c.market] || c.market)}</div>
        <div class="value ${rl}">${Number(c.baseline.rate).toFixed(1)}%</div>
        <div class="context"><span>${c.baseline.record}</span> · ${c.baseline.gp} GP</div>
      </article>`;
  }).join('');
}

function renderMarketSections(player) {
  const byMarket = {};
  for (const c of player.cards) {
    if (!byMarket[c.market]) byMarket[c.market] = [];
    byMarket[c.market].push(c);
  }

  let html = '';
  for (const [market, cards] of Object.entries(byMarket)) {
    const card = cards[0];
    const b = card.baseline;
    const cl = card.current_line;
    const bc = card.book_context || [];
    const dc = dirClass(card.direction);
    const linePart = cl ? `Most Common Historical Line: O/U ${Number(cl.line).toFixed(1)}` : '';

    html += `
    <section class="market-section" aria-labelledby="market-${esc(market)}">
      <div class="market-title">
        <span id="market-${esc(market)}">${esc(MARKET_LABEL[market] || market)}</span>
        <span class="market-line-label">${linePart}</span>
      </div>

      <div class="baseline-card ${dc}">
        <div class="bl-header">
          <div class="bl-label">Baseline — All Games</div>
          <div>
            <span class="bl-signal ${dc}">${dirLabel(card.direction)}</span>
            <span class="bl-tier ${b.tier}">${b.tier}</span>
          </div>
        </div>
        <div class="bl-stats">
          <div class="bl-stat">
            <div class="bl-stat-label">Over Rate</div>
            <div class="bl-stat-value ${rateLabel(b.rate)}">${Number(b.rate).toFixed(1)}%</div>
            <div class="bl-pct-track"><div class="bl-pct-fill ${rateClass(b.rate)}" style="width:${b.rate}%"></div></div>
          </div>
          <div class="bl-stat">
            <div class="bl-stat-label">Record</div>
            <div class="bl-stat-value small">${esc(b.record)}</div>
          </div>
          <div class="bl-stat">
            <div class="bl-stat-label">Average</div>
            <div class="bl-stat-value small">${Number(b.avg).toFixed(1)}</div>
          </div>
          <div class="bl-stat">
            <div class="bl-stat-label">Median</div>
            <div class="bl-stat-value small">${Number(b.median).toFixed(1)}</div>
          </div>
          <div class="bl-stat">
            <div class="bl-stat-label">Games Played</div>
            <div class="bl-stat-value small">${b.gp}</div>
          </div>
        </div>
      </div>`;

    // Current line
    if (cl) {
      html += `
      <div class="current-line-card">
        <div class="cl-header">
          <div class="cl-label">Most Common Historical Line</div>
          <div class="cl-line-badge">O/U ${Number(cl.line).toFixed(1)}</div>
        </div>
        <div class="cl-stats">
          <div class="bl-stat">
            <div class="bl-stat-label">Over Rate</div>
            <div class="bl-stat-value ${rateLabel(cl.rate)}">${Number(cl.rate).toFixed(1)}%</div>
            <div class="bl-pct-track"><div class="bl-pct-fill ${rateClass(cl.rate)}" style="width:${cl.rate}%"></div></div>
          </div>
          <div class="bl-stat">
            <div class="bl-stat-label">Record</div>
            <div class="bl-stat-value small">${esc(cl.record)}</div>
          </div>
          <div class="bl-stat">
            <div class="bl-stat-label">Average</div>
            <div class="bl-stat-value small">${Number(cl.avg).toFixed(1)}</div>
          </div>
          <div class="bl-stat">
            <div class="bl-stat-label">GP at Line</div>
            <div class="bl-stat-value small">${cl.gp}</div>
          </div>
        </div>
      </div>`;
    }

    // Book context
    if (bc.length > 0) {
      html += `
      <div class="book-section">
        <div class="book-title">Book Pricing History</div>
        <div class="book-chips">`;
      for (const bk of bc) {
        html += `
          <div class="book-chip">
            <div class="book-chip-name">${esc(bk.book)}</div>
            <div class="book-chip-line">O/U ${Number(bk.line).toFixed(1)}</div>
            <div class="book-chip-meta">${bk.gp} GP · ${Number(bk.rate).toFixed(0)}% over</div>
          </div>`;
      }
      html += '</div></div>';
    }

    // Supporting contexts
    const contexts = card.supporting_contexts;
    if (contexts && contexts.length > 0) {
      html += `
      <div class="ctx-section">
        <div class="ctx-title">Supporting Context</div>
        <table class="ctx-table">
          <thead><tr><th>Context</th><th>Over Rate</th><th>Record</th><th>GP</th></tr></thead>
          <tbody>`;
      for (const ctx of contexts) {
        html += `
            <tr>
              <td><span class="ctx-label">${esc(ctx.label)}</span></td>
              <td><span class="ctx-rate ${rateClass(ctx.rate)}">${Number(ctx.rate).toFixed(1)}%</span></td>
              <td>${esc(ctx.record || '—')}</td>
              <td><span class="ctx-gp">${ctx.gp}</span></td>
            </tr>`;
      }
      html += '</tbody></table></div>';
    }

    html += '</section>';
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
  const dateStr = generatedAt.split('T')[0];
  const cardCount = player.cards.length;
  const heroCount = player.heroCount;
  const subParts = [`${cardCount} qualified card${cardCount > 1 ? 's' : ''}`];
  if (heroCount > 0) subParts.push(`${heroCount} strong signal${heroCount > 1 ? 's' : ''}`);
  else subParts.push('No strong signal');

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: `${player.name} — Player Prop Profile | 2025-26 Season`,
    inLanguage: 'en',
    dateModified: dateStr,
    datePublished: dateStr,
    description: `${player.name} prop hit rates for the 2025-26 NBA season. ${headline}. ${subParts.join(', ')}.`,
    publisher: { '@type': 'Organization', name: 'SportsSync Intelligence' },
    mainEntityOfPage: { '@type': 'WebPage', '@id': `${BASE_URL}/props/${player.slug}` },
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>${esc(player.name)} — Player Prop Profile | SportsSync</title>
  <meta name="description" content="${esc(player.name)} prop hit rates for the 2025-26 NBA season. ${esc(headline)}. ${esc(subParts.join(', '))}." />
  <meta name="robots" content="index, follow" />
  <link rel="canonical" href="${BASE_URL}/props/${player.slug}" />

  <meta property="og:title" content="${esc(player.name)} — ${esc(headline)} | SportsSync" />
  <meta property="og:description" content="${esc(player.name)} prop hit rates for the 2025-26 NBA season. ${esc(headline)}." />
  <meta property="og:type" content="article" />
  <meta property="og:url" content="${BASE_URL}/props/${player.slug}" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(player.name)} — ${esc(headline)}" />
  <meta name="twitter:description" content="${esc(player.name)} prop hit rates for the 2025-26 NBA season. ${esc(headline)}." />

  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700&family=Inter:wght@400;450;500;550;600;700&family=JetBrains+Mono:wght@400;450;500;600;700&display=swap" rel="stylesheet" />

  <link rel="alternate" type="application/json" href="${BASE_URL}/props/${player.slug}.json" title="${esc(player.name)} — Prop Data Payload" />

  <script type="application/ld+json">
  ${jsonLd}
  </script>
  <style>${CSS}</style>
</head>
<body>
  <a href="#main-content" class="skip-link">Skip to main content</a>

  <nav class="nav">
    <div class="nav-inner">
      <a class="nav-brand" href="/props">SportsSync Intelligence</a>
      <div class="nav-tabs">
        <a class="nav-tab" href="https://ref-tendencies.web.app/">Ref Tendencies</a>
        <a class="nav-tab" href="/trends/">Team Trends</a>
        <a class="nav-tab active" href="/props">Props</a>
      </div>
    </div>
  </nav>

  <main class="page" id="main-content">
    <nav class="breadcrumb" aria-label="Breadcrumb">
      <a href="/props">All Players</a> <span aria-hidden="true">›</span> <span>${esc(player.name)}</span>
    </nav>

    <header class="player-header">
      <div class="league-tag">NBA 2025–26 · Pack generated ${dateStr}</div>
      <h1 class="player-name">${esc(player.name)}</h1>
      <p class="headline-stat"><strong>${esc(headline)}</strong> · ${esc(subParts.join(' · '))}</p>
    </header>

    <section class="summary-grid" aria-label="Market summary">
      ${renderMarketSummaryCards(player)}
    </section>

    <section class="section-block" aria-labelledby="detail-title">
      <h2 class="section-title" id="detail-title">Market Detail</h2>
      <p class="section-note">3-layer model: market baseline → most common historical line → supporting context splits.</p>
      ${renderMarketSections(player)}
    </section>

    <section class="section-block" aria-labelledby="method-title">
      <h2 class="section-title" id="method-title">Methodology</h2>
      <ul class="methodology-list">
        <li><strong>Baseline:</strong> all games for this player × market, across all books and lines.</li>
        <li><strong>Most common historical line:</strong> highest-GP line across all sportsbooks.</li>
        <li><strong>Book context:</strong> hit rate per sportsbook × line combination.</li>
        <li><strong>Supporting context:</strong> venue, pace tier, rest days, season phase splits at the most common historical line.</li>
        <li><strong>Over rate:</strong> overs / (overs + unders), pushes excluded.</li>
        <li><strong>Display floor:</strong> 10 GP minimum. Feature tier: 30+ GP. Hero: 65%+ or 35%- over rate.</li>
      </ul>
      <p class="section-note">
        <a href="/props/${player.slug}.json" target="_blank" rel="noopener noreferrer">View data payload</a> ·
        <a href="${PACK_URL}" target="_blank" rel="noopener noreferrer">Full evidence pack</a>
      </p>
    </section>

    <footer class="page-footer">
      <div>Auto-generated ${dateStr}. ${esc(subParts.join(' · '))}.</div>
      <div style="margin-top:8px;"><a href="/props">← All player profiles</a></div>
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
    pack = JSON.parse(raw);
  } else {
    console.log('[generate-props] Fetching evidence pack from %s', PACK_URL);
    const res = await fetch(PACK_URL);
    if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
    pack = await res.json();
  }
  console.log('[generate-props] Received %d cards', pack.cards.length);

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
