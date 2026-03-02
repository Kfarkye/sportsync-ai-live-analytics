import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchLeagueIds, fetchLeagueMatches, fetchTeamsInLeague, getSpreadResult, getTotalResult, type SoccerPostgame } from '../lib/postgame';
import { LEAGUE_LABELS, formatMatchDate, matchUrl, teamUrl } from '../lib/slugs';

type LeagueOption = { id: string; label: string };

type ViewMode = 'results' | 'standings';
type ResultFilter = 'all' | 'home' | 'away' | 'draw' | 'over' | 'under' | 'upset';
type DateWindow = 'all' | '30d' | '14d' | '7d';
type ResultsSort = 'latest' | 'goals' | 'upset';
type StandingsSort = 'cover' | 'atsRoi' | 'points' | 'goalDiff';

type TeamStanding = {
  name: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  atsCovered: number;
  atsFailed: number;
  atsPush: number;
  atsBets: number;
  atsUnits: number;
  atsRoiPct: number;
  coverPct: number;
  over: number;
  under: number;
  ouPush: number;
  bttsHits: number;
  bttsPct: number;
  avgGoals: number;
};

const pct = (num: number, den: number): number => (den > 0 ? (num / den) * 100 : 0);
const avg = (num: number, den: number): number => (den > 0 ? num / den : 0);
const safeN = (n: number | null | undefined): number => (Number.isFinite(n as number) ? Number(n) : 0);

function americanProfit(odds: number | null | undefined): number {
  if (odds == null || !Number.isFinite(odds)) return 0;
  if (odds > 0) return odds / 100;
  if (odds < 0) return 100 / Math.abs(odds);
  return 0;
}

function settleUnits(odds: number | null | undefined, outcome: 'win' | 'loss' | 'push'): number {
  if (outcome === 'push') return 0;
  if (!Number.isFinite(odds as number)) return 0;
  return outcome === 'win' ? americanProfit(odds) : -1;
}

function dateInWindow(value: string, window: DateWindow): boolean {
  if (window === 'all') return true;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return false;
  const now = Date.now();
  const days = window === '30d' ? 30 : window === '14d' ? 14 : 7;
  return parsed >= now - days * 24 * 60 * 60 * 1000;
}

function isUpset(match: SoccerPostgame): boolean {
  if (match.dk_home_ml == null || match.dk_away_ml == null) return false;
  if (match.home_score === match.away_score) return false;

  const homeFav = match.dk_home_ml < match.dk_away_ml;
  const awayWon = match.away_score > match.home_score;
  const homeWon = match.home_score > match.away_score;
  return (homeFav && awayWon) || (!homeFav && homeWon);
}

function upsetLine(match: SoccerPostgame): number {
  if (match.dk_home_ml == null || match.dk_away_ml == null) return 0;
  const homeFav = match.dk_home_ml < match.dk_away_ml;
  return homeFav ? safeN(match.dk_away_ml) : safeN(match.dk_home_ml);
}

