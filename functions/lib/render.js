/**
 * HTML template renderer for team betting profile pages.
 * Consumer aggregation layer: packages evidence, makes it searchable,
 * creates public trust, and funnels discovery to deeper intelligence surfaces.
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

const BASE_URL = 'https://sportsync-evidence.web.app';
const LEAGUE = 'NBA';
const SEASON = '2025-26';
const CONTRACT_VERSION = 'v1';
const INDEX_COLUMNS = [
  { key: 'team', label: 'Team', align: 'left' },
  { key: 'gp', label: 'GP', align: 'right' },
  { key: 'home_ou', label: 'Home O/U', align: 'right' },
  { key: 'vs_close', label: 'vs Close', align: 'right' },
  { key: 'home_ats', label: 'Home ATS', align: 'right' },
  { key: 'away_ou', label: 'Away O/U', align: 'right' },
];
const TEAM_SECTION_ORDER = [
  'season_summary',
  'strongest_plays',
  'home_away',
  'rest_splits',
  'largest_over_beats',
  'line_movements',
  'upcoming_schedule',
  'recent_games',
  'methodology',
];

const fmt = (n) => n != null ? (n >= 0 ? `+${n}` : `${n}`) : '—';
const tagClass = (result) => result === 'OVER' ? 'over' : result === 'UNDER' ? 'under' : 'split';

function cardSubtitle(teamName, loc) {
  const absAvg = Math.abs(loc.avgVsClose);
  const dir = loc.avgVsClose >= 0 ? 'over' : 'under';
  if (loc.overPct >= 55 && loc.overPct > loc.coverPct) {
    return absAvg >= 3
      ? `${loc.overPct}% over the closing total \u00B7 ${teamName} and their opponents average ${absAvg} points ${dir} the closing total`
      : `${loc.overPct}% over the closing total`;
  }
  if (loc.coverPct >= 55) {
    return `${loc.coverPct}% against the spread`;
  }
  return `${loc.overPct}% over the closing total`;
}

function headlineText(team, stats) {
  const { headline, home, away } = stats;
  if (headline.type === 'over') {
    return `Games involving ${team.city} go over <strong>${headline.pct}%</strong> at home and finish
    <strong>${fmt(headline.avgVs)} points</strong> above the closing total. ${headline.extra}`;
  }
  if (headline.type === 'cover') {
    return `${team.name} cover <strong>${headline.pct}%</strong> at home this season.`;
  }
  if (headline.type === 'away-over') {
    return `${team.name} games go over <strong>${headline.pct}%</strong> on the road, averaging
    <strong>${fmt(headline.avgVs)} points</strong> above the closing total.`;
  }
  return `${team.name} are <strong>${home.overs}-${home.unders}</strong> O/U at home and
  <strong>${away.overs}-${away.unders}</strong> on the road this season.`;
}

function metaDescription(team, stats) {
  const { home } = stats;
  return `${team.name} over/under and ATS trends for the 2025-26 NBA season. ` +
    `${home.overPct}% over rate at home, rest splits, opponent matchups, and upcoming games to watch.`;
}

function normalizeDateOnly(input) {
  if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  const parsed = input ? new Date(input) : new Date();
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString().slice(0, 10);
  return parsed.toISOString().slice(0, 10);
}

function sanitizePayloadStats(stats) {
  const source = stats && typeof stats === 'object' ? stats : {};
  return {
    ...source,
    home: source.home || {},
    away: source.away || {},
    afterLoss: source.afterLoss || {},
    restSplitsHome: Array.isArray(source.restSplitsHome) ? source.restSplitsHome : (Array.isArray(source.restSplits) ? source.restSplits : []),
    restSplitsAway: Array.isArray(source.restSplitsAway) ? source.restSplitsAway : [],
    restSplits: Array.isArray(source.restSplits) ? source.restSplits : [],
    biggestOvers: Array.isArray(source.biggestOvers) ? source.biggestOvers : [],
    recentGames: Array.isArray(source.recentGames) ? source.recentGames : [],
    lineMovements: Array.isArray(source.lineMovements) ? source.lineMovements : [],
    upcomingGames: Array.isArray(source.upcomingGames) ? source.upcomingGames : [],
    strongestPlays: Array.isArray(source.strongestPlays) ? source.strongestPlays : [],
  };
}

function renderRestSplitsTable(title, id, splits) {
  if (!splits || splits.length === 0) return '';
  return `
      <h2 class="section-title" id="${id}">Rest Splits (${title})</h2>
      <div class="table-container" tabindex="0">
        <table>
          <thead>
            <tr><th class="align-left">Rest</th><th class="align-right">Games</th><th class="align-right">Over %</th><th class="align-right">vs Close</th><th class="align-right">Cover %</th></tr>
          </thead>
          <tbody>
${splits.map(s => {
  const best = s.overPct >= 65 || s.coverPct >= 65;
  return `            <tr${best ? ' class="row-highlight"' : ''}>
              <th scope="row" class="text-cell">${s.label}</th>
              <td class="align-right">${s.games}</td>
              <td class="align-right ${s.overPct >= 60 ? 'color-green' : ''}">${s.overPct}%</td>
              <td class="align-right ${s.avgVsClose >= 0 ? 'color-green' : 'color-red'}">${fmt(s.avgVsClose)}</td>
              <td class="align-right ${s.coverPct >= 60 ? 'color-green' : ''}">${s.coverPct}%</td>
            </tr>`;
}).join('\n')}
          </tbody>
        </table>
      </div>`;
}

// ── Template ─────────────────────────────────────────────────────────────────

export function renderTeamPage(team, stats) {
  const {
    home,
    away,
    afterLoss,
    restSplitsHome: rawRestSplitsHome,
    restSplitsAway: rawRestSplitsAway,
    restSplits,
    biggestOvers,
    recentGames,
    lineMovements,
    upcomingGames,
    strongestPlays,
  } = stats;
  const restSplitsHome = rawRestSplitsHome || restSplits || [];
  const restSplitsAway = rawRestSplitsAway || [];

  // ── Dynamic accent color ─────────────────────────────────────────────────
  const accent = team.accent || '#2d5da1';
  // Compute a lighter shade for success-bg
  const accentLight = accent + '18'; // 10% opacity hex

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>${team.name} — Betting Profile | 2025-26 Season</title>
  <meta name="description" content="${metaDescription(team, stats)}" />
  <meta name="robots" content="index, follow" />
  <link rel="canonical" href="${BASE_URL}/trends/${team.slug}" />
  <link rel="alternate" type="application/json" href="${BASE_URL}/trends/${team.slug}.json" title="${team.name} Trend Payload" />

  <meta property="og:title" content="${team.name} — ${home.overPct}% Over Rate at Home | SportsSync" />
  <meta property="og:description" content="${metaDescription(team, stats)}" />
  <meta property="og:type" content="article" />
  <meta property="og:url" content="${BASE_URL}/trends/${team.slug}" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${team.name} — ${home.overPct}% Over Rate at Home" />
  <meta name="twitter:description" content="${metaDescription(team, stats)}" />

  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;0,8..60,700;1,8..60,400&display=swap" rel="stylesheet" />

  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": "${team.name} — Betting Profile | 2025-26 Season",
    "inLanguage": "en",
    "dateModified": "${stats.generatedDate}",
    "datePublished": "${stats.generatedDate}",
    "description": "${metaDescription(team, stats)}",
    "publisher": { "@type": "Organization", "name": "SportsSync Intelligence" },
    "mainEntityOfPage": { "@type": "WebPage", "@id": "${BASE_URL}/trends/${team.slug}" }
  }
  </script>
  ${CSS_BLOCK(accent)}
</head>
<body>
  <a href="#main-content" class="skip-link">Skip to main content</a>

  <nav class="top-nav">
    <div class="top-nav-inner">
      <a class="top-nav-brand" href="/">SportsSync</a>
      <ul class="top-nav-links">
        <li><a href="/props">Props</a></li>
        <li><a class="active" href="/trends/">Trends</a></li>
        <li><a href="/pregame">Matchups</a></li>
        <li><a href="https://ref-tendencies.web.app/">Referees</a></li>
      </ul>
    </div>
  </nav>

  <main class="page" id="main-content">

    <nav class="breadcrumb" aria-label="Breadcrumb">
      <a href="/trends/">All Teams</a> <span aria-hidden="true">›</span> <span>${team.name}</span>
    </nav>

    <header class="team-header">
      <div class="league-tag">NBA 2025–26</div>
      <h1 class="team-name">${team.name} <em>Betting Profile</em></h1>
      <p class="headline-stat">${headlineText(team, stats)}</p>
    </header>

    <section class="season-grid" aria-label="Season summary">
      ${(() => {
        const tg = home.games + away.games;
        const tc = home.covers + away.covers;
        const tn = home.nonCovers + away.nonCovers;
        const to = home.overs + away.overs;
        const tu = home.unders + away.unders;
        const tgl = home.gamesWithLine + away.gamesWithLine;
        const tgs = home.gamesWithSpread + away.gamesWithSpread;
        const fop = tgl ? +((to / tgl) * 100).toFixed(1) : 0;
        const fcp = tgs ? +((tc / tgs) * 100).toFixed(1) : 0;
        const fav = tgl ? +((home.avgVsClose * home.gamesWithLine + away.avgVsClose * away.gamesWithLine) / tgl).toFixed(1) : 0;
        const fl = { overPct: fop, coverPct: fcp, avgVsClose: fav, games: tg };
        return `<article class="stat-card summary-card">
        <div class="card-team">${team.name}</div>
        <div class="card-games">${tg} games</div>
        <div class="card-stats">
          <div class="card-stat-row"><span class="stat-market">ATS</span><span class="stat-record ${fcp >= 55 ? 'color-green' : ''}">${tc}–${tn}</span></div>
          <div class="card-stat-row"><span class="stat-market">O/U</span><span class="stat-record ${fop >= 55 ? 'color-green' : ''}">${to}–${tu}</span></div>
        </div>
        <div class="card-subtitle">${cardSubtitle(team.name, fl)}</div>
      </article>`;
      })()}
      <article class="stat-card summary-card">
        <div class="card-team">After a Loss</div>
        <div class="card-games">${afterLoss.games} games</div>
        <div class="card-stats">
          <div class="card-stat-row"><span class="stat-market">ATS</span><span class="stat-record ${afterLoss.coverPct >= 55 ? 'color-green' : ''}">${afterLoss.covers}–${afterLoss.nonCovers}</span></div>
          <div class="card-stat-row"><span class="stat-market">O/U</span><span class="stat-record ${afterLoss.overPct >= 55 ? 'color-green' : ''}">${afterLoss.overs}–${afterLoss.unders}</span></div>
        </div>
        <div class="card-subtitle">${afterLoss.overPct >= 55 && afterLoss.gamesWithLine >= 8
          ? `${team.name} games go over ${afterLoss.overPct}% of the time after a loss`
          : afterLoss.coverPct >= 55 && afterLoss.gamesWithSpread >= 8
          ? `${team.name} cover ${afterLoss.coverPct}% of the time after a loss`
          : `${afterLoss.games} games after a straight-up loss this season`}</div>
      </article>
      <article class="stat-card detail-card">
        <div class="label">ATS · Home</div>
        <div class="value ${home.coverPct >= 55 ? 'color-green' : ''}">${home.covers}\u2013${home.nonCovers}</div>
        <div class="context"><span>${home.coverPct}%</span> against the spread</div>
        <div class="card-gp">${home.games} games</div>
      </article>
      <article class="stat-card detail-card">
        <div class="label">ATS · Away</div>
        <div class="value ${away.coverPct >= 55 ? 'color-green' : ''}">${away.covers}\u2013${away.nonCovers}</div>
        <div class="context"><span>${away.coverPct}%</span> against the spread</div>
        <div class="card-gp">${away.games} games</div>
      </article>
      <article class="stat-card detail-card">
        <div class="label">O/U · Home</div>
        <div class="value ${home.overPct >= 55 ? 'color-green' : ''}">${home.overs}\u2013${home.unders}</div>
        <div class="context"><span>${home.overPct}%</span> over the closing total</div>
        <div class="card-gp">${home.games} games · avg ${fmt(home.avgVsClose)} pts</div>
      </article>
      <article class="stat-card detail-card">
        <div class="label">O/U · Away</div>
        <div class="value ${away.overPct >= 55 ? 'color-green' : ''}">${away.overs}\u2013${away.unders}</div>
        <div class="context"><span>${away.overPct}%</span> over the closing total</div>
        <div class="card-gp">${away.games} games · avg ${fmt(away.avgVsClose)} pts</div>
      </article>
    </section>

${strongestPlays.length > 0 ? `
    <section class="section-block" aria-labelledby="plays-title">
      <h2 class="section-title" id="plays-title">Strongest Plays</h2>
      <div class="plays-container">
${strongestPlays.map((p, i) => `        <div class="bet-row">
          <div class="bet-rank">${i + 1}</div>
          <div class="bet-desc">${p.desc}</div>
          <div class="bet-stat">${p.pct}%</div>
          <div class="bet-sample">${p.sample}${p.detail ? ' · ' + p.detail : ''}</div>
        </div>`).join('\n')}
      </div>
    </section>
` : ''}

    <section class="section-block" aria-labelledby="splits-title">
      <h2 class="section-title" id="splits-title">Home vs Away</h2>
      <div class="splits-grid">
        <div class="split-col">
          <div class="split-header">Home (${home.games} games)</div>
          <div class="split-item"><span>PPG</span><span class="${home.ppg >= 115 ? 'color-green' : 'fw-500'}">${home.ppg}</span></div>
          <div class="split-item"><span>Opponent PPG</span><span class="fw-500">${home.oppPpg}</span></div>
          <div class="split-item"><span>Avg Total</span><span class="fw-500">${home.avgTotal}</span></div>
          <div class="split-item"><span>Close-Game Over %</span><span class="${home.closeGameOverPct >= 60 ? 'color-green' : 'fw-500'}">${home.closeGameOverPct}%</span></div>
          <div class="split-item"><span>Blowout Rate</span><span class="fw-500">${home.blowoutRate}%</span></div>
        </div>
        <div class="split-col">
          <div class="split-header">Away (${away.games} games)</div>
          <div class="split-item"><span>PPG</span><span class="fw-500">${away.ppg}</span></div>
          <div class="split-item"><span>Opponent PPG</span><span class="fw-500">${away.oppPpg}</span></div>
          <div class="split-item"><span>Avg Total</span><span class="fw-500">${away.avgTotal}</span></div>
          <div class="split-item"><span>Over %</span><span class="${away.overPct >= 55 ? 'color-green' : 'fw-500'}">${away.overPct}%</span></div>
          <div class="split-item"><span>Cover %</span><span class="${away.coverPct >= 55 ? 'color-green' : 'fw-500'}">${away.coverPct}%</span></div>
        </div>
      </div>
${home.overPct - away.overPct > 10 ? `
      <div class="callout">
        <p>Over rate drops ${(home.overPct - away.overPct).toFixed(0)} points on the road (${home.overPct}% → ${away.overPct}%). This is a home-only play.</p>
      </div>` :
  away.overPct - home.overPct > 10 ? `
      <div class="callout">
        <p>Over rate is ${(away.overPct - home.overPct).toFixed(0)} points higher on the road (${away.overPct}% vs ${home.overPct}% at home).</p>
      </div>` : ''}
    </section>

${restSplitsHome.length > 0 || restSplitsAway.length > 0 ? `
    <section class="section-block" aria-labelledby="rest-home-title">
${renderRestSplitsTable('Home', 'rest-home-title', restSplitsHome)}
${renderRestSplitsTable('Away', 'rest-away-title', restSplitsAway)}
    </section>
` : ''}

${biggestOvers.length > 0 ? `
    <section class="section-block" aria-labelledby="overs-title">
      <h2 class="section-title" id="overs-title">Largest Over Beats (Home)</h2>
      <div class="table-container" tabindex="0">
        <table>
          <thead>
            <tr><th class="align-left">Date</th><th class="align-left">Opponent</th><th class="align-right">Score</th><th class="align-right">Total</th><th class="align-right">Line</th><th class="align-right">vs Close</th></tr>
          </thead>
          <tbody>
${biggestOvers.map(g => `            <tr class="row-highlight">
              <th scope="row" class="text-cell">${g.date}</th>
              <td class="text-cell fw-500">${g.opponent}</td>
              <td class="align-right fw-600">${g.homeScore}-${g.awayScore}</td>
              <td class="align-right fw-600">${g.total}</td>
              <td class="align-right">${g.line}</td>
              <td class="align-right color-green">${fmt(g.diff)}</td>
            </tr>`).join('\n')}
          </tbody>
        </table>
      </div>
    </section>
` : ''}

${lineMovements.length > 0 ? `
    <section class="section-block" aria-labelledby="lines-title">
      <h2 class="section-title" id="lines-title">Opening vs Closing Lines</h2>
      <p class="section-note">${lineMovements.length} home games with opening and closing line data.</p>
      <div class="table-container" tabindex="0">
        <table>
          <thead>
            <tr><th class="align-left">Date</th><th class="align-left">Opponent</th><th class="align-right">Open</th><th class="align-right">Close</th><th class="align-right">Move</th><th class="align-right">Actual</th><th class="align-right">vs Close</th><th class="align-right">Result</th></tr>
          </thead>
          <tbody>
${lineMovements.map(g => `            <tr${g.result === 'OVER' ? ' class="row-highlight"' : ''}>
              <th scope="row" class="text-cell">${g.date}</th>
              <td class="text-cell fw-500">${g.opponent}</td>
              <td class="align-right">${g.open}</td>
              <td class="align-right">${g.close}</td>
              <td class="align-right ${g.move >= 0 ? 'color-green' : 'color-red'}">${fmt(g.move)}</td>
              <td class="align-right fw-600">${g.actual}</td>
              <td class="align-right ${g.vsClose >= 0 ? 'color-green' : 'color-red'}">${fmt(g.vsClose)}</td>
              <td class="align-right text-cell"><span class="tag ${tagClass(g.result)}">${g.result}</span></td>
            </tr>`).join('\n')}
          </tbody>
        </table>
      </div>
    </section>
` : ''}

${upcomingGames.length > 0 ? `
    <section class="section-block" aria-labelledby="upcoming-title">
      <h2 class="section-title" id="upcoming-title">Upcoming Schedule</h2>
      <p class="section-note">${upcomingGames.length} games remaining.</p>
      <div class="table-container" tabindex="0">
        <table>
          <thead>
            <tr><th class="align-left">Date</th><th class="align-left">Matchup</th><th class="align-left">Rest</th><th class="align-left">Profile Signal</th></tr>
          </thead>
          <tbody>
${upcomingGames.map(g => {
  const signal = g.isHome
    ? (home.overPct >= 60 ? 'Home over in profile' : home.coverPct >= 55 ? 'Home cover in profile' : 'Standard')
    : (away.overPct >= 60 ? 'Road over in profile' : away.coverPct >= 55 ? 'Road cover in profile' : 'No edge');
  const signalClass = signal.includes('over') || signal.includes('cover') ? 'color-green' : 'text-muted';
  return `            <tr${g.isHome && home.overPct >= 60 ? ' class="row-highlight"' : ''}>
              <th scope="row" class="text-cell">${g.date}</th>
              <td class="text-cell"><span class="fw-600">${g.isHome ? 'vs' : '@'} ${g.opponent}</span><br /><span class="text-muted" style="font-size:13px;">${g.isHome ? 'HOME' : 'AWAY'}${g.restDays <= 1 ? ' · B2B' : ''}</span></td>
              <td class="text-cell ${g.restDays <= 1 ? 'color-red fw-500' : ''}">${g.restLabel || '—'}</td>
              <td class="text-cell ${signalClass} fw-500">${signal}</td>
            </tr>`;
}).join('\n')}
          </tbody>
        </table>
      </div>
    </section>
` : ''}

    <section class="section-block" aria-labelledby="log-title">
      <h2 class="section-title" id="log-title">Recent Game Log</h2>
      <div class="table-container" tabindex="0">
        <table>
          <thead>
            <tr><th class="align-left">Date</th><th class="align-left">Opponent</th><th class="align-right">Score</th><th class="align-right">Total</th><th class="align-right">Line</th><th class="align-right">vs Close</th><th class="align-right">O/U</th></tr>
          </thead>
          <tbody>
${recentGames.map(g => `            <tr${g.result === 'OVER' ? ' class="row-highlight"' : ''}>
              <th scope="row" class="text-cell">${g.date}</th>
              <td class="text-cell ${g.isHome ? 'fw-600' : 'fw-500'}">${g.isHome ? '' : '@ '}${g.opponent}</td>
              <td class="align-right">${g.homeScore}-${g.awayScore}</td>
              <td class="align-right ${g.result === 'OVER' ? 'fw-600' : ''}">${g.total}</td>
              <td class="align-right ${g.line ? '' : 'text-muted'}">${g.line || '—'}</td>
              <td class="align-right ${g.diff != null ? (g.diff >= 0 ? 'color-green' : 'color-red') : 'text-muted'}">${g.diff != null ? fmt(g.diff) : '—'}</td>
              <td class="align-right text-cell"><span class="tag ${g.result ? tagClass(g.result) : 'split'}">${g.result || 'N/A'}</span></td>
            </tr>`).join('\n')}
          </tbody>
        </table>
      </div>
    </section>

    <section class="section-block" aria-labelledby="method-title">
      <h2 class="section-title" id="method-title">Methodology</h2>
      <ul class="methodology-list">
        <li>Data: 2025-26 NBA regular season through ${stats.throughDate} (${stats.totalGames} games: ${home.games} home, ${away.games} away).</li>
        <li><strong>vs Close:</strong> actual combined score minus closing total. Games without a verified closing line are excluded from O/U percentages.</li>
        <li><strong>Close game:</strong> final margin ≤ 10 points.</li>
        <li>O/U computed on ${home.gamesWithLine} of ${home.games} home games and ${away.gamesWithLine} of ${away.games} away games with verified lines.</li>
      </ul>
      <p class="section-note">
        For live intelligence, visit <a href="https://ref-tendencies.web.app/" target="_blank" rel="noopener noreferrer">Ref Tendencies</a>.
      </p>
    </section>

    <footer class="page-footer">
      <div>Auto-generated ${stats.generatedDate}. ${stats.totalGames} games through ${stats.throughDate}.</div>
      <div style="margin-top:8px;"><a href="/trends/">← All team profiles</a></div>
    </footer>
  </main>
</body>
</html>`;
}

// ── CSS (parameterized by accent color) ──────────────────────────────────────

function CSS_BLOCK(accent) {
  return `<style>
    :root {
      --bg-canvas:#fdfbf7;--bg-surface:#fff;--bg-surface-hover:#faf9f6;--bg-subtle:#f5f2ed;
      --text-primary:#1a1a1a;--text-secondary:#454545;--text-tertiary:#666;
      --border-subtle:#ece6de;--border-strong:#e2ddd5;
      --color-accent:${accent};--color-success:#1f6b2e;--color-success-bg:#e8f5e9;
      --color-danger:#8f281f;--color-danger-bg:#fdecea;
      --radius-sm:6px;--radius-md:10px;--radius-lg:14px;--radius-pill:9999px;
      --shadow-sm:0 1px 3px rgba(0,0,0,.04),0 1px 2px rgba(0,0,0,.02);
      --shadow-md:0 4px 12px rgba(0,0,0,.05),0 2px 4px rgba(0,0,0,.02);
      --font-sans:"DM Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
      --font-serif:"Source Serif 4",Georgia,serif;
      --font-mono:"SF Mono","Menlo","JetBrains Mono",monospace;
    }
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:var(--font-sans);background:var(--bg-canvas);color:var(--text-primary);line-height:1.6;font-size:15px;-webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums}
    a{color:var(--color-accent);text-decoration:none;font-weight:500;text-underline-offset:2px}a:hover{text-decoration:underline}
    .skip-link{position:absolute;left:-9999px;top:0;background:var(--text-primary);color:var(--bg-surface);padding:12px 16px;border-radius:var(--radius-sm);z-index:1000;font-weight:500;font-size:14px}.skip-link:focus{left:16px;top:16px}
    .top-nav{position:sticky;top:0;z-index:100;background:rgba(250,250,248,.92);backdrop-filter:saturate(180%) blur(18px);-webkit-backdrop-filter:saturate(180%) blur(18px);border-bottom:1px solid rgba(232,230,223,.8)}
    .top-nav-inner{max-width:1080px;margin:0 auto;min-height:56px;padding:0 24px;display:flex;align-items:center;justify-content:space-between}
    .top-nav-brand{font-family:"JetBrains Mono",monospace;font-weight:500;font-size:15px;letter-spacing:-.02em;color:var(--text-primary);text-decoration:none}
    .top-nav-links{display:flex;gap:32px;list-style:none;align-items:center}
    .top-nav-links a{font-size:14px;color:var(--text-tertiary);text-decoration:none;font-weight:500}
    .top-nav-links a:hover{color:var(--text-primary);text-decoration:none}
    .top-nav-links a.active{color:var(--text-primary);font-weight:600}
    .page{max-width:920px;margin:0 auto;padding:56px 24px}
    .breadcrumb{font-size:13px;color:var(--text-tertiary);margin-bottom:24px}.breadcrumb a{font-weight:400;color:var(--text-tertiary)}.breadcrumb a:hover{color:var(--color-accent)}
    .team-header{margin-bottom:48px}
    .league-tag{font-size:13px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--text-secondary);margin-bottom:16px}
    .team-name{font-family:var(--font-serif);font-size:48px;font-weight:700;letter-spacing:-.01em;line-height:1.1;margin-bottom:16px}.team-name em{font-style:italic;font-weight:400;color:var(--text-secondary)}
    .headline-stat{font-family:var(--font-serif);font-size:22px;line-height:1.5;max-width:800px;text-wrap:balance}.headline-stat strong{color:var(--color-accent);font-weight:600}
    .section-block{margin-bottom:56px}
    .section-title{font-family:var(--font-serif);font-size:26px;font-weight:600;letter-spacing:-.01em;margin-bottom:12px}
    .section-note{font-size:15px;color:var(--text-secondary);margin-bottom:24px}
    .season-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:24px;margin-bottom:48px}
    .stat-card{background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:var(--radius-lg);box-shadow:var(--shadow-sm);transition:transform .2s ease,box-shadow .2s ease}
    .stat-card:hover{transform:translateY(-2px);box-shadow:var(--shadow-md)}
    .summary-card{padding:28px 32px;grid-column:span 1}
    .detail-card{padding:24px}
    .detail-card .label{font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--text-secondary);margin-bottom:12px}
    .detail-card .value{font-family:var(--font-mono);font-size:34px;font-weight:600;letter-spacing:-.02em;line-height:1;margin-bottom:8px}
    .detail-card .context{font-size:13px;color:var(--text-secondary)}.detail-card .context span{font-family:var(--font-mono);font-weight:600;color:var(--text-primary)}
    .card-gp{font-size:12px;color:var(--text-secondary);margin-top:12px;padding-top:10px;border-top:1px solid var(--border-subtle)}
    .card-team{font-family:var(--font-serif);font-size:22px;font-weight:600;letter-spacing:-.01em;margin-bottom:4px}
    .card-games{font-size:13px;font-weight:500;color:var(--text-secondary);margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid var(--border-subtle)}
    .card-stats{display:flex;flex-direction:column;gap:12px;margin-bottom:20px}
    .card-stat-row{display:flex;align-items:baseline;gap:12px}
    .stat-market{font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--text-secondary);width:32px;flex-shrink:0}
    .stat-record{font-family:var(--font-mono);font-size:32px;font-weight:600;letter-spacing:-.02em;line-height:1}
    .card-subtitle{font-size:14px;color:var(--text-secondary);line-height:1.5;padding-top:16px;border-top:1px solid var(--border-subtle)}
    .plays-container{background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:var(--radius-lg);box-shadow:var(--shadow-sm);overflow:hidden}
    .bet-row{display:flex;align-items:center;gap:16px;padding:16px 24px;border-bottom:1px solid var(--border-subtle)}.bet-row:last-child{border-bottom:none}
    .bet-rank{display:flex;align-items:center;justify-content:center;width:28px;height:28px;background:var(--bg-subtle);color:var(--color-accent);font-family:var(--font-mono);border-radius:var(--radius-pill);font-size:13px;font-weight:600;flex-shrink:0}
    .bet-desc{font-size:16px;font-weight:500;flex:1}.bet-stat{font-family:var(--font-mono);font-size:15px;font-weight:600;color:var(--color-success)}
    .bet-sample{font-family:var(--font-mono);font-size:13px;color:var(--text-secondary);width:200px;text-align:right}
    .splits-grid{display:grid;grid-template-columns:1fr 1fr;gap:24px}
    .split-col{background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:var(--radius-lg);padding:24px 28px;box-shadow:var(--shadow-sm)}
    .split-col:first-child{background:var(--bg-surface-hover)}
    .split-col .split-header{font-size:13px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.06em;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--border-subtle)}
    .split-item{display:flex;justify-content:space-between;align-items:center;padding:10px 0;font-size:15px}
    .split-item:not(:last-child){border-bottom:1px dashed var(--border-subtle)}
    .split-item span:first-child{color:var(--text-secondary)}.split-item span:last-child{font-family:var(--font-mono);font-weight:500;font-size:14px}
    .callout{background:var(--bg-subtle);border-left:3px solid var(--color-accent);padding:20px 24px;margin:24px 0;border-radius:0 var(--radius-sm) var(--radius-sm) 0}
    .callout p{font-family:var(--font-sans);font-size:15px;line-height:1.6;margin:0}.callout .num{font-family:var(--font-mono);font-weight:600;color:var(--color-accent)}
    .table-container{overflow-x:auto;background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:var(--radius-lg);box-shadow:var(--shadow-sm);margin-bottom:24px}
    table{width:100%;border-collapse:collapse;text-align:left;font-size:14px;white-space:nowrap}
    thead th{padding:14px 20px;font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--text-secondary);border-bottom:1px solid var(--border-strong);background:var(--bg-surface)}
    tbody th,tbody td{padding:14px 20px;border-bottom:1px solid var(--border-subtle);vertical-align:middle}
    tbody th{font-weight:500}tbody td{font-family:var(--font-mono);font-size:13px;color:var(--text-secondary)}
    tbody tr:last-child th,tbody tr:last-child td{border-bottom:none}tbody tr:hover{background:var(--bg-surface-hover)}
    .align-right{text-align:right}.align-left{text-align:left}
    .text-cell{font-family:var(--font-sans);font-size:14px}.text-cell.fw-500{font-weight:500;color:var(--text-primary)}.text-cell.text-muted{color:var(--text-secondary)}
    .row-highlight td,.row-highlight th{background:rgba(31,107,46,.04)!important;color:var(--text-primary)}.row-highlight:hover td,.row-highlight:hover th{background:rgba(31,107,46,.07)!important}
    .tag{display:inline-flex;align-items:center;padding:4px 10px;border-radius:var(--radius-pill);font-family:var(--font-sans);font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase}
    .tag.over{background:var(--color-success-bg);color:var(--color-success)}.tag.under{background:var(--color-danger-bg);color:var(--color-danger)}.tag.split{background:var(--border-strong);color:var(--text-secondary)}
    .color-green{color:var(--color-success)!important;font-weight:600}.color-red{color:var(--color-danger)!important;font-weight:600}.color-blue{color:var(--color-accent)!important;font-weight:600}
    .fw-500{font-weight:500;color:var(--text-primary)}.fw-600{font-weight:600;color:var(--text-primary)}.text-muted{color:var(--text-secondary)}
    .methodology-list{padding-left:20px;margin-bottom:16px}.methodology-list li{margin-bottom:8px;font-size:14px;color:var(--text-secondary);line-height:1.6}.methodology-list strong{color:var(--text-primary);font-weight:500}
    .page-footer{padding-top:40px;padding-bottom:64px;font-size:14px;color:var(--text-secondary);line-height:1.6}
    @media(max-width:768px){.top-nav-inner{padding:0 16px}.top-nav-links{display:none}.team-name{font-size:40px}.season-grid{grid-template-columns:1fr}.splits-grid{grid-template-columns:1fr}.bet-row{flex-wrap:wrap;padding:16px}.bet-desc{min-width:100%;order:-1;margin-bottom:8px}.bet-sample{text-align:left;margin-right:auto;width:auto}}
  </style>`;
}

function normalizeTeamForPayload(team = {}) {
  return {
    name: team.name || 'Unknown Team',
    slug: team.slug || '',
    city: team.city || '',
    mascot: team.mascot || '',
    accent: team.accent || '#2d5da1',
  };
}

export function buildTeamTrendPayload(teamInput, statsInput, options = {}) {
  const team = normalizeTeamForPayload(teamInput);
  const stats = sanitizePayloadStats(statsInput);
  const generatedDate = normalizeDateOnly(options.generatedDate || stats.generatedDate);
  const throughDate = normalizeDateOnly(stats.throughDate || generatedDate);
  const meta = {
    title: `${team.name} — Betting Profile | ${SEASON} Season`,
    description: metaDescription(team, stats),
    headline: headlineText(team, stats),
  };

  return {
    object_type: 'nba_team_trends_profile',
    contract_version: CONTRACT_VERSION,
    league: LEAGUE,
    season: SEASON,
    url: `${BASE_URL}/trends/${team.slug}`,
    json_url: `${BASE_URL}/trends/${team.slug}.json`,
    generated_at: `${generatedDate}T00:00:00.000Z`,
    section_order: TEAM_SECTION_ORDER,
    team,
    meta,
    stats: {
      ...stats,
      generatedDate,
      throughDate,
      totalGames: Number.isFinite(Number(stats.totalGames)) ? Number(stats.totalGames) : 0,
      strongestPlays: Array.isArray(stats.strongestPlays) ? stats.strongestPlays : [],
      restSplitsHome: Array.isArray(stats.restSplitsHome) ? stats.restSplitsHome : [],
      restSplitsAway: Array.isArray(stats.restSplitsAway) ? stats.restSplitsAway : [],
      biggestOvers: Array.isArray(stats.biggestOvers) ? stats.biggestOvers : [],
      recentGames: Array.isArray(stats.recentGames) ? stats.recentGames : [],
      lineMovements: Array.isArray(stats.lineMovements) ? stats.lineMovements : [],
      upcomingGames: Array.isArray(stats.upcomingGames) ? stats.upcomingGames : [],
    },
    labels: {
      nav_trends: 'Trends',
      section_titles: {
        season_summary: 'Season Summary',
        strongest_plays: 'Strongest Plays',
        home_away: 'Home vs Away',
        rest_splits: 'Rest Splits',
        largest_over_beats: 'Largest Over Beats (Home)',
        line_movements: 'Opening vs Closing Lines',
        upcoming_schedule: 'Upcoming Schedule',
        recent_games: 'Recent Game Log',
        methodology: 'Methodology',
      },
      color_rules: {
        positive_metric_threshold: 55,
        strong_metric_threshold: 60,
        over_highlight_threshold: 65,
      },
    },
    methodology: [
      `Data: ${SEASON} NBA regular season through ${throughDate} (${stats.totalGames || 0} games: ${stats.home?.games || 0} home, ${stats.away?.games || 0} away).`,
      'vs Close: actual combined score minus closing total. Games without a verified closing line are excluded from O/U percentages.',
      'Close game: final margin ≤ 10 points.',
      `O/U computed on ${stats.home?.gamesWithLine || 0} of ${stats.home?.games || 0} home games and ${stats.away?.gamesWithLine || 0} of ${stats.away?.games || 0} away games with verified lines.`,
    ],
  };
}

export function renderTeamTrendPage(payload) {
  return renderTeamPage(payload.team, payload.stats);
}

export function buildTrendsIndexPayload(teamPayloads, options = {}) {
  const payloads = Array.isArray(teamPayloads) ? teamPayloads : [];
  const generatedDate = normalizeDateOnly(options.generatedDate || payloads[0]?.stats?.generatedDate);
  const sortedTeams = [...payloads]
    .sort((a, b) => Number(b?.stats?.home?.overPct || 0) - Number(a?.stats?.home?.overPct || 0))
    .map((entry) => ({
      name: entry.team.name,
      slug: entry.team.slug,
      url: `${BASE_URL}/trends/${entry.team.slug}`,
      json_url: `${BASE_URL}/trends/${entry.team.slug}.json`,
      total_games: Number(entry?.stats?.totalGames || 0),
      home: {
        overs: Number(entry?.stats?.home?.overs || 0),
        unders: Number(entry?.stats?.home?.unders || 0),
        over_pct: Number(entry?.stats?.home?.overPct || 0),
        avg_vs_close: Number(entry?.stats?.home?.avgVsClose || 0),
        covers: Number(entry?.stats?.home?.covers || 0),
        non_covers: Number(entry?.stats?.home?.nonCovers || 0),
        cover_pct: Number(entry?.stats?.home?.coverPct || 0),
      },
      away: {
        overs: Number(entry?.stats?.away?.overs || 0),
        unders: Number(entry?.stats?.away?.unders || 0),
        over_pct: Number(entry?.stats?.away?.overPct || 0),
      },
    }));

  return {
    object_type: 'nba_team_trends_index',
    contract_version: CONTRACT_VERSION,
    league: LEAGUE,
    season: SEASON,
    url: `${BASE_URL}/trends/`,
    json_url: `${BASE_URL}/trends/index.json`,
    generated_at: `${generatedDate}T00:00:00.000Z`,
    sort: { field: 'home.over_pct', direction: 'desc' },
    columns: INDEX_COLUMNS,
    teams: sortedTeams,
  };
}

export function renderTrendsIndexPage(indexPayload) {
  const payload = indexPayload && typeof indexPayload === 'object' ? indexPayload : {};
  const teams = Array.isArray(payload.teams) ? payload.teams : [];
  const generatedDate = normalizeDateOnly(payload.generated_at);
  const rows = teams.map((row) => {
    const homeOu = `${row.home.overs}-${row.home.unders}`;
    const awayOu = `${row.away.overs}-${row.away.unders}`;
    return `            <tr>
              <td class="text-cell"><a href="/trends/${row.slug}" class="fw-600">${row.name}</a></td>
              <td class="align-right">${row.total_games}</td>
              <td class="align-right ${row.home.over_pct >= 55 ? 'color-green' : ''}">${homeOu} (${row.home.over_pct}%)</td>
              <td class="align-right ${row.home.avg_vs_close >= 0 ? 'color-green' : 'color-red'}">${row.home.avg_vs_close >= 0 ? '+' : ''}${row.home.avg_vs_close}</td>
              <td class="align-right ${row.home.cover_pct >= 55 ? 'color-green' : ''}">${row.home.covers}-${row.home.non_covers} (${row.home.cover_pct}%)</td>
              <td class="align-right ${row.away.over_pct >= 55 ? 'color-green' : ''}">${awayOu} (${row.away.over_pct}%)</td>
            </tr>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>NBA Team Betting Profiles — ${SEASON} Season | SportsSync</title>
  <meta name="description" content="Over/under and ATS trends for all 30 NBA teams. Home vs away splits, rest patterns, and strongest plays for the ${SEASON} season." />
  <meta name="robots" content="index, follow" />
  <link rel="canonical" href="${BASE_URL}/trends/" />
  <link rel="alternate" type="application/json" href="${BASE_URL}/trends/index.json" title="NBA Trends Index Payload" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;0,8..60,700&display=swap" rel="stylesheet" />
  <style>
    :root{--bg-canvas:#fdfbf7;--bg-surface:#fff;--bg-surface-hover:#faf9f6;--bg-subtle:#f5f2ed;--text-primary:#1a1a1a;--text-secondary:#454545;--text-tertiary:#666;--border-subtle:#ece6de;--border-strong:#e2ddd5;--color-accent:#2d5da1;--color-success:#1f6b2e;--color-danger:#8f281f;--radius-lg:14px;--shadow-sm:0 1px 3px rgba(0,0,0,.04),0 1px 2px rgba(0,0,0,.02);--font-sans:"DM Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;--font-serif:"Source Serif 4",Georgia,serif;--font-mono:"SF Mono","Menlo",monospace}
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:var(--font-sans);background:var(--bg-canvas);color:var(--text-primary);line-height:1.6;font-size:15px;-webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums}
    a{color:var(--color-accent);text-decoration:none;font-weight:500}a:hover{text-decoration:underline}
    .top-nav{position:sticky;top:0;z-index:100;background:rgba(250,250,248,.92);backdrop-filter:saturate(180%) blur(18px);-webkit-backdrop-filter:saturate(180%) blur(18px);border-bottom:1px solid rgba(232,230,223,.8)}
    .top-nav-inner{max-width:1080px;margin:0 auto;min-height:56px;padding:0 24px;display:flex;align-items:center;justify-content:space-between}
    .top-nav-brand{font-family:'JetBrains Mono',monospace;font-weight:500;font-size:15px;letter-spacing:-.02em;color:var(--text-primary);text-decoration:none}
    .top-nav-links{display:flex;gap:32px;list-style:none;align-items:center}
    .top-nav-links a{font-size:14px;color:var(--text-tertiary);text-decoration:none;font-weight:500}
    .top-nav-links a:hover{color:var(--text-primary)}
    .top-nav-links a.active{color:var(--text-primary);font-weight:600}
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
    @media(max-width:768px){.top-nav-inner{padding:0 16px}.top-nav-links{display:none}.page-title{font-size:32px}}
  </style>
</head>
<body>
  <nav class="top-nav">
    <div class="top-nav-inner">
      <a class="top-nav-brand" href="/">SportsSync</a>
      <ul class="top-nav-links">
        <li><a href="/props">Props</a></li>
        <li><a href="/trends/" class="active">Trends</a></li>
        <li><a href="/pregame">Matchups</a></li>
        <li><a href="https://ref-tendencies.web.app/">Referees</a></li>
      </ul>
    </div>
  </nav>
  <main class="page">
    <h1 class="page-title">NBA Betting Profiles</h1>
    <p class="page-subtitle">Over/under and ATS trends for all 30 NBA teams. Sorted by home over rate. Updated ${generatedDate}.</p>
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
      <p>Auto-generated ${generatedDate}. For live intelligence, visit <a href="https://ref-tendencies.web.app/">Ref Tendencies</a>.</p>
    </div>
  </main>
</body>
</html>`;
}
