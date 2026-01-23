
export interface BookmakerOffer {
  key: string;
  title: string;
  last_update: string;
  payout: number; // Implied probability or Vig
}

export interface MarketOutcome {
  name: string;
  price: number; // American odds (e.g., -110)
  point?: number; // Spread/Total (e.g., -5.5)
}

export interface BestLine {
  price: number;
  bookmaker: string;
  point?: number;
}

export interface UnifiedMarket {
  match_id: string;
  sport_key: string;
  last_updated: string;
  
  // The "Best Line" aggregates the best available odds across all books
  best_h2h: { home: BestLine; away: BestLine; draw?: BestLine };
  best_spread: { home: BestLine; away: BestLine };
  best_total: { over: BestLine; under: BestLine };

  // Raw data for deep dive
  bookmakers: {
    title: string;
    markets: {
      h2h?: MarketOutcome[];
      spreads?: MarketOutcome[];
      totals?: MarketOutcome[];
    };
  }[];
}
