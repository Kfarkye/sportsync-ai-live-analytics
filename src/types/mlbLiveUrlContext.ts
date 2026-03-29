export interface MlbLineupPlayer {
  order: number | null;
  player_name: string;
  position: string | null;
  bats: string | null;
}

export interface MlbLineupSide {
  team: string | null;
  confirmed: boolean | null;
  confidence_score: number | null;
  source: string | null;
  source_url: string | null;
  captured_at: string | null;
  batting_order: MlbLineupPlayer[];
}

export interface MlbGameCanonical {
  game_id: string;
  game_url: string;
  start_time_utc: string | null;
  status: string;
  teams: {
    home: { name: string | null; abbreviation: string | null; score: number | null };
    away: { name: string | null; abbreviation: string | null; score: number | null };
  };
  market: {
    opening: {
      total: number | null;
      home_moneyline: number | null;
      away_moneyline: number | null;
      home_run_line: number | null;
      away_run_line: number | null;
    };
    current: {
      total: number | null;
      home_moneyline: number | null;
      away_moneyline: number | null;
      home_run_line: number | null;
      away_run_line: number | null;
    };
  };
  environment: {
    pregame: {
      weather_summary: string | null;
      temperature_f: number | null;
      wind_mph: number | null;
      wind_direction: string | null;
      roof_state: string | null;
      park_name: string | null;
      run_environment_index: number | null;
    };
    live: {
      weather_summary: string | null;
      temperature_f: number | null;
      wind_mph: number | null;
      wind_direction: string | null;
      roof_state: string | null;
      park_name: string | null;
      run_environment_index: number | null;
    };
    delta_run_environment: number | null;
  };
  lineups: {
    home: MlbLineupSide | null;
    away: MlbLineupSide | null;
  };
  starters: {
    home: { name: string | null; hand: string | null; era: number | null; whip: number | null } | null;
    away: { name: string | null; hand: string | null; era: number | null; whip: number | null } | null;
  };
  bullpens: {
    home: {
      team: string | null;
      fatigue_score: number | null;
      avg_pitches_last_3: number | null;
      avg_pitchers_used_last_3: number | null;
      sample_games: number;
    } | null;
    away: {
      team: string | null;
      fatigue_score: number | null;
      avg_pitches_last_3: number | null;
      avg_pitchers_used_last_3: number | null;
      sample_games: number;
    } | null;
  };
  pregame_edges: Array<{
    edge_key: string;
    title: string;
    detail: string;
    market_relevance: "low" | "medium" | "high";
  }>;
  live_state: {
    inning: number | null;
    half: "top" | "bottom" | null;
    outs: number | null;
    balls: number | null;
    strikes: number | null;
    runners: {
      on_first: boolean | null;
      on_second: boolean | null;
      on_third: boolean | null;
    };
    current_pitcher: {
      name: string | null;
      hand: string | null;
      pitch_count: number | null;
    };
    due_up: Array<{
      player_name: string | null;
      bats: string | null;
    }>;
  };
  data_gaps: string[];
}

export interface MlbLiveUrlContextResponse {
  status: "ok";
  game_id: string;
  game_url: string;
  generated_at: string;
  duration_ms: number;
  canonical_game: MlbGameCanonical;
  trigger_results: Array<{
    trigger_name: string;
    fired: boolean;
    implemented: boolean;
    severity: "low" | "medium" | "high";
    supporting_facts: Record<string, unknown>;
    partial_reason: string | null;
    confidence_inputs: {
      score: number;
      market_relevance: boolean;
      reasons: string[];
    };
  }>;
  live_output: {
    what_changed: string;
    why_it_matters: string;
    what_to_watch_now: string;
    text: string;
  } | null;
}
