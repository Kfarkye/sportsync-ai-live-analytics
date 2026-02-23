#!/usr/bin/env node
/**
 * Local wrapper: injects data from Supabase SQL dumps into generate-team-pages logic.
 * Avoids needing REST API access from CI/container environments.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const PUBLIC_DIR = join(REPO_ROOT, 'public');
const SITE_URL = 'https://thedrip.to';
const NOW = new Date().toISOString().split('T')[0];

// Load data from local JSON files
const teams = JSON.parse(readFileSync(join(__dirname, 'data/teams.json'), 'utf8'));
const fixtures = JSON.parse(readFileSync(join(__dirname, 'data/fixtures.json'), 'utf8'));
const odds = JSON.parse(readFileSync(join(__dirname, 'data/odds.json'), 'utf8'));

console.log(`Loaded: ${teams.length} teams, ${fixtures.length} fixtures, ${odds.length} odds\n`);

// ── PageModel assembly ─────────────────────────────────────────────
function assemblePageModel(team, allFixtures, allOdds, allTeams) {
  const teamFixtures = allFixtures
    .filter(f => f.home_slug === team.slug || f.away_slug === team.slug)
    .map(f => {
      const isHome = f.home_slug === team.slug;
      const oppSlug = isHome ? f.away_slug : f.home_slug;
      const opponent = allTeams.find(t => t.slug === oppSlug);
      return {
        fixture_id: f.fixture_id, match_number: f.match_number,
        opponent_slug: oppSlug, opponent_name: opponent?.name || oppSlug,
        opponent_code: opponent?.fifa_code || '???',
        venue: f.venue, city: f.city, kickoff: f.kickoff,
        is_home: isHome, stage: f.stage, group_letter: f.group_letter,
      };
    })
    .sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));

  const teamOdds = allOdds.filter(o => o.team_slug === team.slug);
  const outrightOdds = teamOdds.filter(o => o.market === 'outright_winner');
  const groupOdds = teamOdds.filter(o => o.market === 'group_winner');
  const bookOdds = outrightOdds.filter(o => o.bookmaker !== 'polymarket');
  const pmOdds = outrightOdds.filter(o => o.bookmaker === 'polymarket');

  let delta = null;
  if (bookOdds.length > 0 && pmOdds.length > 0) {
    const bookAvg = bookOdds.reduce((s, o) => s + parseFloat(o.implied_probability), 0) / bookOdds.length;
    const pmProb = parseFloat(pmOdds[0].implied_probability);
    delta = {
      book_implied: bookAvg, pm_implied: pmProb, delta: pmProb - bookAvg,
      signal: Math.abs(pmProb - bookAvg) >= 0.03 ? 'ACTIONABLE' :
              Math.abs(pmProb - bookAvg) >= 0.01 ? 'MONITOR' : 'NOISE',
    };
  }

  const hasMarkets = bookOdds.length >= 1;
  const hasFixtures = teamFixtures.length >= 3;
  const isIndexable = hasMarkets && hasFixtures && !team.is_playoff_pending;

  return {
    team, fixtures: teamFixtures, outrightOdds, groupOdds,
    bookOdds, pmOdds, delta, isIndexable, hasMarkets, hasFixtures,
    publishState: team.is_playoff_pending ? 'DRAFT' :
                  isIndexable ? 'PUBLISHED' : 'NOINDEX',
  };
}

// ── FAQ generation ─────────────────────────────────────────────────
function generateFaqs(model) {
  const { team, fixtures, delta } = model;
  const groupFixtures = fixtures.filter(f => f.stage === 'group');
  const opponents = groupFixtures.map(f => f.opponent_name).join(', ');
  const firstMatch = groupFixtures[0];

  return [
    {
      q: `What are ${team.name}'s odds to win the 2026 World Cup?`,
      a: model.bookOdds.length > 0
        ? `${team.name} are currently priced around +${model.bookOdds[0].american_odds} at major U.S. sportsbooks to win the 2026 FIFA World Cup outright. This implies roughly a ${(parseFloat(model.bookOdds[0].implied_probability) * 100).toFixed(1)}% chance based on bookmaker consensus. Odds update frequently as the tournament approaches.`
        : `${team.name}'s outright winner odds will be available as sportsbooks open World Cup 2026 futures markets. Check back closer to the tournament for live pricing.`,
    },
    {
      q: `What group is ${team.name} in for the 2026 World Cup?`,
      a: `${team.name} are in Group ${team.group_letter} alongside ${opponents}. The group stage runs June 11–28, 2026 across the United States, Mexico, and Canada. The top two teams from each group plus the eight best third-place finishers advance to the Round of 32.`,
    },
    {
      q: `When is ${team.name}'s first match at the 2026 World Cup?`,
      a: firstMatch
        ? `${team.name} open their World Cup campaign against ${firstMatch.opponent_name} at ${firstMatch.venue} in ${firstMatch.city} on ${formatDateLong(firstMatch.kickoff)}.`
        : `${team.name}'s match schedule will be confirmed once the draw is finalized.`,
    },
    {
      q: `How do prediction markets rate ${team.name}'s chances?`,
      a: delta
        ? `Prediction markets like Polymarket and Kalshi currently price ${team.name} at around ${(delta.pm_implied * 100).toFixed(1)}% implied probability to win the tournament. This ${delta.delta > 0 ? 'exceeds' : 'trails'} sportsbook consensus of ${(delta.book_implied * 100).toFixed(1)}% by ${Math.abs(delta.delta * 100).toFixed(1)} percentage points — a ${delta.signal.toLowerCase()}-tier gap.`
        : `Prediction market pricing for ${team.name} will become available as the tournament approaches. These markets often provide sharper probability estimates than traditional sportsbooks.`,
    },
    {
      q: `What is ${team.name}'s FIFA ranking heading into 2026?`,
      a: team.fifa_rank
        ? `${team.name} are ranked #${team.fifa_rank} in the FIFA Men's World Rankings (January 2026). They are part of the ${team.confederation} confederation and have ${team.world_cup_titles > 0 ? `won ${team.world_cup_titles} World Cup title${team.world_cup_titles > 1 ? 's' : ''}` : 'never won a World Cup'}.${team.head_coach ? ` The team is managed by ${team.head_coach}.` : ''}`
        : `${team.name}'s FIFA ranking will be confirmed once they qualify through the playoffs. Their World Cup campaign depends on the March 2026 playoff results.`,
    },
    {
      q: `Where can I compare ${team.name} odds across sportsbooks?`,
      a: `The Drip aggregates ${team.name}'s World Cup odds from BetMGM, FanDuel, DraftKings, and prediction markets like Polymarket and Kalshi. We surface cross-ecosystem gaps where sportsbook pricing diverges from prediction market consensus, highlighting potential value opportunities.`,
    },
  ];
}

// ── HTML generation ────────────────────────────────────────────────
function generateHtml(model, allTeams, faqs) {
  const { team, fixtures, outrightOdds, groupOdds, bookOdds, pmOdds, delta, publishState } = model;
  const groupFixtures = fixtures.filter(f => f.stage === 'group');
  const slug = team.slug;
  const canonical = `${SITE_URL}/teams/${slug}/`;
  const title = team.seo_title || `${team.name} World Cup 2026 Odds & Schedule | The Drip`;
  const description = team.seo_description || `Compare ${team.name} odds across sportsbooks and prediction markets. Group ${team.group_letter}. Live cross-ecosystem analysis.`;
  const robots = publishState === 'PUBLISHED' ? 'index, follow' :
                 publishState === 'NOINDEX' ? 'noindex, follow' : 'noindex, nofollow';

  // JSON-LD @graph
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'FAQPage',
        'mainEntity': faqs.map(f => ({
          '@type': 'Question',
          'name': f.q,
          'acceptedAnswer': { '@type': 'Answer', 'text': f.a },
        })),
      },
      ...groupFixtures.map(f => ({
        '@type': 'SportsEvent',
        'name': f.is_home ? `${team.name} vs ${f.opponent_name}` : `${f.opponent_name} vs ${team.name}`,
        'startDate': toLocalIso(f.kickoff, f.city),
        'location': {
          '@type': 'Place',
          'name': f.venue,
          'address': { '@type': 'PostalAddress', 'addressLocality': f.city },
        },
        'homeTeam': { '@type': 'SportsTeam', 'name': f.is_home ? team.name : f.opponent_name },
        'awayTeam': { '@type': 'SportsTeam', 'name': f.is_home ? f.opponent_name : team.name },
        'superEvent': {
          '@type': 'SportsEvent',
          'name': 'FIFA World Cup 2026',
          'startDate': '2026-06-11',
          'endDate': '2026-07-19',
        },
        'eventStatus': 'https://schema.org/EventScheduled',
        'url': canonical,
      })),
    ],
  };

  // Odds rows — separate outright and group markets
  const outrightBookRows = bookOdds.map(o => ({
    source: capitalize(o.bookmaker), american: formatAmerican(o.american_odds),
    implied: `${(parseFloat(o.implied_probability) * 100).toFixed(1)}%`, type: 'book',
  }));
  const outrightPmRows = pmOdds.map(o => ({
    source: 'Polymarket', american: formatAmerican(o.american_odds),
    implied: `${(parseFloat(o.implied_probability) * 100).toFixed(1)}%`, type: 'pm',
  }));

  // Group winner odds
  const groupWinnerOdds = groupOdds.length > 0 ? groupOdds[0] : null;

  // Delta badge
  const deltaBadge = delta ? `
    <span class="gap-badge ${delta.signal === 'ACTIONABLE' ? 'gap-actionable' : delta.signal === 'MONITOR' ? 'gap-monitor' : 'gap-noise'}" role="status" aria-label="Cross-ecosystem gap: ${Math.abs(delta.delta * 100).toFixed(1)}% ${delta.signal}">
      ${delta.delta > 0 ? '▲' : '▼'} ${Math.abs(delta.delta * 100).toFixed(1)}% gap · ${delta.signal}
    </span>` : '';

  // Fixture cards
  const fixtureHtml = groupFixtures.map(f => `
      <div class="fixture-card">
        <div class="fixture-stage">Matchday ${f.match_number <= 36 ? Math.ceil((groupFixtures.indexOf(f) + 1)) : ''}</div>
        <div class="fixture-date">${formatDateShort(f.kickoff)}</div>
        <div class="fixture-matchup">
          ${f.is_home ? `<strong>${team.fifa_code}</strong> vs ${f.opponent_code}` : `${f.opponent_code} vs <strong>${team.fifa_code}</strong>`}
        </div>
        <div class="fixture-venue">${escHtml(f.venue)}, ${escHtml(f.city)}</div>
      </div>`).join('\n');

  // FAQ accordion
  const faqHtml = faqs.map((f, i) => `
      <div class="faq-item">
        <button class="faq-q" id="faq-q${i+1}" aria-expanded="false" aria-controls="faq-a${i+1}">
          ${escHtml(f.q)}
        </button>
        <div class="faq-a" id="faq-a${i+1}" role="region" aria-labelledby="faq-q${i+1}" hidden>
          <p>${escHtml(f.a)}</p>
        </div>
      </div>`).join('\n');

  // Group table (all 4 teams in this group)
  const groupTeams = allTeams
    .filter(t => t.group_letter === team.group_letter)
    .sort((a, b) => (a.pot || 99) - (b.pot || 99));

  const groupTableRows = groupTeams.map(t => {
    const tOdds = odds.filter(o => o.team_slug === t.slug && o.market === 'group_winner');
    const gwOdds = tOdds.length > 0 ? formatAmerican(tOdds[0].american_odds) : '—';
    const isCurrent = t.slug === slug;
    return `
        <tr${isCurrent ? ' class="current-team"' : ''}>
          <td class="team-cell"><img src="${t.flag_uri}" alt="" width="20" height="14" loading="lazy"> ${escHtml(t.name)}</td>
          <td class="mono">${t.fifa_rank || '—'}</td>
          <td class="mono">${gwOdds}</td>
        </tr>`;
  }).join('\n');

  // Team link grid
  const teamLinks = allTeams
    .filter(t => !t.is_playoff_pending)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(t => {
      const isCurrent = t.slug === slug;
      return `<a href="/teams/${t.slug}/"${isCurrent ? ' aria-current="page" class="team-link current"' : ' class="team-link"'}>${escHtml(t.name)}</a>`;
    }).join('\n          ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escHtml(title)}</title>
  <meta name="description" content="${escHtml(description)}">
  <link rel="canonical" href="${canonical}">
  <meta name="robots" content="${robots}">
  <meta property="og:title" content="${escHtml(team.name)} World Cup 2026 Odds | The Drip">
  <meta property="og:description" content="${escHtml(description)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:type" content="website">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escHtml(team.name)} World Cup 2026 Odds | The Drip">
  <script type="application/ld+json">
${JSON.stringify(jsonLd, null, 2)}
  </script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@1,300;1,400&family=Outfit:wght@200;300;400;500;600&family=JetBrains+Mono:wght@300;400;500&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #0a0a0a; --bg-raised: #111111; --bg-hover: #161616;
      --border: #1e1e1e; --border-active: #2a2a2a;
      --text: #e8e4dc; --text-secondary: #8a8a8a; --text-muted: #555;
      --accent: #00c978; --accent-dim: rgba(0,201,120,0.12);
      --amber: #ffc107; --amber-dim: rgba(255,193,7,0.12);
      --red: #ff4444;
      --mono: 'JetBrains Mono', 'SF Mono', 'Fira Code', monospace;
      --sans: 'Outfit', system-ui, -apple-system, sans-serif;
      --serif: 'Cormorant Garamond', 'Times New Roman', serif;
      --max-w: 720px;
      --space-xs: 4px; --space-sm: 8px; --space-md: 16px; --space-lg: 24px; --space-xl: 32px;
    }

    body { background: var(--bg); color: var(--text); font-family: var(--sans); font-size: 15px; line-height: 1.6; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }

    /* Navigation */
    .nav { border-bottom: 1px solid var(--border); padding: var(--space-md) var(--space-lg); display: flex; align-items: center; gap: var(--space-sm); }
    .nav a { text-decoration: none; display: flex; align-items: baseline; gap: 2px; }
    .nav .the { font-size: 11px; color: var(--text-secondary); text-transform: lowercase; }
    .nav .drip { font-size: 28px; font-family: var(--serif); font-style: italic; font-weight: 300; color: var(--text-secondary); line-height: 1; }

    .breadcrumb { max-width: var(--max-w); margin: var(--space-md) auto 0; padding: 0 var(--space-lg); font-size: 0.75rem; color: var(--text-muted); }
    .breadcrumb a { color: var(--text-muted); text-decoration: none; transition: color 0.15s; }
    .breadcrumb a:hover { color: var(--text-secondary); }
    .breadcrumb span { margin: 0 6px; }

    /* Hero */
    .hero { max-width: var(--max-w); margin: 0 auto; padding: var(--space-xl) var(--space-lg) var(--space-lg); text-align: center; }
    .hero-flag { width: 64px; height: 43px; border-radius: 4px; object-fit: cover; margin-bottom: 12px; border: 1px solid var(--border); }
    .hero h1 { font-family: var(--serif); font-style: italic; font-size: 2.25rem; font-weight: 300; margin: 0 0 var(--space-sm); letter-spacing: -0.01em; }
    .hero-meta { color: var(--text-secondary); font-size: 0.875rem; margin: 0 0 var(--space-md); font-weight: 300; }
    .hero-odds { font-family: var(--mono); font-size: 1.125rem; color: var(--text); margin: 0 0 var(--space-sm); font-weight: 400; }
    .gap-badge { display: inline-block; padding: var(--space-xs) 12px; border-radius: 4px; font-family: var(--mono); font-size: 0.8rem; font-weight: 400; }
    .gap-actionable { background: var(--accent-dim); color: var(--accent); }
    .gap-monitor { background: var(--amber-dim); color: var(--amber); }
    .gap-noise { background: rgba(138,138,138,0.08); color: var(--text-secondary); }

    /* Sections */
    .section { max-width: var(--max-w); margin: 0 auto; padding: var(--space-lg); }
    .section + .section { padding-top: 0; }
    .section-title { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-muted); margin: 0 0 var(--space-md); font-weight: 500; }

    /* Odds table */
    .odds-table { width: 100%; border-collapse: collapse; }
    .odds-table th, .odds-table td { padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--border); font-size: 0.875rem; }
    .odds-table th { color: var(--text-secondary); font-weight: 500; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; }
    .mono { font-family: var(--mono); font-weight: 400; }
    .odds-table .section-label { color: var(--text-muted); font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; padding-top: var(--space-md); border-bottom: none; font-weight: 500; }
    .odds-table .pm-row { background: rgba(0,201,120,0.03); }

    /* Group table */
    .group-table { width: 100%; border-collapse: collapse; }
    .group-table th, .group-table td { padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--border); font-size: 0.875rem; }
    .group-table th { color: var(--text-secondary); font-weight: 500; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; }
    .group-table .team-cell { display: flex; align-items: center; gap: var(--space-sm); }
    .group-table .team-cell img { border-radius: 2px; border: 1px solid var(--border); flex-shrink: 0; }
    .group-table .current-team { background: rgba(0,201,120,0.04); }

    /* Fixtures */
    .fixture-strip { display: flex; gap: 12px; overflow-x: auto; padding-bottom: var(--space-sm); scrollbar-width: thin; scrollbar-color: var(--border) transparent; }
    .fixture-strip::-webkit-scrollbar { height: 4px; }
    .fixture-strip::-webkit-scrollbar-track { background: transparent; }
    .fixture-strip::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
    .fixture-card { flex: 0 0 auto; min-width: 210px; background: var(--bg-raised); border: 1px solid var(--border); border-radius: 6px; padding: 14px 16px; transition: border-color 0.15s; }
    .fixture-card:hover { border-color: var(--border-active); }
    .fixture-stage { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); margin-bottom: 2px; }
    .fixture-date { font-size: 0.75rem; color: var(--text-secondary); margin-bottom: 6px; }
    .fixture-matchup { font-size: 0.9rem; font-weight: 500; margin-bottom: 4px; }
    .fixture-venue { font-size: 0.75rem; color: var(--text-muted); }

    /* Edge card */
    .edge-card { background: var(--bg-raised); border: 1px solid var(--border); border-radius: 6px; padding: 20px; margin-top: var(--space-sm); }
    .edge-metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-md); margin-bottom: var(--space-md); }
    .metric { text-align: center; }
    .metric-label { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); margin-bottom: var(--space-xs); }
    .metric-value { font-family: var(--mono); font-size: 1.1rem; }
    .metric-positive { color: var(--accent); }
    .metric-negative { color: var(--red); }
    .edge-narrative { font-size: 0.875rem; color: #bbb; line-height: 1.65; border-top: 1px solid var(--border); padding-top: var(--space-md); }

    /* FAQ */
    .faq-item { border-bottom: 1px solid var(--border); }
    .faq-q { display: block; width: 100%; background: none; border: none; color: var(--text); font-family: var(--sans); font-size: 0.9rem; font-weight: 400; padding: 14px 0; cursor: pointer; text-align: left; transition: color 0.15s; }
    .faq-q:hover { color: var(--accent); }
    .faq-q::before { content: '+ '; color: var(--text-muted); font-family: var(--mono); }
    .faq-q[aria-expanded="true"]::before { content: '– '; color: var(--accent); }
    .faq-a { padding: 0 0 14px 18px; }
    .faq-a p { margin: 0; font-size: 0.85rem; color: #bbb; line-height: 1.65; }

    /* Team links */
    .team-grid { display: flex; flex-wrap: wrap; gap: 6px; }
    .team-link { display: inline-block; padding: var(--space-xs) 10px; font-size: 0.75rem; color: var(--text-secondary); text-decoration: none; border: 1px solid var(--border); border-radius: 4px; transition: all 0.15s; }
    .team-link:hover { border-color: var(--text-muted); color: var(--text); }
    .team-link.current { border-color: var(--accent); color: var(--accent); }

    /* Receipt + Footer */
    .receipt { max-width: var(--max-w); margin: var(--space-xl) auto 0; padding: var(--space-md) var(--space-lg); border-top: 1px solid var(--border); color: var(--text-muted); font-size: 0.7rem; line-height: 1.6; }
    footer { max-width: var(--max-w); margin: var(--space-lg) auto; padding: var(--space-md) var(--space-lg); border-top: 1px solid var(--border); color: var(--text-muted); font-size: 0.65rem; line-height: 1.6; }
    footer a { color: var(--text-muted); }

    @media (max-width: 480px) {
      .hero h1 { font-size: 1.75rem; }
      .edge-metrics { grid-template-columns: 1fr; gap: var(--space-sm); }
      .section { padding: var(--space-md); }
    }
  </style>
</head>
<body>
  <nav class="nav" aria-label="Main navigation">
    <a href="/"><span class="the">the</span><span class="drip">Drip</span></a>
  </nav>

  <div class="breadcrumb" aria-label="Breadcrumb">
    <a href="/">The Drip</a><span>/</span><a href="/#world-cup-2026">World Cup 2026</a><span>/</span>${escHtml(team.name)}
  </div>

  <header class="hero">
    <img class="hero-flag" src="${team.flag_uri}" alt="${escHtml(team.name)} flag" width="64" height="43" loading="eager">
    <h1>${escHtml(team.name)}</h1>
    <p class="hero-meta">Group ${team.group_letter}${team.world_cup_titles > 0 ? ` · ${team.world_cup_titles}× Champion${team.world_cup_titles > 1 ? 's' : ''}` : ''}${team.fifa_rank ? ` · FIFA #${team.fifa_rank}` : ''}${team.head_coach ? ` · ${escHtml(team.head_coach)}` : ''}</p>
    ${bookOdds.length > 0 ? `<p class="hero-odds">${formatAmerican(bookOdds[0].american_odds)} to win</p>` : ''}
    ${deltaBadge}
  </header>

  <!-- GROUP TABLE -->
  <section class="section" aria-label="Group ${team.group_letter} standings">
    <div class="section-title">Group ${team.group_letter}</div>
    <table class="group-table">
      <thead><tr><th>Team</th><th>FIFA</th><th>Group Odds</th></tr></thead>
      <tbody>
${groupTableRows}
      </tbody>
    </table>
  </section>

  <!-- OUTRIGHT ODDS -->
  ${outrightBookRows.length > 0 ? `
  <section class="section" aria-label="Outright winner odds comparison">
    <div class="section-title">Outright Winner Odds</div>
    <table class="odds-table">
      <thead><tr><th>Source</th><th>American</th><th>Implied %</th></tr></thead>
      <tbody>
        <tr><td colspan="3" class="section-label">US Regulated</td></tr>
        ${outrightBookRows.map(o => `<tr><td>${o.source}</td><td class="mono">${o.american}</td><td class="mono">${o.implied}</td></tr>`).join('\n        ')}
        ${outrightPmRows.length > 0 ? `<tr><td colspan="3" class="section-label">Prediction Markets</td></tr>
        ${outrightPmRows.map(o => `<tr class="pm-row"><td>${o.source}</td><td class="mono">${o.american}</td><td class="mono">${o.implied}</td></tr>`).join('\n        ')}` : ''}
      </tbody>
    </table>
  </section>` : ''}

  <!-- FIXTURES -->
  ${groupFixtures.length > 0 ? `
  <section class="section" aria-label="Group stage fixtures">
    <div class="section-title">Group ${team.group_letter} Fixtures</div>
    <div class="fixture-strip">
${fixtureHtml}
    </div>
  </section>` : ''}

  <!-- EDGE ANALYSIS -->
  ${delta ? `
  <section class="section" aria-label="Cross-ecosystem edge analysis">
    <div class="section-title">Cross-Ecosystem Edge</div>
    <div class="edge-card">
      <div class="edge-metrics">
        <div class="metric">
          <div class="metric-label">Book Implied</div>
          <div class="metric-value">${(delta.book_implied * 100).toFixed(1)}%</div>
        </div>
        <div class="metric">
          <div class="metric-label">PM Price</div>
          <div class="metric-value">${(delta.pm_implied * 100).toFixed(1)}%</div>
        </div>
        <div class="metric">
          <div class="metric-label">Delta</div>
          <div class="metric-value ${delta.delta < 0 ? 'metric-negative' : 'metric-positive'}">${delta.delta > 0 ? '+' : ''}${(delta.delta * 100).toFixed(1)}%</div>
        </div>
      </div>
      <div class="edge-narrative">
        Sportsbooks price ${escHtml(team.name)} at ${(delta.book_implied * 100).toFixed(1)}% implied probability to win the 2026 World Cup. Prediction markets trade at ${(delta.pm_implied * 100).toFixed(1)}% — a ${Math.abs(delta.delta * 100).toFixed(1)} percentage point ${delta.delta < 0 ? 'discount' : 'premium'}. ${
          delta.signal === 'ACTIONABLE' ? 'This gap exceeds 3%, indicating a potentially exploitable inefficiency between ecosystems.' :
          delta.signal === 'MONITOR' ? 'This gap is at monitor level — worth tracking but not yet at actionable thresholds.' :
          'This gap is within noise range and reflects normal pricing variance.'
        }
      </div>
    </div>
  </section>` : ''}

  <!-- FAQ -->
  <section class="section" aria-label="Frequently asked questions">
    <div class="section-title">Frequently Asked Questions</div>
${faqHtml}
  </section>

  <!-- ALL TEAMS -->
  <section class="section" aria-label="All World Cup 2026 teams">
    <div class="section-title">All Teams</div>
    <div class="team-grid">
          ${teamLinks}
    </div>
  </section>

  <div class="receipt">
    <strong>Pre-tournament snapshot</strong> · Generated ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC<br>
    Sources: BetMGM, FanDuel, Polymarket · Odds as of last ingestion<br>
    Prediction market prices reflect last traded contract price, not mid-market.
  </div>

  <footer>
    <p>The Drip may earn a commission if you sign up through links on this page.
    Odds and prices are informational only. Gambling involves risk.
    Confirm legality in your jurisdiction before placing wagers.</p>
    <p>© ${new Date().getFullYear()} The Drip. All rights reserved.</p>
  </footer>

  <script>
    document.querySelectorAll('.faq-q').forEach(btn => {
      btn.addEventListener('click', () => {
        const expanded = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', !expanded);
        btn.nextElementSibling.hidden = expanded;
      });
    });
  </script>
</body>
</html>`;
}

// ── Sitemap update ─────────────────────────────────────────────────
function updateSitemap(publishedSlugs) {
  const sitemapPath = join(PUBLIC_DIR, 'sitemap.xml');
  let sitemap = readFileSync(sitemapPath, 'utf8');
  sitemap = sitemap.replace('</urlset>', '');

  for (const slug of publishedSlugs) {
    const entry = `  <url>\n    <loc>${SITE_URL}/teams/${slug}/</loc>\n    <lastmod>${NOW}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.9</priority>\n  </url>\n`;
    if (!sitemap.includes(`/teams/${slug}/`)) {
      sitemap += entry;
    }
  }
  sitemap += '</urlset>\n';
  writeFileSync(sitemapPath, sitemap);
}

// ── Utilities ──────────────────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function formatAmerican(odds) { return odds >= 0 ? `+${odds}` : `${odds}`; }

// City → UTC offset during June (all venues in DST)
const VENUE_OFFSETS = {
  'Atlanta': '-04:00', 'East Rutherford': '-04:00', 'Miami Gardens': '-04:00',
  'Foxborough': '-04:00', 'Philadelphia': '-04:00', 'Toronto': '-04:00',
  'Mexico City': '-05:00', 'Guadalajara': '-05:00', 'Monterrey': '-05:00',
  'Houston': '-05:00', 'Arlington': '-05:00', 'Kansas City': '-05:00',
  'Inglewood': '-07:00', 'Santa Clara': '-07:00', 'Seattle': '-07:00',
  'Vancouver': '-07:00',
};

/** Convert UTC ISO to local ISO with venue offset. Keeps the same instant. */
function toLocalIso(utcIso, city) {
  const offset = VENUE_OFFSETS[city];
  if (!offset) return utcIso; // fallback: keep UTC
  const d = new Date(utcIso);
  const sign = offset.startsWith('-') ? -1 : 1;
  const [h, m] = offset.replace(/[+-]/, '').split(':').map(Number);
  const localMs = d.getTime() + sign * (h * 3600000 + m * 60000);
  const local = new Date(localMs);
  const pad = n => String(n).padStart(2, '0');
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}` +
         `T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:00${offset}`;
}

function formatDateLong(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/New_York' });
}
function formatDateShort(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York' }) +
    ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
}

// ── Main ───────────────────────────────────────────────────────────
let published = 0, noindex = 0, draft = 0;
const publishedSlugs = [];

for (const team of teams) {
  const model = assemblePageModel(team, fixtures, odds, teams);
  const faqs = generateFaqs(model);
  const html = generateHtml(model, teams, faqs);

  const dir = join(PUBLIC_DIR, 'teams', team.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), html);

  if (model.publishState === 'PUBLISHED') { published++; publishedSlugs.push(team.slug); }
  else if (model.publishState === 'NOINDEX') { noindex++; }
  else { draft++; }

  const status = model.publishState === 'PUBLISHED' ? '✓' : model.publishState === 'NOINDEX' ? '○' : '✗';
  const deltaStr = model.delta ? `Δ${(model.delta.delta * 100).toFixed(1)}%` : 'no PM';
  console.log(`  ${status} ${team.slug.padEnd(22)} Group ${team.group_letter} | ${model.publishState.padEnd(9)} | ${deltaStr}`);
}

updateSitemap(publishedSlugs);
const totalSitemap = readFileSync(join(PUBLIC_DIR, 'sitemap.xml'), 'utf8').split('<loc>').length - 1;

console.log(`\n─── Summary ───`);
console.log(`  Pages generated: ${teams.length}`);
console.log(`  PUBLISHED (index,follow): ${published}`);
console.log(`  NOINDEX (noindex,follow): ${noindex}`);
console.log(`  DRAFT (noindex,nofollow): ${draft}`);
console.log(`  Sitemap URLs: ${totalSitemap}`);
console.log(`  Output: ${join(PUBLIC_DIR, 'teams/')}`);