function computeStandings(matches: SoccerPostgame[], teamNames: string[]): TeamStanding[] {
  const map = new Map<string, TeamStanding>();

  const ensureTeam = (name: string): TeamStanding => {
    const existing = map.get(name);
    if (existing) return existing;
    const next: TeamStanding = {
      name,
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      points: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDiff: 0,
      atsCovered: 0,
      atsFailed: 0,
      atsPush: 0,
      atsBets: 0,
      atsUnits: 0,
      atsRoiPct: 0,
      coverPct: 0,
      over: 0,
      under: 0,
      ouPush: 0,
      bttsHits: 0,
      bttsPct: 0,
      avgGoals: 0,
    };
    map.set(name, next);
    return next;
  };

  for (const name of teamNames) ensureTeam(name);

  for (const match of matches) {
    const home = ensureTeam(match.home_team);
    const away = ensureTeam(match.away_team);

    home.played += 1;
    away.played += 1;

    home.goalsFor += match.home_score;
    home.goalsAgainst += match.away_score;
    away.goalsFor += match.away_score;
    away.goalsAgainst += match.home_score;

    if (match.home_score > match.away_score) {
      home.wins += 1;
      home.points += 3;
      away.losses += 1;
    } else if (match.away_score > match.home_score) {
      away.wins += 1;
      away.points += 3;
      home.losses += 1;
    } else {
      home.draws += 1;
      away.draws += 1;
      home.points += 1;
      away.points += 1;
    }

    const btts = match.home_score > 0 && match.away_score > 0;
    if (btts) {
      home.bttsHits += 1;
      away.bttsHits += 1;
    }

    const spread = getSpreadResult(match);
    if (spread) {
      const homeOutcome: 'win' | 'loss' | 'push' =
        spread.result === 'covered' ? 'win' : spread.result === 'failed' ? 'loss' : 'push';
      const awayOutcome: 'win' | 'loss' | 'push' =
        spread.result === 'covered' ? 'loss' : spread.result === 'failed' ? 'win' : 'push';

      if (homeOutcome === 'win') home.atsCovered += 1;
      else if (homeOutcome === 'loss') home.atsFailed += 1;
      else home.atsPush += 1;

      if (awayOutcome === 'win') away.atsCovered += 1;
      else if (awayOutcome === 'loss') away.atsFailed += 1;
      else away.atsPush += 1;

      if (homeOutcome !== 'push') home.atsBets += 1;
      if (awayOutcome !== 'push') away.atsBets += 1;

      home.atsUnits += settleUnits(match.dk_home_spread_price, homeOutcome);
      away.atsUnits += settleUnits(match.dk_away_spread_price, awayOutcome);
    }

    const total = getTotalResult(match);
    if (total) {
      if (total.result === 'over') {
        home.over += 1;
        away.over += 1;
      } else if (total.result === 'under') {
        home.under += 1;
        away.under += 1;
      } else {
        home.ouPush += 1;
        away.ouPush += 1;
      }
    }
  }

  return [...map.values()].map((team) => {
    const goalDiff = team.goalsFor - team.goalsAgainst;
    const coverPct = pct(team.atsCovered, team.atsCovered + team.atsFailed);
    const atsRoiPct = pct(team.atsUnits, team.atsBets);
    const bttsPct = pct(team.bttsHits, team.played);
    const avgGoals = avg(team.goalsFor + team.goalsAgainst, team.played);

    return {
      ...team,
      goalDiff,
      coverPct,
      atsRoiPct,
      bttsPct,
      avgGoals,
    };
  });
}

