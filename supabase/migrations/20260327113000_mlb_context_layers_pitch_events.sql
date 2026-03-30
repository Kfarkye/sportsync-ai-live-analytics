-- MLB context-layer foundation:
-- 1) mlb_pitch_events: pitch-level event tape from ESPN summary plays
-- 2) mlb_game_context_layers: one row per game with starter leash, bullpen load,
--    weather/park, handedness + pitch-type, and umpire-zone proxies
-- 3) v_mlb_layer_use_case_rank: explicit feature hierarchy by betting use case

CREATE TABLE IF NOT EXISTS public.mlb_pitch_events (
  id text PRIMARY KEY,
  match_id text NOT NULL,
  espn_event_id text NOT NULL,
  sequence_number integer,
  at_bat_id text,
  at_bat_pitch_number integer,
  inning_number integer,
  inning_half text,
  wallclock timestamptz,
  pitcher_athlete_id text,
  batter_athlete_id text,
  batter_side text,
  pitch_type_id text,
  pitch_type text,
  pitch_type_abbr text,
  pitch_velocity integer,
  pitch_coord_x numeric,
  pitch_coord_y numeric,
  trajectory text,
  pre_balls integer,
  pre_strikes integer,
  post_balls integer,
  post_strikes integer,
  outs integer,
  play_type text,
  play_text text,
  scoring_play boolean,
  score_value integer,
  away_score integer,
  home_score integer,
  is_called_strike boolean,
  is_ball boolean,
  is_swinging_strike boolean,
  is_foul boolean,
  is_in_play boolean,
  drain_version text,
  last_drained_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mlb_pitch_events_match_seq
  ON public.mlb_pitch_events (match_id, sequence_number);
CREATE INDEX IF NOT EXISTS idx_mlb_pitch_events_pitcher
  ON public.mlb_pitch_events (pitcher_athlete_id, wallclock DESC);
CREATE INDEX IF NOT EXISTS idx_mlb_pitch_events_batter
  ON public.mlb_pitch_events (batter_athlete_id, wallclock DESC);
CREATE INDEX IF NOT EXISTS idx_mlb_pitch_events_pitch_type
  ON public.mlb_pitch_events (pitch_type_abbr);
CREATE INDEX IF NOT EXISTS idx_mlb_pitch_events_inning
  ON public.mlb_pitch_events (match_id, inning_number, inning_half);

CREATE TABLE IF NOT EXISTS public.mlb_game_context_layers (
  match_id text PRIMARY KEY,
  espn_event_id text,
  start_time timestamptz,
  game_date date,
  season_type text,
  home_team text,
  away_team text,
  venue text,
  venue_city text,
  venue_state text,
  venue_indoor boolean,
  weather_temp integer,
  weather_condition text,
  weather_gust integer,
  weather_precipitation integer,
  home_plate_umpire text,
  home_plate_umpire_id text,
  umpire_called_strike_rate numeric,
  umpire_ball_rate numeric,
  umpire_total_called_pitches integer,
  home_starter_id text,
  home_starter_name text,
  away_starter_id text,
  away_starter_name text,
  home_starter_pitch_count integer,
  away_starter_pitch_count integer,
  home_starter_outs integer,
  away_starter_outs integer,
  home_starter_pitches_per_out numeric,
  away_starter_pitches_per_out numeric,
  home_starter_leash_bucket text,
  away_starter_leash_bucket text,
  home_bullpen_pitchers_used integer,
  away_bullpen_pitchers_used integer,
  home_bullpen_outs integer,
  away_bullpen_outs integer,
  home_bullpen_pitches integer,
  away_bullpen_pitches integer,
  home_pitch_types_used integer,
  away_pitch_types_used integer,
  home_pitch_pct_vs_lhb numeric,
  home_pitch_pct_vs_rhb numeric,
  away_pitch_pct_vs_lhb numeric,
  away_pitch_pct_vs_rhb numeric,
  home_primary_pitch text,
  away_primary_pitch text,
  home_primary_pitch_share numeric,
  away_primary_pitch_share numeric,
  pitch_events_count integer,
  data_quality_tier text,
  source text,
  drain_version text,
  last_drained_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mlb_game_context_layers_game_date
  ON public.mlb_game_context_layers (game_date DESC);
CREATE INDEX IF NOT EXISTS idx_mlb_game_context_layers_teams
  ON public.mlb_game_context_layers (home_team, away_team, game_date DESC);
CREATE INDEX IF NOT EXISTS idx_mlb_game_context_layers_umpire
  ON public.mlb_game_context_layers (home_plate_umpire_id, game_date DESC);
CREATE INDEX IF NOT EXISTS idx_mlb_game_context_layers_quality
  ON public.mlb_game_context_layers (data_quality_tier, game_date DESC);

ALTER TABLE public.mlb_pitch_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mlb_game_context_layers ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'mlb_pitch_events'
      AND policyname = 'service_role_all_mlb_pitch_events'
  ) THEN
    EXECUTE 'CREATE POLICY service_role_all_mlb_pitch_events
      ON public.mlb_pitch_events
      FOR ALL
      USING ((SELECT auth.role()) = ''service_role'')';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'mlb_pitch_events'
      AND policyname = 'public_read_mlb_pitch_events'
  ) THEN
    EXECUTE 'CREATE POLICY public_read_mlb_pitch_events
      ON public.mlb_pitch_events
      FOR SELECT
      USING (true)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'mlb_game_context_layers'
      AND policyname = 'service_role_all_mlb_game_context_layers'
  ) THEN
    EXECUTE 'CREATE POLICY service_role_all_mlb_game_context_layers
      ON public.mlb_game_context_layers
      FOR ALL
      USING ((SELECT auth.role()) = ''service_role'')';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'mlb_game_context_layers'
      AND policyname = 'public_read_mlb_game_context_layers'
  ) THEN
    EXECUTE 'CREATE POLICY public_read_mlb_game_context_layers
      ON public.mlb_game_context_layers
      FOR SELECT
      USING (true)';
  END IF;
