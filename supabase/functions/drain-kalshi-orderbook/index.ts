declare const Deno: any;

import { createClient } from "npm:@supabase/supabase-js@2";
import { createSign } from "node:crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const KALSHI_BASE_URL = Deno.env.get("KALSHI_BASE_URL") || "https://api.elections.kalshi.com";
const REQUEST_DELAY_MS = 150;
const DEFAULT_MAX_MARKETS = 60;
const DEFAULT_MAX_EVENTS = 24;
const DISCOVERY_PAGE_LIMIT = 200;
const DISCOVERY_MAX_PAGES = 8;

type Phase = "discover" | "snapshot" | "both";
type SnapshotType = "pregame" | "live" | "settled";

type SportFilter = "all" | "soccer" | "nba" | "nhl" | "mlb";

interface EventRow {
  event_ticker: string;
  sport: string | null;
  league: string | null;
  title: string | null;
  home_team: string | null;
  away_team: string | null;
  game_date: string | null;
  market_count: number;
  market_tickers: string[];
  status: string;
}

interface CandidateMarket {
  eventTicker: string;
  marketTicker: string;
  sport: string | null;
  league: string | null;
  gameDate: string | null;
}

interface MarketIdentity {
  marketType: string;
  marketLabel: string | null;
  lineValue: number | null;
  lineSide: string | null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toNum(value: any): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toInt(value: any): number | null {
  const n = toNum(value);
  return n === null ? null : Math.round(n);
}

function normalizeProbPrice(value: any): number | null {
  const n = toNum(value);
  if (n === null) return null;
  if (n > 1.5) return n / 100;
  return n;
}

function getStringField(obj: any, keys: string[]): string | null {
  for (const key of keys) {
    const value = obj?.[key];
    if (value === null || value === undefined) continue;
    const s = String(value).trim();
    if (s) return s;
  }
  return null;
}

function normalizeDateLike(value: any): string | null {
  if (!value) return null;
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function shiftUtcDate(yyyyMmDd: string, deltaDays: number): string {
  const d = new Date(`${yyyyMmDd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function normalizePem(pem: string): string {
  return pem
    .trim()
    .replace(/^"([\s\S]+)"$/, "$1")
    .replace(/\\n/g, "\n");
}

function isFinalizedStatus(statusValue: string | null): boolean {
  const status = (statusValue || "").toLowerCase();
  return (
    status.includes("final") ||
    status.includes("settl") ||
    status.includes("close") ||
    status.includes("resolv") ||
    status.includes("expire")
  );
}

function isTradableStatus(statusValue: string | null): boolean {
  if (!statusValue) return true;
  const status = statusValue.toLowerCase();
  return status.includes("active") || status.includes("open") || status.includes("trade") || status.includes("live");
}

function inferSnapshotType(statusValue: string | null, gameDate: string | null): SnapshotType {
  const status = (statusValue || "").toLowerCase();
  if (isFinalizedStatus(status)) return "settled";
  if (status.includes("live") || status.includes("in_progress") || status.includes("trading") || status.includes("open")) {
    return "live";
  }
  if (gameDate && gameDate < todayUtcDate()) return "settled";
  return "pregame";
}

function parseTeams(title: string | null): { home: string | null; away: string | null } {
  if (!title) return { home: null, away: null };

  const atMatch = title.match(/^(.+?)\s+at\s+(.+)$/i);
  if (atMatch) {
    return { away: atMatch[1].trim(), home: atMatch[2].trim() };
  }

  const vsMatch = title.match(/^(.+?)\s+vs\.?\s+(.+)$/i);
  if (vsMatch) {
    return { away: vsMatch[1].trim(), home: vsMatch[2].trim() };
  }

  return { home: null, away: null };
}

function parseDateFromEventTicker(eventTicker: string): string | null {
  const m = eventTicker.toUpperCase().match(/(\d{2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2})/);
  if (!m) return null;

  const monthMap: Record<string, number> = {
    JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
    JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
  };

  const yy = Number(m[1]);
  const mon = monthMap[m[2]];
  const dd = Number(m[3]);
  if (mon === undefined || !Number.isFinite(yy) || !Number.isFinite(dd)) return null;

  const year = 2000 + yy;
  const d = new Date(Date.UTC(year, mon, dd));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function extractGameKey(value: string | null): string | null {
  if (!value) return null;
  const m = String(value).toUpperCase().match(/(\d{2}(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\d{2}[A-Z0-9]+)/);
  return m ? m[1] : null;
}

function resolveGameDate(eventTicker: string, ...dateHints: Array<any>): string | null {
  const tickerDate = parseDateFromEventTicker(eventTicker);
  if (tickerDate) return tickerDate;

  for (const hint of dateHints) {
    const embeddedDate = parseDateFromEventTicker(String(hint || ""));
    if (embeddedDate) return embeddedDate;
    const normalized = normalizeDateLike(hint);
    if (normalized) return normalized;
  }
  return null;
}

function inferSportLeague(
  seriesTicker: string | null,
  title: string | null,
  category: string | null = null,
  eventTicker: string | null = null,
  marketTicker: string | null = null
): { sport: string | null; league: string | null } {
  const s = (seriesTicker || "").toUpperCase();
  const e = (eventTicker || "").toUpperCase();
  const m = (marketTicker || "").toUpperCase();
  const t = (title || "").toLowerCase();
  const c = (category || "").toLowerCase();
  const em = `${e} ${m}`;

  if (
    s.includes("KXNCAAMB") ||
    em.includes("KXNCAAMB") ||
    em.includes("CBCHAMPIONSHIP")
  ) {
    return { sport: "basketball", league: "ncaamb" };
  }

  if (s.includes("KXNBA") || em.includes("KXNBA")) return { sport: "basketball", league: "nba" };
  if (s.includes("KXNHL") || em.includes("KXNHL")) return { sport: "hockey", league: "nhl" };
  if (s.includes("KXMLB") || em.includes("KXMLB")) return { sport: "baseball", league: "mlb" };

  if (
    s.includes("EPL") ||
    s.includes("UCL") ||
    s.includes("MLS") ||
    s.includes("BUND") ||
    s.includes("LIGA") ||
    s.includes("SERIE") ||
    s.includes("SOCCER") ||
    em.includes("KXSOCCER") ||
    em.includes("KXUCL") ||
    em.includes("KXEPL") ||
    em.includes("KXMLS") ||
    em.includes("KXBUND") ||
    em.includes("KXLIGA") ||
    em.includes("KXSERIE") ||
    t.includes("soccer")
  ) {
    return { sport: "soccer", league: "soccer" };
  }

  if (t.includes("basketball") || c.includes("basketball")) return { sport: "basketball", league: null };
  if (t.includes("hockey") || c.includes("hockey")) return { sport: "hockey", league: null };
  if (t.includes("baseball") || c.includes("baseball")) return { sport: "baseball", league: null };
  if (t.includes("soccer") || c.includes("soccer") || c.includes("football")) return { sport: "soccer", league: null };

  return { sport: null, league: null };
}

function mapSportFilter(value: any): SportFilter {
  const s = String(value || "all").toLowerCase();
  if (s === "soccer" || s === "nba" || s === "nhl" || s === "mlb") return s;
  return "all";
}

function matchesSportFilter(filter: SportFilter, sport: string | null, league: string | null): boolean {
  if (filter === "all") return !!sport && ["soccer", "basketball", "hockey", "baseball"].includes(sport);
  if (filter === "soccer") return sport === "soccer" || (league || "").includes("soccer");
  if (filter === "nba") return league === "nba" || (sport === "basketball" && league === "nba");
  if (filter === "nhl") return league === "nhl" || sport === "hockey";
  if (filter === "mlb") return league === "mlb" || sport === "baseball";
  return true;
}

function parseLevel(raw: any): { price: number; qty: number } | null {
  if (Array.isArray(raw)) {
    const price = normalizeProbPrice(raw[0]);
    const qty = toInt(raw[1] ?? raw[2]);
    if (price === null || qty === null) return null;
    return { price, qty };
  }

  const price = normalizeProbPrice(raw?.price ?? raw?.yes_price_dollars ?? raw?.no_price_dollars ?? raw?.bid ?? raw?.px);
  const qty = toInt(raw?.qty ?? raw?.quantity ?? raw?.count ?? raw?.size ?? raw?.volume ?? raw?.contracts);
  if (price === null || qty === null) return null;
  return { price, qty };
}

function parseSideLevels(rawSide: any): Array<{ price: number; qty: number }> {
  if (!Array.isArray(rawSide)) return [];
  return rawSide
    .map(parseLevel)
    .filter((lvl): lvl is { price: number; qty: number } => lvl !== null)
    .sort((a, b) => b.price - a.price)
    .slice(0, 5);
}

function parseOrderbookPayload(payload: any) {
  const root = payload?.orderbook ?? payload?.data?.orderbook ?? payload ?? {};

  const yesRaw =
    root?.yes ??
    root?.yes_bids ??
    root?.yes_levels ??
    root?.bids_yes ??
    root?.orderbook_fp?.yes_dollars ??
    payload?.orderbook_fp?.yes_dollars ??
    [];

  const noRaw =
    root?.no ??
    root?.no_bids ??
    root?.no_levels ??
    root?.bids_no ??
    root?.orderbook_fp?.no_dollars ??
    payload?.orderbook_fp?.no_dollars ??
    [];

  const yesLevels = parseSideLevels(yesRaw);
  const noLevels = parseSideLevels(noRaw);

  const yesTotal = yesLevels.reduce((sum, level) => sum + level.qty, 0);
  const noTotal = noLevels.reduce((sum, level) => sum + level.qty, 0);
  const totalDepth = yesTotal + noTotal;
  const yesBestBid = yesLevels[0]?.price ?? null;
  const noBestBid = noLevels[0]?.price ?? null;

  const midPrice =
    yesBestBid !== null && noBestBid !== null
      ? Number(((yesBestBid + (1 - noBestBid)) / 2).toFixed(6))
      : null;

  const spreadWidth =
    yesBestBid !== null && noBestBid !== null
      ? Number((yesBestBid + noBestBid - 1).toFixed(6))
      : null;

  return {
    yesLevels,
    noLevels,
    yesBestBid,
    yesBestBidQty: yesLevels[0]?.qty ?? null,
    yesTotalBidQty: yesTotal || null,
    noBestBid,
    noBestBidQty: noLevels[0]?.qty ?? null,
    noTotalBidQty: noTotal || null,
    yesNoImbalance: totalDepth > 0 ? Number((yesTotal / totalDepth).toFixed(6)) : null,
    midPrice,
    spreadWidth,
  };
}

function parseTradesPayload(payload: any) {
  const tradesRaw = Array.isArray(payload?.trades)
    ? payload.trades
    : Array.isArray(payload?.data?.trades)
    ? payload.data.trades
    : [];

  const trades = tradesRaw
    .map((trade: any) => {
      const sideRaw = String(trade?.taker_side ?? trade?.side ?? "").toLowerCase();
      const side = sideRaw === "yes" || sideRaw === "no" ? sideRaw : null;
      const qty = toInt(trade?.count_fp ?? trade?.count ?? trade?.quantity ?? trade?.qty) || 0;
      const yesPrice = normalizeProbPrice(trade?.yes_price_dollars ?? trade?.yes_price);
      const noPrice = normalizeProbPrice(trade?.no_price_dollars ?? trade?.no_price);
      const genericPrice = normalizeProbPrice(trade?.price);
      const tradePrice =
        side === "yes"
          ? yesPrice ?? genericPrice
          : side === "no"
          ? noPrice ?? genericPrice
          : genericPrice ?? yesPrice ?? noPrice;
      const createdAt = String(trade?.created_time ?? trade?.created_at ?? "");
      const createdTs = new Date(createdAt).getTime();
      return {
        side,
        qty,
        tradePrice,
        tradeTime: createdAt || null,
        createdTs: Number.isFinite(createdTs) ? createdTs : 0,
      };
    })
    .sort((a, b) => b.createdTs - a.createdTs)
    .slice(0, 50);

  const yesVolume = trades.reduce((sum, t) => sum + (t.side === "yes" ? t.qty : 0), 0);
  const noVolume = trades.reduce((sum, t) => sum + (t.side === "no" ? t.qty : 0), 0);
  const total = yesVolume + noVolume;

  return {
    recentTradeCount: trades.length,
    recentYesVolume: yesVolume,
    recentNoVolume: noVolume,
    recentVolumeImbalance: total > 0 ? Number((yesVolume / total).toFixed(6)) : null,
    lastTradePrice: trades[0]?.tradePrice ?? null,
    lastTradeSide: trades[0]?.side ?? null,
    lastTradeAt: trades[0]?.tradeTime ?? null,
  };
}

function parseLineValue(...texts: Array<string | null>): number | null {
  for (const text of texts) {
    if (!text) continue;
    const m = text.match(/([+-]?\d+(?:\.\d+)?)/);
    if (m) {
      const v = Number(m[1]);
      if (Number.isFinite(v)) return v;
    }
  }
  return null;
}

function parseLineSide(text: string | null): string | null {
  const low = (text || "").toLowerCase();
  if (!low) return null;
  if (low.includes("over")) return "over";
  if (low.includes("under")) return "under";
  if (low.includes("draw") || low.includes("tie")) return "draw";
  if (low.includes("home")) return "home";
  if (low.includes("away")) return "away";
  if (low.includes("yes")) return "yes";
  if (low.includes("no")) return "no";
  return null;
}

function classifyMarketIdentity(marketTicker: string, market: any): MarketIdentity {
  const title = getStringField(market, ["title"]);
  const subtitle = getStringField(market, ["subtitle", "yes_sub_title", "no_sub_title"]);
  const yesLabel = getStringField(market, ["yes_sub_title"]);
  const noLabel = getStringField(market, ["no_sub_title"]);

  const text = [marketTicker, title, subtitle, yesLabel, noLabel].filter(Boolean).join(" ").toLowerCase();

  let marketType = "prop";

  const isHalf = text.includes("1h") || text.includes("1st half") || text.includes("first half") || text.includes("halftime");
  const hasOverUnder = text.includes("over") || text.includes("under") || text.includes("total");

  if (isHalf) {
    marketType = hasOverUnder ? "1h_total" : "1h_winner";
  } else if (text.includes("winner") || text.includes(" to win") || text.includes(" game")) {
    marketType = "moneyline";
  } else if (text.includes("spread") || text.includes(" by ")) {
    marketType = "spread";
  } else if (hasOverUnder) {
    marketType = "total";
  } else if (text.includes("points") || text.includes("reb") || text.includes("ast") || text.includes("player")) {
    marketType = "prop";
  }

  const marketLabel = yesLabel || title || subtitle || marketTicker;
  const lineValue = parseLineValue(yesLabel, noLabel, subtitle, title);
  const lineSide = parseLineSide(yesLabel || subtitle || title);

  return { marketType, marketLabel, lineValue, lineSide };
}

function marketPriorityKey(marketTicker: string): number {
  const t = marketTicker.toUpperCase();
  if (t.includes("GAME")) return 1;
  if (t.includes("TOTAL")) return 2;
  if (t.includes("SPREAD")) return 3;
  if (t.includes("1H")) return 4;
  return 5;
}

async function signKalshiMessage(message: string, privateKeyPem: string): Promise<string> {
  const normalizedPem = normalizePem(privateKeyPem);
  const signer = createSign("RSA-SHA256");
  signer.update(message);
  signer.end();
  return signer.sign(normalizedPem, "base64");
}

async function kalshiGet(
  pathWithQuery: string,
  keyId: string | null,
  privateKeyPem: string | null
): Promise<{ ok: true; data: any } | { ok: false; status: number; error: string }> {
  try {
    const runRequest = async (signed: boolean) => {
      const headers: Record<string, string> = {};
      if (signed && keyId && privateKeyPem) {
        const ts = Date.now().toString();
        const signature = await signKalshiMessage(`${ts}GET${pathWithQuery}`, privateKeyPem);
        headers["KALSHI-ACCESS-KEY"] = keyId;
        headers["KALSHI-ACCESS-TIMESTAMP"] = ts;
        headers["KALSHI-ACCESS-SIGNATURE"] = signature;
      }
      return fetch(`${KALSHI_BASE_URL}${pathWithQuery}`, {
        headers,
        signal: AbortSignal.timeout(12000),
      });
    };

    let res = await runRequest(false);
    if ((res.status === 401 || res.status === 403) && keyId && privateKeyPem) {
      res = await runRequest(true);
    }

    if (!res.ok) {
      return { ok: false, status: res.status, error: await res.text() };
    }

    return { ok: true, data: await res.json() };
  } catch (err: any) {
    return { ok: false, status: 0, error: err?.message || String(err) };
  }
}

async function fetchEventPayload(eventTicker: string, keyId: string | null, privateKeyPem: string | null) {
  return kalshiGet(`/trade-api/v2/events/${encodeURIComponent(eventTicker)}`, keyId, privateKeyPem);
}

async function discoverPhase(
  supabase: any,
  keyId: string | null,
  privateKeyPem: string | null,
  sportFilter: SportFilter,
  eventTickersOverride: string[]
) {
  const stats = {
    event_candidates: 0,
    events_processed: 0,
    events_upserted: 0,
    events_skipped: 0,
    errors: [] as string[],
  };

  const eventTickers: string[] = [];
  const listedMarketTickersByEvent = new Map<string, Set<string>>();
  const listedMarketTickersByGameKey = new Map<string, Set<string>>();

  if (eventTickersOverride.length > 0) {
    eventTickers.push(...eventTickersOverride);
  } else {
    let cursor: string | null = null;

    for (let page = 0; page < DISCOVERY_MAX_PAGES; page++) {
      const path = `/trade-api/v2/markets?limit=${DISCOVERY_PAGE_LIMIT}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const res = await kalshiGet(path, keyId, privateKeyPem);
      if (!res.ok) {
        stats.errors.push(`markets_discovery:${res.status}:${res.error.slice(0, 180)}`);
        break;
      }

      const markets = Array.isArray(res.data?.markets) ? res.data.markets : [];
      for (const market of markets) {
        const marketStatus = getStringField(market, ["status"]);
        if (isFinalizedStatus(marketStatus) || !isTradableStatus(marketStatus)) continue;

        const eventTicker = getStringField(market, ["event_ticker", "eventTicker"]);
        const marketTicker = getStringField(market, ["ticker", "market_ticker"]);
        if (!eventTicker) continue;
        const inferred = inferSportLeague(
          getStringField(market, ["series_ticker", "seriesTicker"]),
          getStringField(market, ["title"]),
          getStringField(market, ["category"]),
          eventTicker,
          marketTicker
        );
        if (!matchesSportFilter(sportFilter, inferred.sport, inferred.league)) continue;
        eventTickers.push(eventTicker);

        if (marketTicker) {
          if (!listedMarketTickersByEvent.has(eventTicker)) {
            listedMarketTickersByEvent.set(eventTicker, new Set<string>());
          }
          listedMarketTickersByEvent.get(eventTicker)!.add(marketTicker);

          const gameKey = extractGameKey(eventTicker) || extractGameKey(marketTicker);
          if (gameKey) {
            if (!listedMarketTickersByGameKey.has(gameKey)) {
              listedMarketTickersByGameKey.set(gameKey, new Set<string>());
            }
            listedMarketTickersByGameKey.get(gameKey)!.add(marketTicker);
          }
        }
      }

      cursor = getStringField(res.data, ["cursor"]);
      if (!cursor || markets.length < DISCOVERY_PAGE_LIMIT) break;
      await sleep(REQUEST_DELAY_MS);
    }
  }

  let discoveryCandidates = Array.from(new Set(eventTickers)).slice(0, DEFAULT_MAX_EVENTS);

  if (discoveryCandidates.length === 0 && eventTickersOverride.length === 0) {
    const today = todayUtcDate();
    const windowStart = shiftUtcDate(today, -1);
    const windowEnd = shiftUtcDate(today, 2);

    const { data: fallbackRows, error: fallbackErr } = await supabase
      .from("kalshi_line_markets")
      .select("event_ticker,sport,league,game_date,status")
      .order("game_date", { ascending: false })
      .limit(1200);

    if (fallbackErr) {
      stats.errors.push(`fallback_line_markets_lookup:${fallbackErr.message}`);
    } else {
      discoveryCandidates = Array.from(
        new Set(
          (fallbackRows || [])
            .filter((row: any) => {
              const inferredRow = inferSportLeague(null, null, null, String(row?.event_ticker || ""));
              const sport = row?.sport ? String(row.sport).toLowerCase() : inferredRow.sport;
              const league = row?.league ? String(row.league).toLowerCase() : inferredRow.league;
              if (!matchesSportFilter(sportFilter, sport, league)) return false;
              if (isFinalizedStatus(row?.status ? String(row.status) : null)) return false;

              const rowDate = resolveGameDate(
                String(row?.event_ticker || ""),
                row?.game_date
              );
              if (!rowDate) return true;
              return rowDate >= windowStart && rowDate <= windowEnd;
            })
            .map((row: any) => String(row.event_ticker || "").trim())
            .filter(Boolean)
        )
      ).slice(0, DEFAULT_MAX_EVENTS);
    }
  }

  stats.event_candidates = discoveryCandidates.length;

  const rows: EventRow[] = [];

  for (const eventTicker of discoveryCandidates) {
    stats.events_processed++;
    await sleep(REQUEST_DELAY_MS);

    const ev = await fetchEventPayload(eventTicker, keyId, privateKeyPem);
    if (!ev.ok) {
      stats.errors.push(`${eventTicker}:event:${ev.status}:${ev.error.slice(0, 180)}`);
      stats.events_skipped++;
      continue;
    }

    const eventObj = ev.data?.event || {};
    const markets = Array.isArray(ev.data?.markets) ? ev.data.markets : [];
    const seriesTicker = getStringField(eventObj, ["series_ticker", "seriesTicker"]);
    const title = getStringField(eventObj, ["title"]);
    const firstMarket = markets[0] || null;
    const firstMarketTicker = getStringField(firstMarket, ["ticker", "market_ticker"]);

    const inferred = inferSportLeague(
      seriesTicker,
      title,
      getStringField(eventObj, ["category"]) || getStringField(eventObj?.product_metadata, ["competition"]),
      eventTicker,
      firstMarketTicker
    );

    if (!matchesSportFilter(sportFilter, inferred.sport, inferred.league)) {
      stats.events_skipped++;
      continue;
    }

    const { home, away } = parseTeams(title);
    const marketTickers = markets
      .map((m: any) => getStringField(m, ["ticker", "market_ticker"]))
      .filter((t: string | null): t is string => !!t);

    if (marketTickers.length === 0) {
      await sleep(REQUEST_DELAY_MS);
      const lookupRes = await kalshiGet(
        `/trade-api/v2/markets?event_ticker=${encodeURIComponent(eventTicker)}&limit=500`,
        keyId,
        privateKeyPem
      );
      if (lookupRes.ok) {
        const lookupMarkets = Array.isArray(lookupRes.data?.markets) ? lookupRes.data.markets : [];
        for (const m of lookupMarkets) {
          const t = getStringField(m, ["ticker", "market_ticker"]);
          if (t) marketTickers.push(t);
        }
      }
    }

    const fromEventListing = listedMarketTickersByEvent.get(eventTicker);
    if (fromEventListing) {
      for (const ticker of fromEventListing) marketTickers.push(ticker);
    }

    const gameKey = extractGameKey(eventTicker);
    if (gameKey) {
      const fromGameKey = listedMarketTickersByGameKey.get(gameKey);
      if (fromGameKey) {
        for (const ticker of fromGameKey) marketTickers.push(ticker);
      }
    }

    const uniqueMarketTickers = Array.from(new Set(marketTickers));
    if (uniqueMarketTickers.length === 0) {
      stats.events_skipped++;
      continue;
    }

    const gameDate = resolveGameDate(
      eventTicker,
      firstMarketTicker,
      getStringField(eventObj, ["expected_expiration_time", "expiration_time", "open_time"]),
      getStringField(firstMarket, ["expected_expiration_time", "expiration_time", "open_time", "close_time"])
    );

    if (!gameDate) {
      stats.events_skipped++;
      continue;
    }

    rows.push({
      event_ticker: eventTicker,
      sport: inferred.sport,
      league: inferred.league,
      title,
      home_team: home,
      away_team: away,
      game_date: gameDate,
      market_count: uniqueMarketTickers.length,
      market_tickers: uniqueMarketTickers,
      status: "active",
    });
  }

  if (rows.length > 0) {
    const { error } = await supabase
      .from("kalshi_events_active")
      .upsert(rows, { onConflict: "event_ticker" });

    if (error) {
      stats.errors.push(`events_upsert:${error.message}`);
    } else {
      stats.events_upserted = rows.length;
    }
  }

  return stats;
}

async function snapshotPhase(
  supabase: any,
  keyId: string | null,
  privateKeyPem: string | null,
  sportFilter: SportFilter,
  eventTickersOverride: string[],
  maxMarkets: number
) {
  const stats = {
    selected_events: 0,
    selected_markets: 0,
    processed_markets: 0,
    rows_inserted: 0,
    skipped_markets: 0,
    errors: [] as string[],
  };

  let eventRows: any[] = [];

  if (eventTickersOverride.length > 0) {
    const { data } = await supabase
      .from("kalshi_events_active")
      .select("event_ticker,sport,league,game_date,market_tickers,status")
      .in("event_ticker", eventTickersOverride);

    eventRows = data || [];

    const missing = eventTickersOverride.filter((et) => !eventRows.some((row) => row.event_ticker === et));
    for (const eventTicker of missing) {
      await sleep(REQUEST_DELAY_MS);
      const ev = await fetchEventPayload(eventTicker, keyId, privateKeyPem);
      if (!ev.ok) {
        stats.errors.push(`${eventTicker}:event_for_snapshot:${ev.status}:${ev.error.slice(0, 180)}`);
        continue;
      }
      const eventObj = ev.data?.event || {};
      const markets = Array.isArray(ev.data?.markets) ? ev.data.markets : [];
      const seriesTicker = getStringField(eventObj, ["series_ticker", "seriesTicker"]);
      const firstMarket = markets[0] || null;
      const inferred = inferSportLeague(
        seriesTicker,
        getStringField(eventObj, ["title"]),
        getStringField(eventObj, ["category"]) || getStringField(eventObj?.product_metadata, ["competition"]),
        eventTicker,
        getStringField(firstMarket, ["ticker", "market_ticker"])
      );
      eventRows.push({
        event_ticker: eventTicker,
        sport: inferred.sport,
        league: inferred.league,
        game_date: resolveGameDate(
          eventTicker,
          getStringField(firstMarket, ["ticker", "market_ticker"]),
          getStringField(eventObj, ["expected_expiration_time", "expiration_time", "open_time"])
        ),
        market_tickers: markets
          .map((m: any) => getStringField(m, ["ticker", "market_ticker"]))
          .filter((t: string | null): t is string => !!t),
        status: "active",
      });
    }
  } else {
    const { data, error } = await supabase
      .from("kalshi_events_active")
      .select("event_ticker,sport,league,game_date,market_tickers,status")
      .eq("status", "active")
      .limit(500);

    if (error) {
      stats.errors.push(`active_events_lookup:${error.message}`);
      return stats;
    }
    eventRows = data || [];
  }

  const today = todayUtcDate();
  const windowStart = shiftUtcDate(today, -1);
  const windowEnd = shiftUtcDate(today, 2);

  const normalizedEvents = eventRows.map((row) => {
    const ticker = String(row?.event_ticker || "");
    const normalizedDate = resolveGameDate(ticker, row?.game_date);
    return {
      ...row,
      event_ticker: ticker,
      game_date: normalizedDate,
    };
  });

  const staleDateFixes = eventRows
    .map((row) => {
      const eventTicker = String(row?.event_ticker || "");
      const inferred = inferSportLeague(null, null, null, eventTicker);
      return {
        eventTicker,
        currentSport: row?.sport ? String(row.sport).toLowerCase() : null,
        currentLeague: row?.league ? String(row.league).toLowerCase() : null,
        currentDate: normalizeDateLike(row?.game_date),
        parsedDate: parseDateFromEventTicker(eventTicker),
        inferredSport: inferred.sport,
        inferredLeague: inferred.league,
      };
    })
    .filter((row) => {
      const dateNeedsFix = !!row.parsedDate && row.parsedDate !== row.currentDate;
      const sportNeedsFix = !row.currentSport && !!row.inferredSport;
      const leagueNeedsFix = !row.currentLeague && !!row.inferredLeague;
      return dateNeedsFix || sportNeedsFix || leagueNeedsFix;
    });

  for (const row of staleDateFixes) {
    const patch: Record<string, any> = {};
    if (row.parsedDate && row.parsedDate !== row.currentDate) patch.game_date = row.parsedDate;
    if (!row.currentSport && row.inferredSport) patch.sport = row.inferredSport;
    if (!row.currentLeague && row.inferredLeague) patch.league = row.inferredLeague;
    if (Object.keys(patch).length === 0) continue;

    await supabase
      .from("kalshi_events_active")
      .update(patch)
      .eq("event_ticker", row.eventTicker);
  }

  const filteredEvents = normalizedEvents.filter((row) => {
    if (!matchesSportFilter(sportFilter, row?.sport || null, row?.league || null)) return false;

    const gameDate = normalizeDateLike(row?.game_date);
    if (!gameDate) return false;
    return gameDate >= windowStart && gameDate <= windowEnd;
  });

  stats.selected_events = filteredEvents.length;

  const marketCandidates: CandidateMarket[] = [];
  for (const ev of filteredEvents) {
    const tickers = Array.isArray(ev.market_tickers) ? ev.market_tickers : [];
    for (const ticker of tickers) {
      if (!ticker) continue;
      marketCandidates.push({
        eventTicker: String(ev.event_ticker),
        marketTicker: String(ticker),
        sport: ev.sport || null,
        league: ev.league || null,
        gameDate: normalizeDateLike(ev.game_date),
      });
    }
  }

  const uniqueMap = new Map<string, CandidateMarket>();
  for (const m of marketCandidates) {
    if (!uniqueMap.has(m.marketTicker)) uniqueMap.set(m.marketTicker, m);
  }

  const prioritized = Array.from(uniqueMap.values())
    .sort((a, b) => {
      if (a.eventTicker !== b.eventTicker) return a.eventTicker.localeCompare(b.eventTicker);
      return marketPriorityKey(a.marketTicker) - marketPriorityKey(b.marketTicker);
    })
    .slice(0, maxMarkets);

  stats.selected_markets = prioritized.length;

  const rows: any[] = [];
  const touchedEventTickers = new Set<string>();

  for (const candidate of prioritized) {
    stats.processed_markets++;
    const tickerEncoded = encodeURIComponent(candidate.marketTicker);

    await sleep(REQUEST_DELAY_MS);
    const marketRes = await kalshiGet(`/trade-api/v2/markets/${tickerEncoded}`, keyId, privateKeyPem);
    if (!marketRes.ok) {
      stats.errors.push(`${candidate.marketTicker}:market:${marketRes.status}:${marketRes.error.slice(0, 180)}`);
      stats.skipped_markets++;
      continue;
    }

    const market = marketRes.data?.market ?? marketRes.data ?? {};
    const marketInferred = inferSportLeague(
      getStringField(market, ["series_ticker", "seriesTicker"]),
      getStringField(market, ["title"]),
      getStringField(market, ["category"]) || getStringField(market?.product_metadata, ["competition"]),
      candidate.eventTicker,
      candidate.marketTicker
    );
    const status = getStringField(market, ["status"]);
    const snapshotType = inferSnapshotType(status, candidate.gameDate);
    const identity = classifyMarketIdentity(candidate.marketTicker, market);

    let ob: any = {
      yesLevels: [],
      noLevels: [],
      yesBestBid: null,
      yesBestBidQty: null,
      yesTotalBidQty: null,
      noBestBid: null,
      noBestBidQty: null,
      noTotalBidQty: null,
      yesNoImbalance: null,
      midPrice: null,
      spreadWidth: null,
    };

    let tr: any = {
      recentTradeCount: 0,
      recentYesVolume: 0,
      recentNoVolume: 0,
      recentVolumeImbalance: null,
      lastTradePrice: null,
      lastTradeSide: null,
      lastTradeAt: null,
    };

    if (!isFinalizedStatus(status)) {
      await sleep(REQUEST_DELAY_MS);
      const orderbookRes = await kalshiGet(`/trade-api/v2/markets/${tickerEncoded}/orderbook`, keyId, privateKeyPem);
      if (!orderbookRes.ok) {
        stats.errors.push(`${candidate.marketTicker}:orderbook:${orderbookRes.status}:${orderbookRes.error.slice(0, 180)}`);
        stats.skipped_markets++;
        continue;
      }
      ob = parseOrderbookPayload(orderbookRes.data);

      await sleep(REQUEST_DELAY_MS);
      let tradesRes = await kalshiGet(`/trade-api/v2/markets/${tickerEncoded}/trades?limit=50`, keyId, privateKeyPem);
      if (!tradesRes.ok && tradesRes.status === 404) {
        await sleep(REQUEST_DELAY_MS);
        tradesRes = await kalshiGet(`/trade-api/v2/markets/trades?ticker=${tickerEncoded}&limit=50`, keyId, privateKeyPem);
      }

      if (tradesRes.ok) {
        tr = parseTradesPayload(tradesRes.data);
      } else {
        stats.errors.push(`${candidate.marketTicker}:trades:${tradesRes.status}:${tradesRes.error.slice(0, 180)}`);
      }
    }

    const yesPrice = normalizeProbPrice(
      market?.last_price_dollars ?? market?.yes_bid_dollars ?? market?.yes_ask_dollars
    );
    let noPrice = normalizeProbPrice(market?.no_bid_dollars ?? market?.no_ask_dollars);
    if (noPrice === null && yesPrice !== null) noPrice = Number((1 - yesPrice).toFixed(6));

    rows.push({
      event_ticker: candidate.eventTicker,
      market_ticker: candidate.marketTicker,
      sport: candidate.sport || marketInferred.sport,
      league: candidate.league || marketInferred.league,

      market_type: identity.marketType,
      market_label: identity.marketLabel,
      line_value: identity.lineValue,
      line_side: identity.lineSide,

      snapshot_type: snapshotType,

      yes_best_bid: ob.yesBestBid,
      yes_best_bid_qty: ob.yesBestBidQty,
      yes_total_bid_qty: ob.yesTotalBidQty,
      yes_depth_levels: ob.yesLevels,

      no_best_bid: ob.noBestBid,
      no_best_bid_qty: ob.noBestBidQty,
      no_total_bid_qty: ob.noTotalBidQty,
      no_depth_levels: ob.noLevels,

      mid_price: ob.midPrice,
      spread_width: ob.spreadWidth,
      yes_no_imbalance: ob.yesNoImbalance,

      recent_trade_count: tr.recentTradeCount,
      recent_yes_volume: tr.recentYesVolume,
      recent_no_volume: tr.recentNoVolume,
      recent_volume_imbalance: tr.recentVolumeImbalance,
      last_trade_price: tr.lastTradePrice,
      last_trade_side: tr.lastTradeSide,
      last_trade_at: tr.lastTradeAt,

      volume: toInt(market?.volume_fp ?? market?.volume),
      open_interest: toInt(market?.open_interest_fp ?? market?.open_interest),
      yes_price: yesPrice,
      no_price: noPrice,

      captured_at: new Date().toISOString(),
    });

    touchedEventTickers.add(candidate.eventTicker);
  }

  if (rows.length > 0) {
    const { error } = await supabase
      .from("kalshi_orderbook_snapshots")
      .insert(rows);

    if (error) {
      stats.errors.push(`snapshot_insert:${error.message}`);
    } else {
      stats.rows_inserted = rows.length;
    }
  }

  if (touchedEventTickers.size > 0) {
    await supabase
      .from("kalshi_events_active")
      .update({ last_snapshot_at: new Date().toISOString() })
      .in("event_ticker", Array.from(touchedEventTickers));
  }

  return stats;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const payload = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    const phase: Phase = ["discover", "snapshot", "both"].includes(String(payload?.phase || "").toLowerCase())
      ? (String(payload.phase).toLowerCase() as Phase)
      : "snapshot";

    const sportFilter = mapSportFilter(payload?.sport);
    const eventTickersOverride = Array.isArray(payload?.event_tickers)
      ? payload.event_tickers.map((v: any) => String(v).trim()).filter(Boolean)
      : [];
    const maxMarkets = Math.min(DEFAULT_MAX_MARKETS, Math.max(1, toInt(payload?.max_markets) || DEFAULT_MAX_MARKETS));

    const keyId = Deno.env.get("KALSHI_API_KEY_ID") || null;
    const privateKeyPem = Deno.env.get("KALSHI_RSA_PRIVATE_KEY") || null;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    let discovery: any = null;
    let snapshot: any = null;

    if (phase === "discover" || phase === "both") {
      discovery = await discoverPhase(supabase, keyId, privateKeyPem, sportFilter, eventTickersOverride);
    }

    if (phase === "snapshot" || phase === "both") {
      snapshot = await snapshotPhase(supabase, keyId, privateKeyPem, sportFilter, eventTickersOverride, maxMarkets);
    }

    return new Response(
      JSON.stringify({
        status: "ok",
        version: "2026-03-18.v2",
        phase,
        sport: sportFilter,
        discovery,
        snapshot,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ status: "error", error: e?.message || String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
