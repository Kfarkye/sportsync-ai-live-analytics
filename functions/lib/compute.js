/**
 * Stats computation engine for team betting profiles.
 * Pure functions — no I/O. Takes raw game arrays, returns computed stats.
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

function getClosingTotal(odds) {
  if (!odds || typeof odds !== 'object') return null;
  for (const k of ['total', 'overUnder']) {
    if (k in odds) { const v = parseFloat(odds[k]); if (!isNaN(v)) return v; }
  }
  return null;
}

function getHomeSpread(odds) {
  if (!odds || typeof odds !== 'object') return null;
  for (const k of ['homeSpread', 'home_spread', 'spread']) {
    if (k in odds) { const v = parseFloat(odds[k]); if (!isNaN(v)) return v; }
  }
  return null;
}

function formatDate(iso) {
  const d = new Date(iso);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function shortTeam(fullName) {
  // "Los Angeles Lakers" → "LA Lakers", "Golden State Warriors" → "Golden State"
  const map = {
    'Los Angeles Clippers': 'LA Clippers',
    'Los Angeles Lakers': 'LA Lakers',
    'Golden State Warriors': 'Golden State',
    'Oklahoma City Thunder': 'OKC',
    'San Antonio Spurs': 'San Antonio',
    'New Orleans Pelicans': 'New Orleans',
    'New York Knicks': 'New York',
    'Portland Trail Blazers': 'Portland',
    'Minnesota Timberwolves': 'Minnesota',
  };
  if (map[fullName]) return map[fullName];
  // Default: just the mascot
  const parts = fullName.split(' ');
  return parts.length > 2 ? parts.slice(1).join(' ') : parts[parts.length - 1];
}

// ── Location Stats ───────────────────────────────────────────────────────────

function computeLocationStats(games, isHome) {
  let overs = 0, unders = 0, gamesWithLine = 0, vsCloseSum = 0;
  let covers = 0, nonCovers = 0, gamesWithSpread = 0;
  let ppgSum = 0, oppPpgSum = 0;

  for (const g of games) {
    const teamScore = isHome ? (g.home_score || 0) : (g.away_score || 0);
    const oppScore  = isHome ? (g.away_score || 0) : (g.home_score || 0);
    ppgSum    += teamScore;
    oppPpgSum += oppScore;

    const total = (g.home_score || 0) + (g.away_score || 0);
    const line  = getClosingTotal(g.closing_odds);
    if (line) {
      gamesWithLine++;
      const diff = total - line;
      vsCloseSum += diff;
      if (diff > 0) overs++; else unders++;
    }

    const spread = getHomeSpread(g.closing_odds);
    if (spread !== null) {
      gamesWithSpread++;
      const margin = (g.home_score || 0) - (g.away_score || 0);
      const coverMargin = isHome ? margin + spread : -(margin + spread);
      if (coverMargin > 0) covers++; else nonCovers++;
    }
  }

  const n = games.length || 1;
  return {
    games: games.length,
    gamesWithLine,
    overs, unders,
    overPct:    gamesWithLine   ? +(overs / gamesWithLine * 100).toFixed(1)     : 0,
    avgVsClose: gamesWithLine   ? +(vsCloseSum / gamesWithLine).toFixed(1)      : 0,
    covers, nonCovers, gamesWithSpread,
    coverPct:   gamesWithSpread ? +(covers / gamesWithSpread * 100).toFixed(1)  : 0,
    ppg:      +(ppgSum / n).toFixed(1),
    oppPpg:   +(oppPpgSum / n).toFixed(1),
    avgTotal: +((ppgSum + oppPpgSum) / n).toFixed(1),
  };
}

// ── Main Computation ─────────────────────────────────────────────────────────

export function computeTeamStats(teamName, completedGames, upcomingGames) {
  const homeGames = completedGames.filter(g => g.home_team === teamName);
  const awayGames = completedGames.filter(g => g.away_team === teamName);
  const allTeamGames = completedGames
    .filter(g => g.home_team === teamName || g.away_team === teamName)
    .sort((a, b) => new Date(a.start_time) - new Date(b.start_time));

  if (allTeamGames.length === 0) return null;

  // ── Rest map ───────────────────────────────────────────────────────────────
  const restMap = new Map();
  for (let i = 0; i < allTeamGames.length; i++) {
    if (i === 0) { restMap.set(allTeamGames[i].id, 99); continue; }
    const days = Math.round(
      (new Date(allTeamGames[i].start_time) - new Date(allTeamGames[i - 1].start_time)) / 86400000
    );
    restMap.set(allTeamGames[i].id, days);
  }

  // ── Core splits ────────────────────────────────────────────────────────────
  const home = computeLocationStats(homeGames, true);
  const away = computeLocationStats(awayGames, false);

  // ── Close-game over % (home, margin ≤ 10) ─────────────────────────────────
  const closeHome = homeGames.filter(g => Math.abs((g.home_score || 0) - (g.away_score || 0)) <= 10);
  let closeOvers = 0, closeWithLine = 0;
  for (const g of closeHome) {
    const line = getClosingTotal(g.closing_odds);
    if (line) { closeWithLine++; if ((g.home_score || 0) + (g.away_score || 0) > line) closeOvers++; }
  }
  home.closeGameOverPct = closeWithLine ? +(closeOvers / closeWithLine * 100).toFixed(1) : 0;
  home.closeGameSample  = closeWithLine;

  // ── Blowout rate (home, margin ≥ 15) ───────────────────────────────────────
  const blowouts = homeGames.filter(g => Math.abs((g.home_score || 0) - (g.away_score || 0)) >= 15);
  home.blowoutRate = homeGames.length ? +(blowouts.length / homeGames.length * 100).toFixed(1) : 0;

  // ── Rest splits (home) ─────────────────────────────────────────────────────
  const buckets = { 'Back-to-back': [], '1 day rest': [], '2 days rest': [], '3+ days rest': [] };
  for (const g of homeGames) {
    const d = restMap.get(g.id) || 99;
    if (d <= 1)      buckets['Back-to-back'].push(g);
    else if (d === 2) buckets['1 day rest'].push(g);
    else if (d === 3) buckets['2 days rest'].push(g);
    else              buckets['3+ days rest'].push(g);
  }
  const restSplits = Object.entries(buckets)
    .map(([label, gs]) => ({ label, ...computeLocationStats(gs, true) }))
    .filter(s => s.games > 0);

  // ── Biggest overs (home) ───────────────────────────────────────────────────
  const biggestOvers = [];
  for (const g of homeGames) {
    const line = getClosingTotal(g.closing_odds);
    if (!line) continue;
    const total = (g.home_score || 0) + (g.away_score || 0);
    const diff = total - line;
    if (diff > 0) {
      biggestOvers.push({
        date: formatDate(g.start_time), opponent: shortTeam(g.away_team),
        homeScore: g.home_score, awayScore: g.away_score, total, line, diff,
      });
    }
  }
  biggestOvers.sort((a, b) => b.diff - a.diff);

  // ── Recent game log (last 15) ─────────────────────────────────────────────
  const recentGames = allTeamGames.slice(-15).reverse().map(g => {
    const isHome = g.home_team === teamName;
    const total  = (g.home_score || 0) + (g.away_score || 0);
    const line   = getClosingTotal(g.closing_odds);
    const diff   = line ? total - line : null;
    return {
      date: formatDate(g.start_time),
      opponent: shortTeam(isHome ? g.away_team : g.home_team),
      isHome,
      homeScore: g.home_score, awayScore: g.away_score, total, line, diff,
      result: line ? (diff > 0 ? 'OVER' : diff < 0 ? 'UNDER' : 'PUSH') : null,
    };
  });

  // ── Line movements (home, with open+close) ────────────────────────────────
  const lineMovements = [];
  for (const g of homeGames) {
    const open  = getClosingTotal(g.opening_odds);
    const close = getClosingTotal(g.closing_odds);
    if (!open || !close) continue;
    const total = (g.home_score || 0) + (g.away_score || 0);
    lineMovements.push({
      date: formatDate(g.start_time), opponent: shortTeam(g.away_team),
      open, close, move: +(close - open).toFixed(1),
      actual: total, vsClose: +(total - close).toFixed(1),
      result: total > close ? 'OVER' : 'UNDER',
    });
  }
  lineMovements.sort((a, b) => b.vsClose - a.vsClose);

  // ── Upcoming games ─────────────────────────────────────────────────────────
  const upcoming = (upcomingGames || [])
    .filter(g => g.home_team === teamName || g.away_team === teamName)
    .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
    .slice(0, 6)
    .map(g => {
      const isHome = g.home_team === teamName;
      return {
        date: formatDate(g.start_time),
        rawDate: g.start_time,
        opponent: shortTeam(isHome ? g.away_team : g.home_team),
        opponentFull: isHome ? g.away_team : g.home_team,
        isHome,
      };
    });

  // Compute rest for upcoming games relative to last completed game
  if (upcoming.length > 0 && allTeamGames.length > 0) {
    let prevDate = new Date(allTeamGames[allTeamGames.length - 1].start_time);
    for (const u of upcoming) {
      const d = Math.round((new Date(u.rawDate) - prevDate) / 86400000);
      u.restDays = d;
      u.restLabel = d <= 1 ? 'B2B' : `${d - 1} days`;
      prevDate = new Date(u.rawDate);
    }
  }

  // ── Strongest plays (auto-detected) ────────────────────────────────────────
  const strongestPlays = [];

  if (home.overPct >= 55 && home.gamesWithLine >= 10) {
    strongestPlays.push({
      desc: 'Over at home', pct: home.overPct,
      sample: `${home.games} games`, detail: `${home.avgVsClose >= 0 ? '+' : ''}${home.avgVsClose} vs close`,
    });
  }

  if (away.overPct >= 55 && away.gamesWithLine >= 10) {
    strongestPlays.push({
      desc: 'Over on the road', pct: away.overPct,
      sample: `${away.games} games`, detail: `${away.avgVsClose >= 0 ? '+' : ''}${away.avgVsClose} vs close`,
    });
  }

  if (home.closeGameOverPct >= 60 && closeWithLine >= 5) {
    strongestPlays.push({
      desc: 'Over in close home games', pct: home.closeGameOverPct,
      sample: `${closeWithLine} games`, detail: 'margin ≤10',
    });
  }

  const bestRest = restSplits.filter(s => s.gamesWithLine >= 3).sort((a, b) => b.overPct - a.overPct)[0];
  if (bestRest && bestRest.overPct >= 60) {
    strongestPlays.push({
      desc: `Over at home, ${bestRest.label.toLowerCase()}`, pct: bestRest.overPct,
      sample: `${bestRest.games} games`, detail: `${bestRest.avgVsClose >= 0 ? '+' : ''}${bestRest.avgVsClose} vs close`,
    });
  }

  const bestCover = restSplits.filter(s => s.gamesWithSpread >= 3).sort((a, b) => b.coverPct - a.coverPct)[0];
  if (bestCover && bestCover.coverPct >= 60) {
    strongestPlays.push({
      desc: `Home cover on ${bestCover.label.toLowerCase()}`, pct: bestCover.coverPct,
      sample: `${bestCover.games} games`, detail: '',
    });
  }

  if (home.coverPct >= 55 && home.gamesWithSpread >= 10) {
    strongestPlays.push({
      desc: 'Home cover (all rest)', pct: home.coverPct,
      sample: `${home.gamesWithSpread} games`, detail: '',
    });
  }

  if (away.coverPct >= 55 && away.gamesWithSpread >= 10) {
    strongestPlays.push({
      desc: 'Road cover (all rest)', pct: away.coverPct,
      sample: `${away.gamesWithSpread} games`, detail: '',
    });
  }

  // Dedupe and sort
  const seen = new Set();
  const uniquePlays = strongestPlays.filter(p => {
    const key = `${p.desc}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  uniquePlays.sort((a, b) => b.pct - a.pct);

  // ── Determine headline signal ─────────────────────────────────────────────
  let headlineType, headlinePct, headlineAvgVs, headlineExtra;
  if (home.overPct >= 55 && home.overPct > home.coverPct) {
    headlineType = 'over';
    headlinePct  = home.overPct;
    headlineAvgVs = home.avgVsClose;
    headlineExtra = home.closeGameOverPct >= 60
      ? `In close games, the rate climbs to <strong>${home.closeGameOverPct}%</strong>.`
      : '';
  } else if (home.coverPct >= 55) {
    headlineType = 'cover';
    headlinePct  = home.coverPct;
    headlineAvgVs = 0;
    headlineExtra = '';
  } else if (away.overPct >= 55) {
    headlineType = 'away-over';
    headlinePct  = away.overPct;
    headlineAvgVs = away.avgVsClose;
    headlineExtra = '';
  } else {
    headlineType = 'neutral';
    headlinePct  = Math.max(home.overPct, away.overPct);
    headlineAvgVs = home.avgVsClose;
    headlineExtra = '';
  }

  const today = new Date().toISOString().slice(0, 10);

  return {
    teamName,
    totalGames: allTeamGames.length,
    throughDate: allTeamGames[allTeamGames.length - 1].start_time.slice(0, 10),
    generatedDate: today,
    home,
    away,
    restSplits,
    biggestOvers: biggestOvers.slice(0, 5),
    recentGames,
    lineMovements: lineMovements.slice(0, 8),
    upcomingGames: upcoming,
    strongestPlays: uniquePlays.slice(0, 3),
    headline: { type: headlineType, pct: headlinePct, avgVs: headlineAvgVs, extra: headlineExtra },
  };
}
