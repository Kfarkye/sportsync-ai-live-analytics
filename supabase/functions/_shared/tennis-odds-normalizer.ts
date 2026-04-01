// supabase/functions/_shared/tennis-odds-normalizer.ts
// Normalizes tennis odds from various key formats into a consistent shape

export type NormalizedTennisMarkets = {
    spread: number | null;   // games handicap (home side)
    total: number | null;    // total games
    homeMl: string | null;
    awayMl: string | null;
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

export function normalizeTennisOdds(current_odds: any): NormalizedTennisMarkets {
    const o = current_odds || {};

    // Moneyline (common variants)
    const homeMl =
        str(o.homeMl) ??
        str(o.home_ml) ??
        str(o.homeWin) ??
        str(o.best_h2h?.home?.price) ??
        null;

    const awayMl =
        str(o.awayMl) ??
        str(o.away_ml) ??
        str(o.awayWin) ??
        str(o.best_h2h?.away?.price) ??
        null;

    // Games handicap / spread (home side) – variants
    const spread =
        num(o.gamesHandicap) ??
        num(o.homeGamesHandicap) ??
        num(o.spread_home_value) ??
        num(o.homeSpread) ??
        num(o.spread) ??
        null;

    // Total games – variants
    const total =
        num(o.totalGames) ??
        num(o.gamesTotal) ??
        num(o.total_value) ??
        num(o.total) ??
        null;

    return { spread, total, homeMl, awayMl };
}