END
$$;

CREATE OR REPLACE VIEW public.v_mlb_layer_use_case_rank AS
SELECT *
FROM (
  VALUES
    -- Totals
    ('totals'::text, 1, 'bullpen_state', 'Bullpen State', 0.24::numeric, 'Reliever quality/availability drives late run environment.'),
    ('totals', 2, 'starter_leash', 'Starter Leash + Pitch Count', 0.22::numeric, 'Transition timing changes total variance before books fully reprice.'),
    ('totals', 3, 'weather_park', 'Weather + Park', 0.20::numeric, 'Run environment shifts with wind, temp, and park carry.'),
    ('totals', 4, 'lineup_pitch_type_fit', 'L/R + Pitch-Type Fit', 0.18::numeric, 'Lineup-pitch mix fit changes expected contact quality.'),
    ('totals', 5, 'umpire_zone', 'Umpire Zone', 0.16::numeric, 'Called-zone tendencies alter BB/K and plate appearance depth.'),
    -- Side
    ('side', 1, 'starter_baseline', 'Starting Pitcher Baseline', 0.29::numeric, 'Most direct edge anchor before bullpen transition.'),
    ('side', 2, 'starter_leash', 'Starter Leash + Pitch Count', 0.22::numeric, 'Manager pull risk can flip side edge before 7th inning.'),
    ('side', 3, 'bullpen_state', 'Bullpen State', 0.21::numeric, 'Late leverage innings decide one-run outcomes.'),
    ('side', 4, 'lineup_pitch_type_fit', 'L/R + Pitch-Type Fit', 0.16::numeric, 'Team-specific fit creates asymmetric run scoring.'),
    ('side', 5, 'weather_park', 'Weather + Park', 0.07::numeric, 'Secondary side driver via run-scoring volatility.'),
    ('side', 6, 'umpire_zone', 'Umpire Zone', 0.05::numeric, 'Zone profile nudges walk/strikeout balance.'),
    -- First 5
    ('first_5', 1, 'starter_baseline', 'Starting Pitcher Baseline', 0.42::numeric, 'F5 is starter-dominant by design.'),
    ('first_5', 2, 'starter_leash', 'Starter Leash + Pitch Count', 0.24::numeric, 'Short leash can leak bullpen into F5.'),
    ('first_5', 3, 'lineup_pitch_type_fit', 'L/R + Pitch-Type Fit', 0.18::numeric, 'Early sequencing depends on first two trips through lineup.'),
    ('first_5', 4, 'umpire_zone', 'Umpire Zone', 0.10::numeric, 'Zone impacts strike efficiency and inning length.'),
    ('first_5', 5, 'weather_park', 'Weather + Park', 0.06::numeric, 'Useful but less than starter-driven factors in first half.'),
    -- Live inning-by-inning
    ('live_inning', 1, 'starter_leash', 'Starter Leash + Pitch Count', 0.28::numeric, 'Immediate indicator for transition timing.'),
    ('live_inning', 2, 'bullpen_state', 'Bullpen State', 0.26::numeric, 'Live totals/side reprice around bullpen entry quality.'),
    ('live_inning', 3, 'umpire_zone', 'Umpire Zone', 0.18::numeric, 'In-game called-zone pattern updates walk/strikeout expectancy.'),
    ('live_inning', 4, 'lineup_pitch_type_fit', 'L/R + Pitch-Type Fit', 0.16::numeric, 'Pitch-mix changes become visible within game.'),
    ('live_inning', 5, 'weather_park', 'Weather + Park', 0.12::numeric, 'Still relevant, especially wind shifts and roof state.')
) AS t(use_case, layer_rank, layer_key, layer_label, weight, rationale);

GRANT SELECT ON public.mlb_pitch_events TO anon, authenticated, service_role;
GRANT SELECT ON public.mlb_game_context_layers TO anon, authenticated, service_role;
GRANT SELECT ON public.v_mlb_layer_use_case_rank TO anon, authenticated, service_role;

COMMENT ON TABLE public.mlb_pitch_events IS
'Pitch-level ESPN MLB event tape (type, velocity, location, count state, participants).';

COMMENT ON TABLE public.mlb_game_context_layers IS
'One-row MLB context layer snapshot per game: starter leash, bullpen state, weather/park, pitch mix, handedness, and umpire-zone proxies.';

COMMENT ON VIEW public.v_mlb_layer_use_case_rank IS
'Use-case feature hierarchy for MLB pricing/explanation across totals, side, first five, and live inning markets.';