export default function ReportsPage() {
  const [leagueOptions, setLeagueOptions] = useState<LeagueOption[]>([]);
  const [leagueId, setLeagueId] = useState<string>('');
  const [view, setView] = useState<ViewMode>('results');
  const [matches, setMatches] = useState<SoccerPostgame[]>([]);
  const [teamRows, setTeamRows] = useState<TeamStanding[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [search, setSearch] = useState<string>('');
  const [resultFilter, setResultFilter] = useState<ResultFilter>('all');
  const [dateWindow, setDateWindow] = useState<DateWindow>('all');
  const [onlyWithLines, setOnlyWithLines] = useState<boolean>(false);
  const [resultsSort, setResultsSort] = useState<ResultsSort>('latest');
  const [standingsSort, setStandingsSort] = useState<StandingsSort>('cover');
  const [minGames, setMinGames] = useState<number>(5);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState<boolean>(false);
  const [showMoreMetrics, setShowMoreMetrics] = useState<boolean>(false);

  useEffect(() => {
    let active = true;

    const loadLeagues = async () => {
      const ids = await fetchLeagueIds();
      if (!active) return;

      const options = ids.map((id) => ({
        id,
        label: LEAGUE_LABELS[id] || id.toUpperCase(),
      }));

      setLeagueOptions(options);
      if (!leagueId && options.length > 0) setLeagueId(options[0].id);
    };

    void loadLeagues();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!leagueId) return;

    let active = true;

    const load = async () => {
      setLoading(true);
      try {
        const [leagueMatches, teams] = await Promise.all([
          fetchLeagueMatches(leagueId),
          fetchTeamsInLeague(leagueId),
        ]);

        if (!active) return;

        setMatches(leagueMatches);
        setTeamRows(computeStandings(leagueMatches, teams));
        document.title = `${LEAGUE_LABELS[leagueId] ?? leagueId} Reports | The Drip`;
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, [leagueId]);

  const filteredMatches = useMemo(() => {
    const needle = search.trim().toLowerCase();

    const base = matches.filter((match) => {
      if (!dateInWindow(match.start_time, dateWindow)) return false;
      if (onlyWithLines && (match.dk_home_ml == null || match.dk_total == null || match.dk_spread == null)) return false;

      if (needle) {
        const combined = `${match.home_team} ${match.away_team}`.toLowerCase();
        if (!combined.includes(needle)) return false;
      }

      if (resultFilter === 'home') return match.home_score > match.away_score;
      if (resultFilter === 'away') return match.away_score > match.home_score;
      if (resultFilter === 'draw') return match.home_score === match.away_score;
      if (resultFilter === 'upset') return isUpset(match);

      if (resultFilter === 'over' || resultFilter === 'under') {
        const total = getTotalResult(match);
        return total ? total.result === resultFilter : false;
      }

      return true;
    });

    if (resultsSort === 'goals') {
      return base.slice().sort((a, b) => (b.home_score + b.away_score) - (a.home_score + a.away_score));
    }

    if (resultsSort === 'upset') {
      return base.slice().sort((a, b) => upsetLine(b) - upsetLine(a));
    }

    return base.slice().sort((a, b) => Date.parse(b.start_time) - Date.parse(a.start_time));
  }, [matches, search, dateWindow, onlyWithLines, resultFilter, resultsSort]);

  const summary = useMemo(() => {
    if (filteredMatches.length === 0) return null;

    let totalGoals = 0;
    let homeWins = 0;
    let awayWins = 0;
    let draws = 0;

    let homeCovered = 0;
    let atsBets = 0;
    let homeSpreadUnits = 0;

    let overs = 0;
    let unders = 0;
    let totalBets = 0;
    let overUnits = 0;

    let favoriteWins = 0;
    let dogWins = 0;
    let moneylineDecisions = 0;

    let bttsHits = 0;
    let closeGames = 0;

    let cornersTotal = 0;
    let cardsTotal = 0;
    let passPctTotal = 0;
    let shotAccTotal = 0;
    let qualityRows = 0;

    for (const match of filteredMatches) {
      const goals = match.home_score + match.away_score;
      totalGoals += goals;

      if (match.home_score > match.away_score) homeWins += 1;
      else if (match.away_score > match.home_score) awayWins += 1;
      else draws += 1;

      if (Math.abs(match.home_score - match.away_score) <= 1) closeGames += 1;
      if (match.home_score > 0 && match.away_score > 0) bttsHits += 1;

      const spread = getSpreadResult(match);
      if (spread) {
        if (spread.result === 'covered') homeCovered += 1;
        if (spread.result !== 'push') atsBets += 1;

        const homeOutcome: 'win' | 'loss' | 'push' =
          spread.result === 'covered' ? 'win' : spread.result === 'failed' ? 'loss' : 'push';
        homeSpreadUnits += settleUnits(match.dk_home_spread_price, homeOutcome);
      }

      const total = getTotalResult(match);
      if (total) {
        if (total.result === 'over') overs += 1;
        if (total.result === 'under') unders += 1;
        if (total.result !== 'push') totalBets += 1;

        const overOutcome: 'win' | 'loss' | 'push' =
          total.result === 'over' ? 'win' : total.result === 'under' ? 'loss' : 'push';
        overUnits += settleUnits(match.dk_over_price, overOutcome);
      }

      if (match.dk_home_ml != null && match.dk_away_ml != null && match.home_score !== match.away_score) {
        moneylineDecisions += 1;
        const homeFav = match.dk_home_ml < match.dk_away_ml;
        const homeWon = match.home_score > match.away_score;

        if ((homeFav && homeWon) || (!homeFav && !homeWon)) favoriteWins += 1;
        else dogWins += 1;
      }

      const corners = safeN(match.home_corners) + safeN(match.away_corners);
      const cards =
        safeN(match.home_yellow_cards) +
        safeN(match.away_yellow_cards) +
        safeN(match.home_red_cards) +
        safeN(match.away_red_cards);
      const passPct = avg(safeN(match.home_pass_pct) + safeN(match.away_pass_pct), 2) * 100;
      const shotAcc = avg(safeN(match.home_shot_accuracy) + safeN(match.away_shot_accuracy), 2) * 100;

      cornersTotal += corners;
      cardsTotal += cards;
      passPctTotal += passPct;
      shotAccTotal += shotAcc;
      qualityRows += 1;
    }

    return {
      sample: filteredMatches.length,
      atsBets,
      totalBets,
      moneylineDecisions,
      avgGoals: avg(totalGoals, filteredMatches.length),
      homeWinPct: pct(homeWins, filteredMatches.length),
      drawPct: pct(draws, filteredMatches.length),
      awayWinPct: pct(awayWins, filteredMatches.length),
      homeCoverPct: pct(homeCovered, atsBets),
      overPct: pct(overs, totalBets),
      favoriteWinPct: pct(favoriteWins, moneylineDecisions),
      dogWinPct: pct(dogWins, moneylineDecisions),
      bttsPct: pct(bttsHits, filteredMatches.length),
      closeGamePct: pct(closeGames, filteredMatches.length),
      homeSpreadRoiPct: pct(homeSpreadUnits, atsBets),
      overRoiPct: pct(overUnits, totalBets),
      avgCorners: avg(cornersTotal, qualityRows),
      avgCards: avg(cardsTotal, qualityRows),
      avgPassPct: avg(passPctTotal, qualityRows),
      avgShotAcc: avg(shotAccTotal, qualityRows),
    };
  }, [filteredMatches]);

  const filteredStandings = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const cutoffMatches = dateWindow === 'all' ? 0 : dateWindow === '30d' ? 30 : dateWindow === '14d' ? 14 : 7;

    let rows = teamRows.filter((team) => {
      if (team.played < minGames) return false;
      if (needle && !team.name.toLowerCase().includes(needle)) return false;
      if (cutoffMatches > 0 && team.played < Math.max(2, Math.floor(cutoffMatches / 2))) return false;
      return true;
    });

    if (standingsSort === 'points') rows = rows.sort((a, b) => b.points - a.points || b.goalDiff - a.goalDiff);
    else if (standingsSort === 'goalDiff') rows = rows.sort((a, b) => b.goalDiff - a.goalDiff || b.points - a.points);
    else if (standingsSort === 'atsRoi') rows = rows.sort((a, b) => b.atsRoiPct - a.atsRoiPct || b.coverPct - a.coverPct);
    else rows = rows.sort((a, b) => b.coverPct - a.coverPct || b.atsRoiPct - a.atsRoiPct);

    return rows;
  }, [teamRows, search, minGames, standingsSort, dateWindow]);

  const selectedLeague = leagueOptions.find((league) => league.id === leagueId);
  const leagueLabel = selectedLeague?.label || LEAGUE_LABELS[leagueId] || leagueId.toUpperCase();
  const primaryMetrics = summary
    ? [
      { label: 'Sample (n)', value: String(summary.sample), context: 'Matches' },
      { label: 'Home Cover %', value: `${summary.homeCoverPct.toFixed(1)}%`, context: `ATS n=${summary.atsBets}` },
      { label: 'Over %', value: `${summary.overPct.toFixed(1)}%`, context: `Totals n=${summary.totalBets}` },
      { label: 'Favorites Win %', value: `${summary.favoriteWinPct.toFixed(1)}%`, context: `ML n=${summary.moneylineDecisions}` },
    ]
    : [];

  const moreMetrics = summary
    ? [
      { label: 'Avg Goals', value: summary.avgGoals.toFixed(2), valueClass: 'text-slate-900' },
      { label: 'BTTS %', value: `${summary.bttsPct.toFixed(1)}%`, valueClass: 'text-slate-900' },
      { label: 'Underdog Win %', value: `${summary.dogWinPct.toFixed(1)}%`, valueClass: 'text-slate-900' },
      { label: 'Home ATS ROI', value: `${summary.homeSpreadRoiPct.toFixed(1)}%`, valueClass: summary.homeSpreadRoiPct >= 0 ? 'text-emerald-600' : 'text-rose-600' },
      { label: 'Over ROI', value: `${summary.overRoiPct.toFixed(1)}%`, valueClass: summary.overRoiPct >= 0 ? 'text-emerald-600' : 'text-rose-600' },
      { label: 'Close Games', value: `${summary.closeGamePct.toFixed(1)}%`, valueClass: 'text-slate-900' },
      { label: 'Avg Corners', value: summary.avgCorners.toFixed(1), valueClass: 'text-slate-900' },
      { label: 'Avg Cards', value: summary.avgCards.toFixed(1), valueClass: 'text-slate-900' },
      { label: 'Avg Pass %', value: `${summary.avgPassPct.toFixed(1)}%`, valueClass: 'text-slate-900' },
      { label: 'Avg Shot Accuracy', value: `${summary.avgShotAcc.toFixed(1)}%`, valueClass: 'text-slate-900' },
      { label: 'W-D-L Split', value: `${summary.homeWinPct.toFixed(1)} / ${summary.drawPct.toFixed(1)} / ${summary.awayWinPct.toFixed(1)}`, valueClass: 'text-slate-900' },
    ]
    : [];

  return (
    <div className="h-[var(--vvh,100vh)] overflow-y-auto overscroll-y-contain bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto w-full max-w-7xl px-4 md:px-6 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Link to="/" className="rounded-md border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 hover:text-slate-900 hover:bg-slate-50">
                Home
              </Link>
              <Link to="/trends" className="rounded-md border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 hover:text-slate-900 hover:bg-slate-50">
                Trends
              </Link>
            </div>
            <div className="text-[11px] font-medium text-slate-500">{filteredMatches.length} matches in view</div>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 md:px-6 py-8 space-y-6">
        <section className="space-y-2">
          <h1 className="text-4xl font-semibold tracking-tight text-slate-900">{leagueLabel}</h1>
          <p className="text-sm text-slate-600">Season results, standings, and advanced betting performance from `soccer_postgame`.</p>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 md:p-5 space-y-4">
          <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Basic Filters</div>
              <div className="flex flex-wrap gap-2">
                {leagueOptions.map((league) => (
                  <button
                    key={league.id}
                    type="button"
                    onClick={() => setLeagueId(league.id)}
                    className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
                      leagueId === league.id
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900'
                    }`}
                  >
                    {league.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1">
              <button
                type="button"
                onClick={() => setView('results')}
                className={`rounded-lg px-4 py-2 text-xs font-semibold ${view === 'results' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
              >
                Results
              </button>
              <button
                type="button"
                onClick={() => setView('standings')}
                className={`rounded-lg px-4 py-2 text-xs font-semibold ${view === 'standings' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
              >
                Standings + ATS
              </button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Team Filter</label>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search team"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
              />
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Date Window</label>
              <select
                value={dateWindow}
                onChange={(event) => setDateWindow(event.target.value as DateWindow)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
              >
                <option value="all">All</option>
                <option value="30d">Last 30 days</option>
                <option value="14d">Last 14 days</option>
                <option value="7d">Last 7 days</option>
              </select>
            </div>

            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setDateWindow('all');
                  setResultFilter('all');
                  setOnlyWithLines(false);
                  setResultsSort('latest');
                  setStandingsSort('cover');
                  setMinGames(5);
                }}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={() => setShowAdvancedFilters((prev) => !prev)}
                className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                {showAdvancedFilters ? 'Hide Advanced' : 'Advanced Filters'}
              </button>
            </div>
          </div>

          <div className={`overflow-hidden transition-[max-height,opacity] duration-200 ${showAdvancedFilters ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'}`}>
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 md:p-4">
              <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Advanced Filters</div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {view === 'results' ? (
                  <>
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Result Type</label>
                      <select
                        value={resultFilter}
                        onChange={(event) => setResultFilter(event.target.value as ResultFilter)}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                      >
                        <option value="all">All</option>
                        <option value="home">Home wins</option>
                        <option value="away">Away wins</option>
                        <option value="draw">Draws</option>
                        <option value="over">Overs</option>
                        <option value="under">Unders</option>
                        <option value="upset">Upsets</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Sort</label>
                      <select
                        value={resultsSort}
                        onChange={(event) => setResultsSort(event.target.value as ResultsSort)}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                      >
                        <option value="latest">Latest</option>
                        <option value="goals">Highest scoring</option>
                        <option value="upset">Biggest upset line</option>
                      </select>
                    </div>

                    <label className="inline-flex h-[42px] items-center gap-2 self-end rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={onlyWithLines}
                        onChange={(event) => setOnlyWithLines(event.target.checked)}
                        className="accent-slate-900"
                      />
                      Lines only
                    </label>

                    <div className="self-end text-xs text-slate-500">Filtered matches: {filteredMatches.length}</div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Standings Sort</label>
                      <select
                        value={standingsSort}
                        onChange={(event) => setStandingsSort(event.target.value as StandingsSort)}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                      >
                        <option value="cover">Cover %</option>
                        <option value="atsRoi">ATS ROI %</option>
                        <option value="points">Points</option>
                        <option value="goalDiff">Goal Diff</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Min Games</label>
                      <input
                        type="number"
                        min={1}
                        max={40}
                        value={minGames}
                        onChange={(event) => setMinGames(Math.max(1, Math.min(40, Number(event.target.value) || 1)))}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                      />
                    </div>

                    <div className="self-end text-xs text-slate-500">Filtered rows: {filteredStandings.length}</div>
                  </>
                )}
              </div>
            </div>
          </div>
        </section>

        {summary && (
          <section className="space-y-2">
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {primaryMetrics.map((metric) => (
                <article key={metric.label} className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{metric.label}</div>
                  <div className="mt-1 text-[1.55rem] leading-none font-semibold tabular-nums text-slate-900">{metric.value}</div>
                  <div className="mt-1 text-[11px] text-slate-500">{metric.context}</div>
                </article>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setShowMoreMetrics((prev) => !prev)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-600 hover:bg-slate-50"
            >
              {showMoreMetrics ? 'Hide More Metrics' : 'More Metrics'}
            </button>

            {showMoreMetrics && (
              <div className="flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-white px-3 py-3">
                {moreMetrics.map((metric) => (
                  <div key={metric.label} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{metric.label}</span>
                    <span className={`text-sm font-semibold tabular-nums ${metric.valueClass}`}>{metric.value}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {loading ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Loading report data...</section>
        ) : view === 'results' ? (
          <section className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            {filteredMatches.map((match) => {
              const spread = getSpreadResult(match);
              const total = getTotalResult(match);
              const homeWinner = match.home_score > match.away_score;
              const awayWinner = match.away_score > match.home_score;

              return (
                <Link
                  key={match.id}
                  to={matchUrl(match.home_team, match.away_team, match.start_time)}
                  className="rounded-2xl border border-slate-200 bg-white p-4 transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-sm"
                >
                  <div className="flex items-center justify-between text-[11px] font-medium text-slate-500">
                    <span>{formatMatchDate(match.start_time)}</span>
                    <span>{LEAGUE_LABELS[match.league_id] || match.league_id}</span>
                  </div>

                  <div className="mt-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className={`text-base font-semibold ${homeWinner ? 'text-slate-900' : 'text-slate-600'}`}>{match.home_team}</span>
                      <span className={`text-2xl font-semibold tabular-nums ${homeWinner ? 'text-slate-900' : 'text-slate-500'}`}>{match.home_score}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={`text-base font-semibold ${awayWinner ? 'text-slate-900' : 'text-slate-600'}`}>{match.away_team}</span>
                      <span className={`text-2xl font-semibold tabular-nums ${awayWinner ? 'text-slate-900' : 'text-slate-500'}`}>{match.away_score}</span>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2 text-[11px] text-slate-500">
                    <div>SPR {match.dk_spread != null ? (match.dk_spread > 0 ? `+${match.dk_spread}` : `${match.dk_spread}`) : '—'}</div>
                    <div className="text-right">O/U {match.dk_total ?? '—'}</div>
                    <div>Corners {safeN(match.home_corners) + safeN(match.away_corners)}</div>
                    <div className="text-right">Cards {safeN(match.home_yellow_cards) + safeN(match.away_yellow_cards) + safeN(match.home_red_cards) + safeN(match.away_red_cards)}</div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-slate-100 pt-3 text-[11px]">
                    {spread && (
                      <span className="text-slate-500">
                        ATS{' '}
                        <span className={spread.result === 'covered' ? 'font-semibold text-emerald-600' : spread.result === 'failed' ? 'font-semibold text-rose-600' : 'font-semibold text-slate-500'}>
                          {spread.result === 'covered' ? 'Home' : spread.result === 'failed' ? 'Away' : 'Push'}
                        </span>
                      </span>
                    )}
                    {total && (
                      <span className="text-slate-500">
                        Total <span className="font-semibold text-slate-700">{total.result.toUpperCase()}</span>
                      </span>
                    )}
                    {isUpset(match) && <span className="font-semibold text-rose-600">Upset {upsetLine(match) > 0 ? `(+${upsetLine(match)})` : upsetLine(match)}</span>}
                  </div>
                </Link>
              );
            })}

            {filteredMatches.length === 0 && (
              <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-500">No matches found for current filters.</div>
            )}
          </section>
        ) : (
          <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-[980px] w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
                    <th className="sticky top-[53px] z-20 bg-slate-50/95 backdrop-blur px-4 py-3 text-left">Team</th>
                    <th className="sticky top-[53px] z-20 bg-slate-50/95 backdrop-blur px-3 py-3 text-right">W-D-L</th>
                    <th className="sticky top-[53px] z-20 bg-slate-50/95 backdrop-blur px-3 py-3 text-right">Pts</th>
                    <th className="sticky top-[53px] z-20 bg-slate-50/95 backdrop-blur px-3 py-3 text-right">GD</th>
                    <th className="sticky top-[53px] z-20 bg-slate-50/95 backdrop-blur px-3 py-3 text-right">ATS</th>
                    <th className="sticky top-[53px] z-20 bg-slate-50/95 backdrop-blur px-3 py-3 text-right">
                      <span>Cover %</span>
                      <span className="mt-0.5 block text-[10px] font-medium normal-case tracking-normal text-slate-400">ATS n</span>
                    </th>
                    <th className="sticky top-[53px] z-20 bg-slate-50/95 backdrop-blur px-3 py-3 text-right">
                      <span>ATS ROI %</span>
                      <span className="mt-0.5 block text-[10px] font-medium normal-case tracking-normal text-slate-400">ATS n</span>
                    </th>
                    <th className="sticky top-[53px] z-20 bg-slate-50/95 backdrop-blur px-3 py-3 text-right">O/U</th>
                    <th className="sticky top-[53px] z-20 bg-slate-50/95 backdrop-blur px-3 py-3 text-right">
                      <span>BTTS %</span>
                      <span className="mt-0.5 block text-[10px] font-medium normal-case tracking-normal text-slate-400">Games n</span>
                    </th>
                    <th className="sticky top-[53px] z-20 bg-slate-50/95 backdrop-blur px-3 py-3 text-right">Avg Goals</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStandings.map((row, idx) => (
                    <tr key={row.name} className="border-t border-slate-100 hover:bg-slate-50/60">
                      <td className="px-4 py-3">
                        <Link to={teamUrl(row.name)} className="font-semibold text-slate-900 hover:underline">
                          {idx + 1}. {row.name}
                        </Link>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-slate-600">{row.wins}-{row.draws}-{row.losses}</td>
                      <td className="px-3 py-3 text-right tabular-nums font-semibold text-slate-900">{row.points}</td>
                      <td className="px-3 py-3 text-right tabular-nums font-semibold text-slate-700">{row.goalDiff >= 0 ? `+${row.goalDiff}` : row.goalDiff}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-slate-600">{row.atsCovered}-{row.atsFailed}-{row.atsPush}</td>
                      <td className="px-3 py-3 text-right tabular-nums" title={`ATS sample n=${row.atsBets}`}>
                        <div className="inline-flex flex-col items-end leading-tight">
                          <span className="font-semibold text-slate-700">{row.coverPct.toFixed(1)}%</span>
                          <span className="mt-1 text-[10px] text-slate-500">n={row.atsBets}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums" title={`ATS sample n=${row.atsBets}`}>
                        <div className="inline-flex flex-col items-end leading-tight">
                          <span className={`font-semibold ${row.atsRoiPct >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{row.atsRoiPct.toFixed(1)}%</span>
                          <span className="mt-1 text-[10px] text-slate-500">n={row.atsBets}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-slate-600">{row.over}-{row.under}-{row.ouPush}</td>
                      <td className="px-3 py-3 text-right tabular-nums" title={`Games sample n=${row.played}`}>
                        <div className="inline-flex flex-col items-end leading-tight">
                          <span className="font-semibold text-slate-700">{row.bttsPct.toFixed(1)}%</span>
                          <span className="mt-1 text-[10px] text-slate-500">n={row.played}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-slate-700">{row.avgGoals.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {filteredStandings.length === 0 && (
              <div className="border-t border-slate-100 px-4 py-8 text-sm text-slate-500">No teams match current standings filters.</div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
