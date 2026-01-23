export type RawOdds = Record<string, any> | null | undefined;

export type NormalizedOdds = {
  source: string | null;
  provider: string | null;
  updated_at: string | null;

  // core markets
  home_ml: string | null;
  away_ml: string | null;
  draw_ml: string | null;

  home_spread: string | null;      // numeric-as-string (ex "-1.5")
  away_spread: string | null;      // numeric-as-string (ex "+1.5")
  total: string | null;            // numeric-as-string (ex "2.5")

  // derived
  spread_home_value: string | null; // numeric-as-string (ex "-1.5")
};

const isFiniteNumber = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n);

const toStr = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") {
    const s = v.trim();
    return s.length ? s : null;
  }
  if (isFiniteNumber(v)) return String(v);
  return null;
};

const normalizeAmerican = (v: unknown): string | null => {
  const s = toStr(v);
  if (!s) return null;
  // accept "+110", "-130", "110"
  const cleaned = s.replace(/\s+/g, "");
  if (!/^[+-]?\d+$/.test(cleaned)) return null;
  // standardize: "110" -> "+110"
  if (!cleaned.startsWith("+") && !cleaned.startsWith("-")) return `+${cleaned}`;
  return cleaned;
};

const extractLastNumber = (s: string): number | null => {
  // grabs last numeric token, including decimals and signed values
  const matches = s.match(/[+-]?\d+(\.\d+)?/g);
  if (!matches || matches.length === 0) return null;
  const last = Number(matches[matches.length - 1]);
  return Number.isFinite(last) ? last : null;
};

const looksLikeMoneylineInSpreadField = (spread: string): boolean => {
  // ex "TB -130" "PIT -180" "NJ -110"
  // Treat integer magnitude >= 50 as moneyline, not spread points.
  const n = extractLastNumber(spread);
  if (n === null) return false;
  return Number.isInteger(n) && Math.abs(n) >= 50;
};

export const normalizeOdds = (raw: RawOdds): NormalizedOdds => {
  const o = (raw ?? {}) as Record<string, any>;

  const source = toStr(o.source);
  const provider = toStr(o.provider);
  const updated_at = toStr(o.updated_at);

  const home_ml = normalizeAmerican(o.home_ml);
  const away_ml = normalizeAmerican(o.away_ml);
  const draw_ml = normalizeAmerican(o.draw_ml);

  // totals: accept number or string
  const total = toStr(o.total ?? o.over_under);

  // spreads:
  // - If raw spread is a team-labeled string (soccer/NBA style), parse last number.
  // - If spread field is actually moneyline (NHL ESPN fallback), ignore it.
  const spreadStr = toStr(o.spread);
  const spreadHomeValue =
    spreadStr && !looksLikeMoneylineInSpreadField(spreadStr)
      ? extractLastNumber(spreadStr)
      : isFiniteNumber(o.spread_home_value)
        ? o.spread_home_value
        : typeof o.spread_home_value === "string"
          ? Number(o.spread_home_value)
          : null;

  const spread_home_value = spreadHomeValue === null ? null : String(spreadHomeValue);

  // If API gives explicit home_spread/away_spread, prefer those.
  const home_spread = toStr(o.home_spread ?? o.spread_home);
  const away_spread = toStr(o.away_spread ?? o.spread_away);

  return {
    source,
    provider,
    updated_at,
    home_ml,
    away_ml,
    draw_ml,
    home_spread,
    away_spread,
    total,
    spread_home_value,
  };
};

// Quality gate: never accept an “empty” odds payload over a populated one.
export const isEmptyOddsPayload = (n: NormalizedOdds): boolean => {
  const hasAny =
    !!n.home_ml ||
    !!n.away_ml ||
    !!n.draw_ml ||
    !!n.total ||
    !!n.home_spread ||
    !!n.away_spread ||
    !!n.spread_home_value;
  const providerNone = (n.provider ?? "").toLowerCase() === "none";
  return !hasAny || providerNone;
};

export const chooseBetterOdds = (prevRaw: RawOdds, nextRaw: RawOdds): RawOdds => {
  const prev = normalizeOdds(prevRaw);
  const next = normalizeOdds(nextRaw);

  // If next is empty, keep prev.
  if (isEmptyOddsPayload(next)) return prevRaw ?? {};

  // If prev is empty and next has data, take next.
  if (isEmptyOddsPayload(prev)) return nextRaw ?? {};

  // Prefer the more recently updated odds.
  const prevT = prev.updated_at ? Date.parse(prev.updated_at) : 0;
  const nextT = next.updated_at ? Date.parse(next.updated_at) : 0;
  if (nextT >= prevT) return nextRaw ?? {};

  return prevRaw ?? {};
};