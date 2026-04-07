/* ============================================================================
   /api/live/page-data
   Public endpoint serving combined live game data for the live score page.
   Pulls from: matches, market_feeds, player_prop_bets, opening_lines.

   Route: /api/live/page-data?gameId={espnGameId}
   No HMAC required — uses only public-facing Supabase data with RLS.
============================================================================ */
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const GAME_ID_RE = /^[\w-]{4,128}$/;

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const gameId = req.query.gameId;
  if (!gameId || !GAME_ID_RE.test(gameId)) {
    return res.status(400).json({ error: "Missing or invalid gameId" });
  }

  try {
    // Parallel: match data, market feeds, player props, opening lines
    const [matchRes, propsRes] = await Promise.all([
      supabase
        .from("matches")
        .select("id, home_team, away_team, home_team_id, away_team_id, status, status_state, period, display_clock, home_score, away_score, current_odds, opening_odds, win_probability, odds_home_ml_safe, odds_away_ml_safe, odds_home_spread_safe, odds_total_safe, start_time")
        .eq("id", gameId)
        .maybeSingle(),
      supabase
        .from("player_prop_bets")
        .select("player_name, team, bet_type, line_value, side, odds_american, headshot_url, sportsbook, open_line")
        .eq("match_id", gameId)
        .eq("league", "nba")
        .order("player_name")
    ]);

    const match = matchRes.data;
    if (!match) return res.status(404).json({ error: "Game not found" });

    // Fetch market feeds by matching teams + date
    let bookmakers = [];
    if (match.start_time) {
      const gameDate = new Date(match.start_time);
      const dayStart = new Date(gameDate);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(gameDate);
      dayEnd.setHours(23, 59, 59, 999);

      const feedRes = await supabase
        .from("market_feeds")
        .select("raw_bookmakers, best_h2h, best_spread, best_total, home_team, away_team")
        .eq("sport_key", "basketball_nba")
        .gte("commence_time", dayStart.toISOString())
        .lte("commence_time", dayEnd.toISOString())
        .or(`canonical_id.eq.${gameId}`)
        .limit(5);

      // Find the right feed by matching team names
      const feeds = feedRes.data || [];
      const feed = feeds.find(f => f.canonical_id === gameId) ||
        feeds.find(f =>
          (f.home_team?.includes(match.home_team?.split(" ").pop()) ||
           f.away_team?.includes(match.away_team?.split(" ").pop()))
        ) || feeds[0];

      if (feed) {
        // Parse bookmakers for odds comparison
        try {
          const raw = typeof feed.raw_bookmakers === "string"
            ? JSON.parse(feed.raw_bookmakers)
            : feed.raw_bookmakers;

          if (Array.isArray(raw)) {
            bookmakers = raw.map(bk => {
              const h2h = bk.markets?.find(m => m.key === "h2h");
              const spreads = bk.markets?.find(m => m.key === "spreads");
              const totals = bk.markets?.find(m => m.key === "totals");

              return {
                name: formatBookName(bk.key || bk.title),
                moneyline_home: h2h?.outcomes?.find(o => o.name === match.home_team)?.price,
                moneyline_away: h2h?.outcomes?.find(o => o.name === match.away_team)?.price,
                spread_home: spreads?.outcomes?.find(o => o.name === match.home_team)?.point,
                spread_price: spreads?.outcomes?.find(o => o.name === match.home_team)?.price,
                total: totals?.outcomes?.find(o => o.name === "Over")?.point,
                total_over_price: totals?.outcomes?.find(o => o.name === "Over")?.price,
                total_under_price: totals?.outcomes?.find(o => o.name === "Under")?.price
              };
            }).filter(b => b.moneyline_home || b.spread_home || b.total);
          }
        } catch (e) {
          // raw_bookmakers parse failed, use best_ fields
        }

        // Attach consensus best lines
        if (!bookmakers.length && feed.best_h2h) {
          bookmakers = [{
            name: feed.best_h2h.bookmaker || "Consensus",
            moneyline_home: feed.best_h2h.home?.price,
            moneyline_away: feed.best_h2h.away?.price,
            spread_home: feed.best_spread?.home?.point,
            total: feed.best_total?.over?.point
          }];
        }
      }
    }

    // Group props by player
    const propsMap = {};
    for (const p of (propsRes.data || [])) {
      if (p.side !== "over") continue; // only show over lines (they define the line)
      const key = p.player_name;
      if (!propsMap[key]) {
        propsMap[key] = {
          name: p.player_name,
          team: p.team,
          headshot: p.headshot_url,
          markets: []
        };
      }
      propsMap[key].markets.push({
        type: p.bet_type,
        line: Number(p.line_value),
        odds: p.odds_american,
        sportsbook: p.sportsbook,
        open_line: p.open_line ? Number(p.open_line) : null
      });
    }

    res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
    return res.status(200).json({
      game_id: match.id,
      status: match.status,
      status_state: match.status_state,
      period: match.period,
      clock: match.display_clock,
      home: {
        team: match.home_team,
        team_id: match.home_team_id,
        score: match.home_score,
        ml: match.odds_home_ml_safe
      },
      away: {
        team: match.away_team,
        team_id: match.away_team_id,
        score: match.away_score,
        ml: match.odds_away_ml_safe
      },
      odds: {
        spread: match.odds_home_spread_safe,
        total: match.odds_total_safe,
        current: match.current_odds,
        opening: match.opening_odds,
        win_probability: match.win_probability
      },
      bookmakers: bookmakers.slice(0, 8),
      props: Object.values(propsMap),
      start_time: match.start_time
    });
  } catch (e) {
    console.error("[Live Page Data]", e.message);
    return res.status(500).json({ error: "Internal error" });
  }
}

function formatBookName(key) {
  const map = {
    fanduel: "FanDuel",
    draftkings: "DraftKings",
    betmgm: "BetMGM",
    caesars: "Caesars",
    pointsbet: "PointsBet",
    betonlineag: "BetOnline",
    bovada: "Bovada",
    wynnbet: "WynnBet",
    betrivers: "BetRivers",
    unibet_us: "Unibet",
    barstool: "ESPN BET",
    espnbet: "ESPN BET",
    pinnacle: "Pinnacle",
    mybookieag: "MyBookie",
    lowvig: "LowVig",
    betus: "BetUS",
    superbook: "SuperBook",
    betfair: "Betfair",
    williamhill_us: "Caesars"
  };
  return map[key] || key?.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) || "Unknown";
}
