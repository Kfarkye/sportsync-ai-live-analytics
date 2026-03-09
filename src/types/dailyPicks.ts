export interface DailyPickRecord {
  match_id: string;
  home_team: string;
  away_team: string;
  league_id: string;
  start_time: string;
  play: string;
  home_rate: number;
  home_sample: number;
  away_rate: number;
  away_sample: number;
  avg_rate: number;
  pick_type: string;
  last_refreshed_at: string;
}

export interface MatchPickSummary {
  matchId: string;
  play: string;
  avgRate: number;
  homeRate: number;
  awayRate: number;
  homeSample: number;
  awaySample: number;
  pickType: string;
  lastRefreshedAt: string;
  markets: Array<{ play: string; avgRate: number }>;
  bttsRate?: number;
  o25Rate?: number;
  streakRate: number;
  streakSample: number;
}
