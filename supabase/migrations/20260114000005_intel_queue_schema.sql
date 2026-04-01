
-- Queue System Tables

create table if not exists public.intel_jobs (
  id uuid default gen_random_uuid() primary key,
  status text not null default 'queued', -- queued, running, completed, failed
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.intel_job_items (
  id uuid default gen_random_uuid() primary key,
  job_id uuid references public.intel_jobs(id) on delete cascade,
  match_id text not null,
  status text not null default 'pending', -- pending, success, failed
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(job_id, match_id)
);

-- Default Intel Table (Ensuring existence)
create table if not exists public.pregame_intel (
  match_id text primary key,
  game_date date not null,
  league_id text,
  home_team text,
  away_team text,
  headline text,
  briefing text,
  recommended_pick text,
  cards jsonb,
  logic_authority text,
  is_edge_of_day boolean,
  sources jsonb,
  generated_at timestamptz,
  analyzed_spread numeric,
  analyzed_total numeric,
  grading_metadata jsonb,
  executive_summary jsonb,
  simulation_data jsonb,
  source_count int,
  confidence_score int,
  payload jsonb, -- Storing full raw payload for quality preservation
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
