// supabase/functions/_shared/soccer-odds-normalizer.ts
// Normalizes soccer odds from various key formats into a consistent shape

export type NormalizedSoccerMarkets = {
    spread: number | null;   // home spread (e.g., -0.75)
    total: number | null;    // match total (e.g., 2.5)
    homeMl: string | null;
    awayMl: string | null;
    drawMl: string | null;
};

const num = (v: any): number | null => {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

const str = (v: any): string | null => {
    if (v == null) return null;
    const s = String(v).trim();
    return s ? s : null;
};

export function normalizeSoccerOdds(current_odds: any): NormalizedSoccerMarkets {
    const o = current_odds || {};

    // Moneyline / 3-way (common variants)
    const homeMl =
        str(o.homeMl) ??
        str(o.home_ml) ??
        str(o.homeWin) ??
        str(o.home_win) ??
        str(o.best_h2h?.home?.price) ??
        str(o.h2h?.home) ??
        null;

    const awayMl =
        str(o.awayMl) ??
        str(o.away_ml) ??
        str(o.awayWin) ??
        str(o.away_win) ??
        str(o.best_h2h?.away?.price) ??
        str(o.h2h?.away) ??
        null;

    const drawMl =
        str(o.drawMl) ??
        str(o.draw_ml) ??
        str(o.draw) ??
        str(o.best_h2h?.draw?.price) ??
        str(o.h2h?.draw) ??
        null;

    // Spread (home side) – multiple key variants
    const spread =
        num(o.homeSpread) ??
        num(o.awaySpread) ??
        num(o.spread) ??
        num(o.spread_home) ??
        num(o.spread_home_value) ??
        num(o.home_spread) ??
        num(o.spread_best?.home?.point) ??
        num(o.spread_best?.home?.line) ??
        null;

    // Total – multiple key variants
    const total =
        num(o.total) ??
        num(o.total_value) ??
        num(o.overUnder) ??
        num(o.over_under) ??
        num(o.gameTotal) ??
        num(o.total_best?.over?.point) ??
        num(o.total_best?.over?.line) ??
        null;

    return { spread, total, homeMl, awayMl, drawMl };
}
