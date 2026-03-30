
-- ============================================================================
-- LLM-EXTRACTED REFERENCE DATA LAYER
-- Foundation tables for static/semi-static data extracted from Gemini's 
-- training corpus. These are the "free" datasets that replace $15-25K/yr
-- in commercial sports data licensing.
-- ============================================================================

-- 1. ENRICH teams TABLE
-- Add the missing columns that make `teams` a proper franchise metadata table.
-- These columns are stable (change rarely) and can be seeded from LLM memory.
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS conference text,
  ADD COLUMN IF NOT EXISTS division text,
  ADD COLUMN IF NOT EXISTS venue_name text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS state_province text,
  ADD COLUMN IF NOT EXISTS established_year integer,
  ADD COLUMN IF NOT EXISTS sport text;

COMMENT ON COLUMN public.teams.conference IS 'AFC/NFC, Eastern/Western, AL/NL, etc.';
COMMENT ON COLUMN public.teams.division IS 'Division within conference (e.g., NFC North, Pacific, AL East)';
COMMENT ON COLUMN public.teams.venue_name IS 'Current primary venue/arena/stadium name';
COMMENT ON COLUMN public.teams.city IS 'Market city (e.g., Los Angeles, Green Bay)';
COMMENT ON COLUMN public.teams.state_province IS 'US state or Canadian province code';
COMMENT ON COLUMN public.teams.established_year IS 'Year franchise was established/founded';
COMMENT ON COLUMN public.teams.sport IS 'Sport category: football, basketball, baseball, hockey, soccer';

-- Index for common query patterns
CREATE INDEX IF NOT EXISTS idx_teams_league_conference ON public.teams(league_id, conference);
CREATE INDEX IF NOT EXISTS idx_teams_sport ON public.teams(sport);


