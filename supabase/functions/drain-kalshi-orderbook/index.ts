declare const Deno: any;

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const KALSHI_BASE_URL = Deno.env.get("KALSHI_BASE_URL") || "https://trading-api.kalshi.com";
const MAX_MARKETS_PER_RUN = 30;
const REQUEST_DELAY_MS = 150;

const TODAY_UTC = () => new Date().toISOString().slice(0, 10);

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

function parseLevel(raw: any): { price: number; qty: number } | null {
  if (Array.isArray(raw)) {
    const price = normalizeProbPrice(raw[0]);
    const qty = toInt(raw[1] ?? raw[2]);
    if (price === null || qty === null) return null;
    return { price, qty };
  }

  const price = normalizeProbPrice(
    raw?.price ?? raw?.yes_price_dollars ?? raw?.no_price_dollars ?? raw?.bid ?? raw?.px
  );
  const qty = toInt(raw?.qty ?? raw?.quantity ?? raw?.count ?? raw?.size ?? raw?.volume ?? raw?.contracts);
  if (price === null || qty === null) return null;
  return { price, qty };
}

function parseSideLevels(rawSide: any): Array<{ price: number; qty: number }> {
  if (!Array.isArray(rawSide)) return [];
  const parsed = rawSide
    .map(parseLevel)
    .filter((lvl): lvl is { price: number; qty: number } => lvl !== null)
    .sort((a, b) => b.price - a.price)
    .slice(0, 5);
  return parsed;
}

function parseOrderbookPayload(payload: any) {
  const root = payload?.orderbook ?? payload?.data?.orderbook ?? payload ?? {};

  const yesRaw = root?.yes ?? root?.yes_bids ?? root?.yes_levels ?? root?.bids_yes ?? [];
  const noRaw = root?.no ?? root?.no_bids ?? root?.no_levels ?? root?.bids_no ?? [];

  const yesLevels = parseSideLevels(yesRaw);
  const noLevels = parseSideLevels(noRaw);

  const yesTotal = yesLevels.reduce((sum, level) => sum + level.qty, 0);
  const noTotal = noLevels.reduce((sum, level) => sum + level.qty, 0);
  const imbalanceDen = yesTotal + noTotal;

  return {
    yesLevels,
    noLevels,
    yesBestBid: yesLevels[0]?.price ?? null,
    yesBestBidQty: yesLevels[0]?.qty ?? null,
    yesTotalBidQty: yesTotal || null,
    noBestBid: noLevels[0]?.price ?? null,
    noBestBidQty: noLevels[0]?.qty ?? null,
    noTotalBidQty: noTotal || null,
    yesNoImbalance: imbalanceDen > 0 ? Number((yesTotal / imbalanceDen).toFixed(6)) : null,
    volume: toInt(
      payload?.volume ?? payload?.data?.volume ?? payload?.market?.volume ?? payload?.orderbook?.volume
    ),
    openInterest: toInt(
      payload?.open_interest ?? payload?.openInterest ?? payload?.data?.open_interest ?? payload?.market?.open_interest
    ),
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
      const tradePrice = side === "yes"
        ? (yesPrice ?? genericPrice)
        : side === "no"
        ? (noPrice ?? genericPrice)
        : (genericPrice ?? yesPrice ?? noPrice);
      const createdAt = String(trade?.created_time ?? trade?.created_at ?? "");
      const createdTs = new Date(createdAt).getTime();

      return {
        side,
        qty,
        tradePrice,
        createdTs: Number.isFinite(createdTs) ? createdTs : 0,
      };
    })
    .sort((a: any, b: any) => b.createdTs - a.createdTs)
    .slice(0, 50);

  const yesVolume = trades.reduce((sum: number, t: any) => sum + (t.side === "yes" ? t.qty : 0), 0);
  const noVolume = trades.reduce((sum: number, t: any) => sum + (t.side === "no" ? t.qty : 0), 0);
  const volDen = yesVolume + noVolume;

  return {
    recentTradeCount: trades.length,
    recentYesVolume: yesVolume,
    recentNoVolume: noVolume,
    recentVolumeImbalance: volDen > 0 ? Number((yesVolume / volDen).toFixed(6)) : null,
    lastTradePrice: trades[0]?.tradePrice ?? null,
    lastTradeSide: trades[0]?.side ?? null,
  };
}

