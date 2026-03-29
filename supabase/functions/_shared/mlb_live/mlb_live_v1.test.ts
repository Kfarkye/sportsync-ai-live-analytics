import { describe, expect, it } from "vitest";
import { formatMlbInsight, validateMlbInsightFormat } from "./formatter";
import { evaluateSpeakSilentPolicy } from "./policy";
import { evaluateMlbTriggers } from "./triggers";
import { type CanonicalMlbGameObject, validateCanonicalObjectShape } from "./types";

function fixtureGame(): CanonicalMlbGameObject {
  return {
    game_id: "401696999_mlb",
    game_url: "https://sportsync-evidence.web.app/mlb/game/401696999_mlb",
    start_time_utc: "2026-03-29T20:10:00Z",
    status: "STATUS_IN_PROGRESS",
    teams: {
      home: { name: "Seattle Mariners", abbreviation: "SEA", score: 3 },
      away: { name: "Cleveland Guardians", abbreviation: "CLE", score: 2 },
    },
    market: {
      opening: {
        total: 7.5,
        home_moneyline: -156,
        away_moneyline: 129,
        home_run_line: -1.5,
        away_run_line: 1.5,
        source: "opening",
        captured_at: "2026-03-29T12:02:10Z",
      },
      current: {
        total: 8.5,
        home_moneyline: -145,
        away_moneyline: 120,
        home_run_line: -1.5,
        away_run_line: 1.5,
        source: "live",
        captured_at: "2026-03-29T21:43:02Z",
      },
    },
    environment: {
      pregame: {
        weather_summary: "open roof",
        temperature_f: 58,
        wind_mph: 8,
        wind_direction: "out",
        roof_state: "open",
        park_name: "T-Mobile Park",
        run_environment_index: 1,
      },
      live: {
        weather_summary: "wind increasing",
        temperature_f: 61,
        wind_mph: 14,
        wind_direction: "out",
        roof_state: "open",
        park_name: "T-Mobile Park",
        run_environment_index: 1.29,
      },
      delta_run_environment: 0.29,
    },
    lineups: {
      home: {
        team: "Seattle Mariners",
        confirmed: true,
        confidence_score: 0.9,
        source: "espn_summary",
        source_url: null,
        captured_at: null,
        batting_order: [
          { order: 1, player_id: "1", player_name: "A", position: "CF", bats: "R", starter: true },
        ],
      },
      away: {
        team: "Cleveland Guardians",
        confirmed: true,
        confidence_score: 0.91,
        source: "espn_summary",
        source_url: null,
        captured_at: null,
        batting_order: [
          { order: 1, player_id: "2", player_name: "B", position: "LF", bats: "L", starter: true },
        ],
      },
    },
    starters: {
      home: { name: "L. Castillo", espn_player_id: "1", hand: "R", era: 3.44, whip: 1.12, pitch_count: null },
      away: { name: "T. Bibee", espn_player_id: "2", hand: "R", era: 3.78, whip: 1.2, pitch_count: null },
    },
    bullpens: {
      home: { team: "Seattle Mariners", fatigue_score: 75, avg_pitches_last_3: 42, avg_pitchers_used_last_3: 3.3, sample_games: 3 },
      away: { team: "Cleveland Guardians", fatigue_score: 62, avg_pitches_last_3: 35, avg_pitchers_used_last_3: 2.9, sample_games: 3 },
    },
    pregame_edges: [],
    live_state: {
      inning: 5,
      half: "top",
      outs: 1,
      balls: 2,
      strikes: 1,
      runners: { on_first: true, on_second: false, on_third: false },
      current_pitcher: { name: "L. Castillo", espn_player_id: "1", hand: "R", pitch_count: 93 },
      due_up: [
        { player_name: "Hitter 1", bats: "L" },
        { player_name: "Hitter 2", bats: "L" },
        { player_name: "Hitter 3", bats: "R" },
      ],
      recent_pitch_sequence: new Array(15).fill(0).map((_, i) => ({
        sequence: i + 1,
        result: i % 3 === 0 ? "ball" : "called_strike",
        pitch_type: "Fastball",
        mph: 95,
        is_first_pitch: i % 2 === 0,
        text: "Pitch event",
      })),
      recent_control_state: {
        sample_size: 15,
        ball_rate_last_15: 46.7,
        first_strike_rate_last_15: 44.4,
      },
      current_market_snapshot: {
        total: 8.5,
        home_moneyline: -145,
        away_moneyline: 120,
        home_run_line: -1.5,
        away_run_line: 1.5,
        source: "live",
        captured_at: "2026-03-29T21:43:02Z",
      },
    },
    data_gaps: [],
  };
}

describe("MLB Live URL Context V1", () => {
  it("validates canonical object shape", () => {
    const payload = fixtureGame();
    const check = validateCanonicalObjectShape(payload);
    expect(check.ok).toBe(true);
    expect(check.errors).toHaveLength(0);
  });

  it("fires pitch_count_stress deterministically", () => {
    const results = evaluateMlbTriggers(fixtureGame());
    const trigger = results.find((row) => row.trigger_name === "pitch_count_stress");
    expect(trigger).toBeTruthy();
    expect(trigger?.fired).toBe(true);
    expect(trigger?.implemented).toBe(true);
  });

  it("enforces strict 3-part output format", () => {
    const results = evaluateMlbTriggers(fixtureGame());
    const chosen = results.find((row) => row.fired && row.implemented)!;
    const formatted = formatMlbInsight(fixtureGame(), chosen);
    const validation = validateMlbInsightFormat(formatted);
    expect(validation.ok).toBe(true);
    expect(formatted.text).toContain("What changed:");
    expect(formatted.text).toContain("Why it matters:");
    expect(formatted.text).toContain("What to watch now:");
  });

  it("silences repeats inside cooldown without severity escalation", () => {
    const results = evaluateMlbTriggers(fixtureGame());
    const decision = evaluateSpeakSilentPolicy(
      results,
      {
        pitch_count_stress: {
          trigger: "pitch_count_stress",
          ts_utc: new Date().toISOString(),
          severity: "medium",
        },
      },
      new Date(),
    );
    expect(decision.speak).toBe(false);
    expect(decision.cooldown_blocked).toBe(true);
  });

  it("allows speak on severity escalation even in cooldown", () => {
    const game = fixtureGame();
    game.live_state.current_pitcher.pitch_count = 106;
    const results = evaluateMlbTriggers(game);
    const decision = evaluateSpeakSilentPolicy(
      results,
      {
        pitch_count_stress: {
          trigger: "pitch_count_stress",
          ts_utc: new Date().toISOString(),
          severity: "medium",
        },
      },
      new Date(),
    );
    expect(decision.speak).toBe(true);
    expect(decision.severity_escalated).toBe(true);
  });
});