-- 2. BETTING JURISDICTIONS
-- State-by-state sports betting legalization status, tax rates, operators.
-- Source: Tax Foundation, AGA, state gaming commissions.
-- Refresh: Quarterly. ~51 rows.
CREATE TABLE IF NOT EXISTS public.betting_jurisdictions (
  state_code        text PRIMARY KEY,  -- "NY", "NV", "DC"
  state_name        text NOT NULL,
  legal_status      text NOT NULL DEFAULT 'illegal'
    CHECK (legal_status IN ('legal_online_retail', 'legal_retail_only', 'legal_tribal_only', 'legal_limited', 'illegal', 'pending')),
  legalization_date date,
  online_betting    boolean NOT NULL DEFAULT false,
  retail_betting    boolean NOT NULL DEFAULT false,
  online_tax_rate   numeric(5,2),       -- percentage on GGR
  retail_tax_rate   numeric(5,2),
  tax_base          text DEFAULT 'GGR'
    CHECK (tax_base IN ('GGR', 'NGR', 'handle', 'revenue_share')),
  licensed_operators integer DEFAULT 0,
  primary_regulator text,
  promo_deductions  boolean DEFAULT true,
  notes             text,
  source_url        text,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.betting_jurisdictions IS 
  'State-by-state US sports betting legal/tax landscape. Extracted from Tax Foundation + AGA data. Refresh quarterly.';

ALTER TABLE public.betting_jurisdictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read betting jurisdictions" ON public.betting_jurisdictions
  FOR SELECT USING (true);


-- 3. DRAFT HISTORY
-- Every NFL/NBA/MLB/NHL draft pick. Immutable historical record.
-- Source: Sports Reference, Wikipedia, official league sites.
-- Refresh: Annually (post-draft). ~15K+ rows.
CREATE TABLE IF NOT EXISTS public.draft_history (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  league            text NOT NULL CHECK (league IN ('NFL', 'NBA', 'MLB', 'NHL', 'WNBA', 'MLS')),
  draft_year        integer NOT NULL CHECK (draft_year >= 1936 AND draft_year <= 2030),
  round             integer NOT NULL,
  pick_overall      integer NOT NULL,
  pick_in_round     integer,
  team_name         text NOT NULL,
  team_abbrev       text,
  player_name       text NOT NULL,
  position          text,
  college_or_origin text,           -- college name or international origin
  age_at_draft      integer,
  -- Metadata
  source            text DEFAULT 'llm_extract',
  verified          boolean DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.draft_history IS 
  'Historical draft picks across all major leagues. Immutable once verified. Seeded from LLM training data, verified against Sports Reference.';

CREATE INDEX idx_draft_league_year ON public.draft_history(league, draft_year);
CREATE INDEX idx_draft_player ON public.draft_history(player_name);
CREATE INDEX idx_draft_team ON public.draft_history(team_name, league);
CREATE UNIQUE INDEX idx_draft_unique_pick ON public.draft_history(league, draft_year, round, pick_overall);

ALTER TABLE public.draft_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read draft history" ON public.draft_history
  FOR SELECT USING (true);


-- 4. HISTORICAL STANDINGS
-- Season-level team records across all leagues. Immutable.
-- Source: Sports Reference, Wikipedia, official league archives.
-- Refresh: Annually. ~30K+ rows.
CREATE TABLE IF NOT EXISTS public.historical_standings (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  league            text NOT NULL CHECK (league IN ('NFL', 'NBA', 'MLB', 'NHL', 'WNBA', 'MLS', 'NCAAFB', 'NCAAMB')),
  season            text NOT NULL,       -- "2024-25" or "2024"
  team_name         text NOT NULL,
  team_abbrev       text,
  conference        text,
  division          text,
  wins              integer NOT NULL DEFAULT 0,
  losses            integer NOT NULL DEFAULT 0,
  ties              integer DEFAULT 0,   -- NFL pre-2022 / soccer
  otl               integer DEFAULT 0,   -- NHL overtime losses
  win_pct           numeric(4,3),
  conf_rank         integer,
  div_rank          integer,
  made_playoffs     boolean DEFAULT false,
  playoff_seed      integer,
  playoff_result    text,                -- "Champion", "Finals", "Conf Semis", etc.
  points_for        integer,
  points_against    integer,
  point_diff        integer,
  -- Betting-relevant aggregates
  ats_wins          integer,
  ats_losses        integer,
  ats_pushes        integer,
  over_record       integer,
  under_record      integer,
  -- Metadata
  source            text DEFAULT 'llm_extract',
  verified          boolean DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.historical_standings IS 
  'Season-level standings across all leagues. Immutable historical record. Includes ATS/O-U for betting analytics.';

CREATE INDEX idx_standings_league_season ON public.historical_standings(league, season);
CREATE INDEX idx_standings_team ON public.historical_standings(team_name, league);
CREATE UNIQUE INDEX idx_standings_unique ON public.historical_standings(league, season, team_name);

ALTER TABLE public.historical_standings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read historical standings" ON public.historical_standings
  FOR SELECT USING (true);


-- 5. REFEREE / OFFICIAL TENDENCIES
-- Career and per-season penalty/foul tendencies for officials.
-- Source: NFLPenalties.com, NBA official stats, MLB umpire scorecards.
-- Refresh: Weekly in-season. ~500 rows.
CREATE TABLE IF NOT EXISTS public.official_tendencies (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  league            text NOT NULL CHECK (league IN ('NFL', 'NBA', 'MLB', 'NHL')),
  official_name     text NOT NULL,
  role              text DEFAULT 'head_referee',  -- head_referee, umpire, etc.
  season            text NOT NULL,
  games_officiated  integer DEFAULT 0,
  -- NFL-specific
  penalties_per_game     numeric(4,1),
  penalty_yards_per_game numeric(5,1),
  home_penalty_pct       numeric(4,1),    -- % of penalties on home team
  offensive_holding_pg   numeric(3,1),
  def_pass_interference_pg numeric(3,1),
  false_start_pg         numeric(3,1),
  -- NBA-specific
  fouls_per_game         numeric(4,1),
  techs_per_game         numeric(3,1),
  home_foul_pct          numeric(4,1),
  -- MLB-specific
  strike_zone_size       text,            -- "tight", "average", "wide"
  runs_per_game          numeric(4,1),
  k_per_game             numeric(4,1),
  -- Betting impact
  home_ats_record        text,            -- "9-8" format
  avg_total_scored       numeric(5,1),
  over_pct               numeric(4,1),    -- % of games going over
  -- General
  notable_tendency       text,            -- human-readable summary
  source                 text DEFAULT 'llm_extract',
  verified               boolean DEFAULT false,
  created_at             timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.official_tendencies IS 
  'Referee/umpire tendencies per season. Critical for NFL/MLB betting edge. Source: NFLPenalties.com, MLB Umpire Scorecards.';

CREATE INDEX idx_officials_league_season ON public.official_tendencies(league, season);
CREATE INDEX idx_officials_name ON public.official_tendencies(official_name);
CREATE UNIQUE INDEX idx_officials_unique ON public.official_tendencies(league, official_name, season);

ALTER TABLE public.official_tendencies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read official tendencies" ON public.official_tendencies
  FOR SELECT USING (true);


-- 6. HISTORICAL ODDS ARCHIVE
-- Game-level opening/closing lines with ATS results. The backtest foundation.
-- Source: SportsBookReview archives, Covers, Kaggle.
-- Refresh: Daily in-season. ~100K+ rows.
CREATE TABLE IF NOT EXISTS public.historical_odds (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  league            text NOT NULL CHECK (league IN ('NFL', 'NBA', 'MLB', 'NHL', 'NCAAFB', 'NCAAMB')),
  season            text NOT NULL,
  game_date         date NOT NULL,
  home_team         text NOT NULL,
  away_team         text NOT NULL,
  home_score        integer,
  away_score        integer,
  -- Lines
  spread_open       numeric(4,1),
  spread_close      numeric(4,1),
  total_open        numeric(5,1),
  total_close       numeric(5,1),
  home_ml_close     integer,
  away_ml_close     integer,
  -- Results
  ats_result        text CHECK (ats_result IN ('home_cover', 'away_cover', 'push')),
  ou_result         text CHECK (ou_result IN ('over', 'under', 'push')),
  -- Context
  is_playoff        boolean DEFAULT false,
  venue             text,
  -- Metadata
  source            text DEFAULT 'llm_extract',
  verified          boolean DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.historical_odds IS 
  'Game-level historical odds archive. Foundation for backtesting models and CLV analysis. Seeded from public archives.';

CREATE INDEX idx_hist_odds_league_season ON public.historical_odds(league, season);
CREATE INDEX idx_hist_odds_date ON public.historical_odds(game_date);
CREATE INDEX idx_hist_odds_teams ON public.historical_odds(home_team, away_team);
CREATE UNIQUE INDEX idx_hist_odds_unique ON public.historical_odds(league, game_date, home_team, away_team);

ALTER TABLE public.historical_odds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read historical odds" ON public.historical_odds
  FOR SELECT USING (true);


-- 7. SALARY / CONTRACT DATA
-- Player contracts and cap hits. Powers value-based models.
-- Source: Spotrac, OverTheCap, Basketball Reference.
-- Refresh: Bi-annually (FA + trade deadline). ~5K rows.
CREATE TABLE IF NOT EXISTS public.player_contracts (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  league            text NOT NULL CHECK (league IN ('NFL', 'NBA', 'MLB', 'NHL')),
  player_name       text NOT NULL,
  team_abbrev       text NOT NULL,
  position          text,
  season            text NOT NULL,       -- "2024-25"
  total_value       numeric(12,0),       -- total contract value in dollars
  contract_years    integer,
  aav               numeric(12,0),       -- average annual value
  guaranteed        numeric(12,0),
  cap_hit           numeric(12,0),       -- current season cap hit
  base_salary       numeric(12,0),
  dead_cap          numeric(12,0),
  free_agent_year   integer,
  -- Metadata
  source            text DEFAULT 'llm_extract',
  verified          boolean DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.player_contracts IS 
  'Player salary/contract data. Powers cap-aware projections and value models. Source: Spotrac, OverTheCap.';

CREATE INDEX idx_contracts_league_season ON public.player_contracts(league, season);
CREATE INDEX idx_contracts_player ON public.player_contracts(player_name);
CREATE INDEX idx_contracts_team ON public.player_contracts(team_abbrev, league);

ALTER TABLE public.player_contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read player contracts" ON public.player_contracts
  FOR SELECT USING (true);
;