function inferSnapshotType(statusValue: string | null, gameDate: string | null): "pregame" | "live" | "settled" {
  const status = (statusValue || "").toLowerCase();
  if (status.includes("settl") || status.includes("close") || status.includes("final") || status.includes("expire")) {
    return "settled";
  }
  if (status.includes("live") || status.includes("in_progress") || status.includes("trading")) {
    return "live";
  }
  if (gameDate && gameDate < TODAY_UTC()) {
    return "settled";
  }
  return "pregame";
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const base64 = pem
    .replace(/-----BEGIN[^-]+-----/g, "")
    .replace(/-----END[^-]+-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function signKalshiMessage(message: string, privateKeyPem: string): Promise<string> {
  const keyBuffer = pemToArrayBuffer(privateKeyPem);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    keyBuffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signatureBuffer = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(message)
  );
  return toBase64(new Uint8Array(signatureBuffer));
}

async function kalshiGet(
  pathWithQuery: string,
  keyId: string,
  privateKeyPem: string
): Promise<{ ok: true; data: any } | { ok: false; status: number; error: string }> {
  try {
    const ts = Date.now().toString();
    const signature = await signKalshiMessage(`${ts}GET${pathWithQuery}`, privateKeyPem);
    const res = await fetch(`${KALSHI_BASE_URL}${pathWithQuery}`, {
      headers: {
        "KALSHI-ACCESS-KEY": keyId,
        "KALSHI-ACCESS-TIMESTAMP": ts,
        "KALSHI-ACCESS-SIGNATURE": signature,
      },
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) {
      return { ok: false, status: res.status, error: await res.text() };
    }

    return { ok: true, data: await res.json() };
  } catch (err: any) {
    return { ok: false, status: 0, error: err?.message || String(err) };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const payload = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const bodyTickers = Array.isArray(payload?.market_tickers)
      ? payload.market_tickers.map((x: any) => String(x).trim()).filter(Boolean)
      : [];

    const keyId = Deno.env.get("KALSHI_API_KEY_ID") || "";
    const privateKeyPem = Deno.env.get("KALSHI_RSA_PRIVATE_KEY") || "";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const stats = {
      selected_markets: 0,
      processed_markets: 0,
      rows_inserted: 0,
      skipped_markets: 0,
      errors: [] as string[],
    };

    const marketRows: Array<any> = [];

    if (bodyTickers.length === 0) {
      const { data, error } = await supabase
        .from("kalshi_line_markets")
        .select("*")
        .limit(500);

      if (error) {
        return new Response(
          JSON.stringify({ status: "error", error: `kalshi_line_markets_lookup_failed: ${error.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const today = TODAY_UTC();
      const active = (data || []).filter((row: any) => {
        const status = (getStringField(row, ["status", "market_status", "state", "marketState"]) || "").toLowerCase();
        const gameDate = normalizeDateLike(
          row?.game_date ?? row?.date ?? row?.start_date ?? row?.starts_at ?? row?.start_time
        );
        const statusOpen =
          status.includes("open") || status.includes("active") || status.includes("live") || status.includes("trading");
        return statusOpen || gameDate === today;
      });

      marketRows.push(...active);
    }

    const manualRows = bodyTickers.map((ticker: string) => ({ market_ticker: ticker }));
    marketRows.push(...manualRows);

    const seen = new Set<string>();
    const markets = marketRows
      .map((row: any) => {
        const marketTicker = getStringField(row, ["market_ticker", "ticker", "kalshi_ticker", "marketTicker"]);
        if (!marketTicker) return null;

        const eventTicker = getStringField(row, ["event_ticker", "eventTicker", "event_ticker_id"]) ||
          marketTicker.split("-").slice(0, 2).join("-") || marketTicker;

        const sport = getStringField(row, ["sport", "league_sport", "market_sport"]);
        const status = getStringField(row, ["status", "market_status", "state", "marketState"]);
        const gameDate = normalizeDateLike(
          row?.game_date ?? row?.date ?? row?.start_date ?? row?.starts_at ?? row?.start_time
        );

        return {
          marketTicker,
          eventTicker,
          sport,
          status,
          gameDate,
        };
      })
      .filter((m): m is { marketTicker: string; eventTicker: string; sport: string | null; status: string | null; gameDate: string | null } => !!m)
      .filter((m) => {
        if (seen.has(m.marketTicker)) return false;
        seen.add(m.marketTicker);
        return true;
      })
      .slice(0, Math.min(MAX_MARKETS_PER_RUN, toInt(payload?.max_markets) || MAX_MARKETS_PER_RUN));

    stats.selected_markets = markets.length;

    if (!keyId || !privateKeyPem) {
      return new Response(
        JSON.stringify({
          status: "ok",
          reason: "kalshi_credentials_missing",
          ...stats,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const rowsToInsert: Array<any> = [];

    for (const market of markets) {
      stats.processed_markets++;

      const snapshotType = inferSnapshotType(market.status, market.gameDate);
      const tickerEncoded = encodeURIComponent(market.marketTicker);

      await sleep(REQUEST_DELAY_MS);
      const orderbookRes = await kalshiGet(`/trade-api/v2/markets/${tickerEncoded}/orderbook`, keyId, privateKeyPem);
      if (!orderbookRes.ok) {
        stats.errors.push(`${market.marketTicker}:orderbook:${orderbookRes.status}:${orderbookRes.error.slice(0, 180)}`);
        stats.skipped_markets++;
        continue;
      }

      await sleep(REQUEST_DELAY_MS);
      let tradesRes = await kalshiGet(`/trade-api/v2/markets/${tickerEncoded}/trades?limit=50`, keyId, privateKeyPem);
      if (!tradesRes.ok && tradesRes.status === 404) {
        await sleep(REQUEST_DELAY_MS);
        tradesRes = await kalshiGet(`/trade-api/v2/markets/trades?ticker=${tickerEncoded}&limit=50`, keyId, privateKeyPem);
      }

      if (!tradesRes.ok) {
        stats.errors.push(`${market.marketTicker}:trades:${tradesRes.status}:${tradesRes.error.slice(0, 180)}`);
        stats.skipped_markets++;
        continue;
      }

      const ob = parseOrderbookPayload(orderbookRes.data);
      const tr = parseTradesPayload(tradesRes.data);

      rowsToInsert.push({
        market_ticker: market.marketTicker,
        event_ticker: getStringField(orderbookRes.data, ["event_ticker", "eventTicker"]) || market.eventTicker,
        sport: market.sport,
        snapshot_type: snapshotType,

        yes_best_bid: ob.yesBestBid,
        yes_best_bid_qty: ob.yesBestBidQty,
        yes_total_bid_qty: ob.yesTotalBidQty,
        yes_depth_levels: ob.yesLevels,

        no_best_bid: ob.noBestBid,
        no_best_bid_qty: ob.noBestBidQty,
        no_total_bid_qty: ob.noTotalBidQty,
        no_depth_levels: ob.noLevels,

        yes_no_imbalance: ob.yesNoImbalance,

        recent_trade_count: tr.recentTradeCount,
        recent_yes_volume: tr.recentYesVolume,
        recent_no_volume: tr.recentNoVolume,
        recent_volume_imbalance: tr.recentVolumeImbalance,
        last_trade_price: tr.lastTradePrice,
        last_trade_side: tr.lastTradeSide,

        volume: ob.volume,
        open_interest: ob.openInterest,
        captured_at: new Date().toISOString(),
      });
    }

    if (rowsToInsert.length > 0) {
      const { error: insertErr } = await supabase
        .from("kalshi_orderbook_snapshots")
        .insert(rowsToInsert);

      if (insertErr) {
        return new Response(
          JSON.stringify({ status: "error", error: `insert_failed:${insertErr.message}`, ...stats }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    stats.rows_inserted = rowsToInsert.length;

    return new Response(
      JSON.stringify({ status: "ok", version: "2026-03-18.v1", ...stats }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ status: "error", error: e?.message || String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
