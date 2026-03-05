import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchRecentMatches, getSpreadResult, getTotalResult, type SoccerPostgame } from '../lib/postgame';
import { formatMatchDate, LEAGUE_LABELS, LEAGUE_SHORT, matchUrl } from '../lib/slugs';

type DateWindow = 'all' | '30d' | '14d' | '7d';

type LeagueTrend = {
  leagueId: string;
  label: string;
  games: number;
  homeCoverPct: number;
  overPct: number;
  bttsPct: number;
  avgGoals: number;
  avgCorners: number;
  avgCards: number;
};

const safeN = (n: number | null | undefined): number => (Number.isFinite(n as number) ? Number(n) : 0);
const pct = (num: number, den: number): number => (den > 0 ? (num / den) * 100 : 0);
const avg = (num: number, den: number): number => (den > 0 ? num / den : 0);

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

export default function TrendsPage() {
  const [matches, setMatches] = useState<SoccerPostgame[]>([]);
  const [loading, setLoading] = useState(true);
  const [leagueFilter, setLeagueFilter] = useState<string>('all');
  const [dateWindow, setDateWindow] = useState<DateWindow>('all');
  const [search, setSearch] = useState<string>('');
  const [upsetThreshold, setUpsetThreshold] = useState<number>(150);

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      try {
        const data = await fetchRecentMatches(600);
        if (!active) return;

        setMatches(data);
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    document.title = 'Betting Trends | The Drip';

    return () => {
      active = false;
    };
  }, []);

  const leagueOptions = useMemo(() => {
    const ids = new Set<string>();
    for (const match of matches) ids.add(match.league_id);
    return ['all', ...[...ids].sort()];
  }, [matches]);

  const filteredMatches = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return matches.filter((match) => {
      if (leagueFilter !== 'all' && match.league_id !== leagueFilter) return false;
      if (!dateInWindow(match.start_time, dateWindow)) return false;

      if (needle) {
        const combined = `${match.home_team} ${match.away_team}`.toLowerCase();
        if (!combined.includes(needle)) return false;
      }

      return true;
    });
  }, [matches, leagueFilter, dateWindow, search]);

  const summary = useMemo(() => {
    if (filteredMatches.length === 0) return null;

    let goals = 0;
    let homeCovered = 0;
    let atsBets = 0;
    let homeSpreadUnits = 0;

    let overs = 0;
    let totalBets = 0;
    let overUnits = 0;

    let favoriteWins = 0;
    let dogWins = 0;
    let moneylineDecisions = 0;

    let btts = 0;
    let corners = 0;
    let cards = 0;
    let passPct = 0;
    let shotAcc = 0;

    for (const match of filteredMatches) {
      goals += match.home_score + match.away_score;

      const spread = getSpreadResult(match);
      if (spread) {
        if (spread.result === 'covered') homeCovered += 1;
        if (spread.result !== 'push') atsBets += 1;

        const outcome: 'win' | 'loss' | 'push' =
          spread.result === 'covered' ? 'win' : spread.result === 'failed' ? 'loss' : 'push';
        homeSpreadUnits += settleUnits(match.dk_home_spread_price, outcome);
      }

      const total = getTotalResult(match);
      if (total) {
        if (total.result === 'over') overs += 1;
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

      if (match.home_score > 0 && match.away_score > 0) btts += 1;

      corners += safeN(match.home_corners) + safeN(match.away_corners);
      cards +=
        safeN(match.home_yellow_cards) +
        safeN(match.away_yellow_cards) +
        safeN(match.home_red_cards) +
        safeN(match.away_red_cards);
      passPct += avg(safeN(match.home_pass_pct) + safeN(match.away_pass_pct), 2) * 100;
      shotAcc += avg(safeN(match.home_shot_accuracy) + safeN(match.away_shot_accuracy), 2) * 100;
    }

    return {
      sample: filteredMatches.length,
      homeCoverPct: pct(homeCovered, atsBets),
      overPct: pct(overs, totalBets),
      favoriteWinPct: pct(favoriteWins, moneylineDecisions),
      dogWinPct: pct(dogWins, moneylineDecisions),
      bttsPct: pct(btts, filteredMatches.length),
      avgGoals: avg(goals, filteredMatches.length),
      avgCorners: avg(corners, filteredMatches.length),
      avgCards: avg(cards, filteredMatches.length),
      avgPassPct: avg(passPct, filteredMatches.length),
      avgShotAcc: avg(shotAcc, filteredMatches.length),
      homeSpreadRoiPct: pct(homeSpreadUnits, atsBets),
      overRoiPct: pct(overUnits, totalBets),
    };
  }, [filteredMatches]);

  const byLeague = useMemo<LeagueTrend[]>(() => {
    const bucket = new Map<string, {
      games: number;
      homeCovered: number;
      atsBets: number;
      overs: number;
      totalBets: number;
      btts: number;
      goals: number;
      corners: number;
      cards: number;
    }>();

    for (const match of filteredMatches) {
      if (!bucket.has(match.league_id)) {
        bucket.set(match.league_id, {
          games: 0,
          homeCovered: 0,
          atsBets: 0,
          overs: 0,
          totalBets: 0,
          btts: 0,
          goals: 0,
          corners: 0,
          cards: 0,
        });
      }

      const agg = bucket.get(match.league_id)!;
      agg.games += 1;
      agg.goals += match.home_score + match.away_score;
      agg.corners += safeN(match.home_corners) + safeN(match.away_corners);
      agg.cards +=
        safeN(match.home_yellow_cards) +
        safeN(match.away_yellow_cards) +
        safeN(match.home_red_cards) +
        safeN(match.away_red_cards);
      if (match.home_score > 0 && match.away_score > 0) agg.btts += 1;

      const spread = getSpreadResult(match);
      if (spread) {
        if (spread.result === 'covered') agg.homeCovered += 1;
        if (spread.result !== 'push') agg.atsBets += 1;
      }

      const total = getTotalResult(match);
      if (total) {
        if (total.result === 'over') agg.overs += 1;
        if (total.result !== 'push') agg.totalBets += 1;
      }
    }

    return [...bucket.entries()]
      .map(([leagueId, agg]) => ({
        leagueId,
        label: LEAGUE_LABELS[leagueId] || leagueId.toUpperCase(),
        games: agg.games,
        homeCoverPct: pct(agg.homeCovered, agg.atsBets),
        overPct: pct(agg.overs, agg.totalBets),
        bttsPct: pct(agg.btts, agg.games),
        avgGoals: avg(agg.goals, agg.games),
        avgCorners: avg(agg.corners, agg.games),
        avgCards: avg(agg.cards, agg.games),
      }))
      .sort((a, b) => b.games - a.games);
  }, [filteredMatches]);

  const upsets = useMemo(() => {
    return filteredMatches
      .filter((match) => isUpset(match) && upsetLine(match) >= upsetThreshold)
      .sort((a, b) => upsetLine(b) - upsetLine(a))
      .slice(0, 8);
  }, [filteredMatches, upsetThreshold]);

  const highScoring = useMemo(() => {
    return filteredMatches
      .slice()
      .sort((a, b) => (b.home_score + b.away_score) - (a.home_score + a.away_score))
      .slice(0, 8);
  }, [filteredMatches]);

  return (
    <div className="h-[var(--vvh,100vh)] overflow-y-auto overscroll-y-contain bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto w-full max-w-7xl px-4 md:px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Link to="/" className="rounded-md border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 hover:text-slate-900 hover:bg-slate-50">
              Home
            </Link>
            <Link to="/edge" className="rounded-md border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 hover:text-slate-900 hover:bg-slate-50">
              Edge
            </Link>
          </div>
          <span className="text-xs text-slate-500">{filteredMatches.length} matches in view</span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 md:px-6 py-8 space-y-6">
        <section className="space-y-2">
          <h1 className="text-4xl font-semibold tracking-tight">Betting Trends</h1>
          <p className="text-sm text-slate-600">Advanced market outcomes from DB-backed closing lines and in-match stat profiles.</p>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 md:p-5">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">League</label>
              <select
                value={leagueFilter}
                onChange={(event) => setLeagueFilter(event.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
              >
                {leagueOptions.map((id) => (
                  <option key={id} value={id}>
                    {id === 'all' ? 'All leagues' : LEAGUE_LABELS[id] || id.toUpperCase()}
                  </option>
                ))}
              </select>
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
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Upset Threshold</label>
              <input
                type="number"
                min={100}
                max={600}
                value={upsetThreshold}
                onChange={(event) => setUpsetThreshold(Math.max(100, Math.min(600, Number(event.target.value) || 100)))}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
              />
            </div>

            <div className="self-end text-xs text-slate-500">Data source: `soccer_postgame`</div>
          </div>
        </section>

        {loading ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Loading trends...</section>
        ) : (
          <>
            {summary && (
              <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
                {[
                  { label: 'Sample Size', value: `n = ${summary.sample}` },
                  { label: 'Home Cover %', value: `${summary.homeCoverPct.toFixed(1)}%` },
                  { label: 'Over %', value: `${summary.overPct.toFixed(1)}%` },
                  { label: 'Favorite Win %', value: `${summary.favoriteWinPct.toFixed(1)}%` },
                  { label: 'Underdog Win %', value: `${summary.dogWinPct.toFixed(1)}%` },
                  { label: 'BTTS %', value: `${summary.bttsPct.toFixed(1)}%` },
                  { label: 'Avg Goals', value: summary.avgGoals.toFixed(2) },
                  { label: 'Avg Corners', value: summary.avgCorners.toFixed(1) },
                  { label: 'Avg Cards', value: summary.avgCards.toFixed(1) },
                  { label: 'Avg Pass %', value: `${summary.avgPassPct.toFixed(1)}%` },
                  { label: 'Avg Shot Accuracy', value: `${summary.avgShotAcc.toFixed(1)}%` },
                  { label: 'Home ATS ROI', value: `${summary.homeSpreadRoiPct.toFixed(1)}%` },
                  { label: 'Over ROI', value: `${summary.overRoiPct.toFixed(1)}%` },
                ].map((item) => (
                  <article key={item.label} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{item.label}</div>
                    <div className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{item.value}</div>
                  </article>
                ))}
              </section>
            )}

            <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 text-sm font-semibold text-slate-800">League Breakdown</div>
              <div className="overflow-x-auto">
                <table className="min-w-[900px] w-full text-[13px]">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
                      <th className="px-4 py-2.5 text-left">League</th>
                      <th className="px-3 py-2.5 text-right">Games</th>
                      <th className="px-3 py-2.5 text-right">Home ATS</th>
                      <th className="px-3 py-2.5 text-right">Over %</th>
                      <th className="px-3 py-2.5 text-right">BTTS %</th>
                      <th className="px-3 py-2.5 text-right">Avg Goals</th>
                      <th className="px-3 py-2.5 text-right">Avg Corners</th>
                      <th className="px-3 py-2.5 text-right">Avg Cards</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byLeague.map((row) => (
                      <tr key={row.leagueId} className="border-t border-slate-100 hover:bg-blue-50/45">
                        <td className="px-4 py-2.5 font-semibold text-slate-900">{row.label}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{row.games}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{row.homeCoverPct.toFixed(1)}%</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{row.overPct.toFixed(1)}%</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{row.bttsPct.toFixed(1)}%</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{row.avgGoals.toFixed(2)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{row.avgCorners.toFixed(1)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{row.avgCards.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="grid gap-4 xl:grid-cols-2">
              <article className="rounded-2xl border border-slate-200 bg-white">
                <div className="px-4 py-3 border-b border-slate-100 text-sm font-semibold text-slate-800">Biggest Upsets</div>
                <div className="p-4 space-y-2">
                  {upsets.map((match) => (
                    <Link
                      key={match.id}
                      to={matchUrl(match.home_team, match.away_team, match.start_time)}
                      className="grid grid-cols-[1fr_auto_auto] gap-3 items-center rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-900 truncate">
                          {match.home_team} vs {match.away_team}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {LEAGUE_SHORT[match.league_id]} · {formatMatchDate(match.start_time)}
                        </div>
                      </div>
                      <div className="text-sm tabular-nums text-slate-600">
                        {match.home_score}-{match.away_score}
                      </div>
                      <div className="text-sm font-semibold tabular-nums text-rose-600">
                        +{upsetLine(match)}
                      </div>
                    </Link>
                  ))}
                  {upsets.length === 0 && <div className="text-sm text-slate-500">No upsets at current threshold.</div>}
                </div>
              </article>

              <article className="rounded-2xl border border-slate-200 bg-white">
                <div className="px-4 py-3 border-b border-slate-100 text-sm font-semibold text-slate-800">Highest Scoring</div>
                <div className="p-4 space-y-2">
                  {highScoring.map((match) => (
                    <Link
                      key={match.id}
                      to={matchUrl(match.home_team, match.away_team, match.start_time)}
                      className="grid grid-cols-[1fr_auto_auto] gap-3 items-center rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-900 truncate">
                          {match.home_team} vs {match.away_team}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {LEAGUE_SHORT[match.league_id]} · {formatMatchDate(match.start_time)}
                        </div>
                      </div>
                      <div className="text-sm tabular-nums text-slate-600">
                        {match.home_score}-{match.away_score}
                      </div>
                      <div className="text-sm font-semibold tabular-nums text-slate-700">
                        {match.home_score + match.away_score} goals
                      </div>
                    </Link>
                  ))}
                </div>
              </article>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
