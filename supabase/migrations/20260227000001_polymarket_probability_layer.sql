-- ============================================================================
-- MIGRATION: Polymarket Probability-Native Data Layer
-- Phase 1 of 4: The Drip → Prediction Market Intelligence Platform
-- ============================================================================
-- This migration creates the foundational tables for ingesting Polymarket
-- sports prediction data. Polymarket share prices ARE probabilities — no vig,
-- no conversion needed. A $0.58 share = 58% implied probability.
--
-- Architecture:
--   poly_league_map   → Maps Polymarket series_ids to our local league IDs
--   poly_odds         → Game-level probabilities from Polymarket CLOB
--   poly_ingest_log   → Telemetry for pipeline observability
-- ============================================================================

-- 1. League mapping: Polymarket series_id → our league_id
-- Polymarket organizes sports as Series → Events → Markets.
-- series_ids are discovered via GET /sports on gamma-api.polymarket.com
-- This seed table is manually maintained — new leagues added as poly expands.
create table if not exists public.poly_league_map (
  id            serial primary key,
  poly_series_id text unique not null,
  local_league_id text not null,
  sport          text not null,
  display_name   text not null,
  active         boolean default true,
  created_at     timestamptz default now()
);

comment on table public.poly_league_map is 
  'Maps Polymarket series_ids to local LEAGUES constant IDs';

-- Seed known mappings (series_ids from gamma-api.polymarket.com/sports)
-- NOTE: series_ids must be verified against live API before first deploy.
-- Run: curl "https://gamma-api.polymarket.com/sports" to get current IDs.
insert into public.poly_league_map (poly_series_id, local_league_id, sport, display_name) values
  -- NBA
  ('10345', 'nba', 'basketball', 'NBA'),
  -- MLB  
  ('10346', 'mlb', 'baseball', 'MLB'),
  -- NHL
  ('10347', 'nhl', 'hockey', 'NHL'),
  -- NFL
  ('10348', 'nfl', 'football', 'NFL'),
  -- NCAAB
  ('10349', 'mens-college-basketball', 'basketball', 'NCAAB'),
  -- NCAAF
  ('10350', 'college-football', 'football', 'NCAAF'),
  -- EPL
  ('10351', 'eng.1', 'soccer', 'Premier League'),
  -- La Liga
  ('10352', 'esp.1', 'soccer', 'La Liga'),
  -- Serie A
  ('10353', 'ita.1', 'soccer', 'Serie A'),
  -- Bundesliga
  ('10354', 'ger.1', 'soccer', 'Bundesliga'),
  -- Ligue 1
  ('10355', 'fra.1', 'soccer', 'Ligue 1'),
  -- Champions League
  ('10356', 'uefa.champions', 'soccer', 'Champions League'),
  -- MLS
  ('10357', 'usa.1', 'soccer', 'MLS')
on conflict (poly_series_id) do nothing;


-- 2. Game-level probability data from Polymarket
create table if not exists public.poly_odds (
  id                uuid primary key default gen_random_uuid(),
  
  -- Foreign key to our matches table (nullable until matched)
  game_id           text,
  
  -- Polymarket identifiers
  poly_event_id     text unique not null,
  poly_event_slug   text,
  poly_condition_id text,
  
  -- The core data: probability as decimal (0.0000 to 1.0000)
  home_prob         numeric(5,4) not null check (home_prob >= 0 and home_prob <= 1),
  away_prob         numeric(5,4) not null check (away_prob >= 0 and away_prob <= 1),
  draw_prob         numeric(5,4) check (draw_prob >= 0 and draw_prob <= 1),
  
  -- Market metadata
  volume            numeric default 0,
  volume_24h        numeric default 0,
  liquidity         numeric default 0,
  
  -- Team info from Polymarket (for matching)
  home_team_name    text,
  away_team_name    text,
  
  -- League mapping
  local_league_id   text,
  poly_series_id    text,
  
  -- Timing
  game_start_time   timestamptz,
  market_active     boolean default true,
  market_closed     boolean default false,
  
  -- Timestamps
  poly_updated_at   timestamptz,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

-- Indexes for fast lookups
create index if not exists idx_poly_odds_game_id on public.poly_odds(game_id);
create index if not exists idx_poly_odds_league on public.poly_odds(local_league_id);
create index if not exists idx_poly_odds_active on public.poly_odds(market_active) where market_active = true;
create index if not exists idx_poly_odds_start_time on public.poly_odds(game_start_time);

comment on table public.poly_odds is 
  'Polymarket game-level probabilities. Share price = probability. No vig.';


-- 3. Ingestion telemetry
create table if not exists public.poly_ingest_log (
  id            uuid primary key default gen_random_uuid(),
  run_at        timestamptz default now(),
  leagues_queried int default 0,
  events_found    int default 0,
  events_upserted int default 0,
  events_matched  int default 0,
  errors          jsonb default '[]'::jsonb,
  duration_ms     int,
  status          text check (status in ('success', 'partial', 'failure'))
);

comment on table public.poly_ingest_log is 
  'Observability log for Polymarket ingestion pipeline runs';


-- 4. Auto-update timestamp trigger
create or replace function update_poly_odds_timestamp()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_poly_odds_updated on public.poly_odds;
create trigger trg_poly_odds_updated
  before update on public.poly_odds
  for each row execute function update_poly_odds_timestamp();


-- 5. RLS policies — public read, service-role write
alter table public.poly_odds enable row level security;
alter table public.poly_league_map enable row level security;
alter table public.poly_ingest_log enable row level security;

create policy "poly_odds_public_read" on public.poly_odds
  for select using (true);

create policy "poly_odds_service_write" on public.poly_odds
  for all using (auth.role() = 'service_role');

create policy "poly_league_map_public_read" on public.poly_league_map
  for select using (true);

create policy "poly_league_map_service_write" on public.poly_league_map
  for all using (auth.role() = 'service_role');

create policy "poly_ingest_log_service_only" on public.poly_ingest_log
  for all using (auth.role() = 'service_role');


-- 6. View: Active probabilities joined with matches for frontend consumption
create or replace view public.v_poly_live as
select 
  po.game_id,
  po.home_team_name,
  po.away_team_name,
  po.home_prob,
  po.away_prob,
  po.draw_prob,
  po.volume,
  po.volume_24h,
  po.local_league_id,
  po.game_start_time,
  po.poly_event_slug,
  po.updated_at as poly_updated_at
from public.poly_odds po
where po.market_active = true
  and po.market_closed = false
order by po.game_start_time asc;

comment on view public.v_poly_live is 
  'Live Polymarket probabilities for active games — ready for frontend';
