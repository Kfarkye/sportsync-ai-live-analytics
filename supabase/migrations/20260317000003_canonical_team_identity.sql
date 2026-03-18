-- Canonical team identity layer for durable cross-league team/logo resolution.
-- Goals:
-- 1) Stable canonical identity (team_id, canonical_slug)
-- 2) Alias absorption for real-world naming drift
-- 3) Bulk-safe DB resolver with explicit match typing

create or replace function public.normalize_team_identity_text(p_input text)
returns text
language plpgsql
immutable
as $$
declare
  v text;
begin
  v := lower(trim(coalesce(p_input, '')));
  if v = '' then
    return '';
  end if;

  -- Accent folding when extensions.unaccent is available.
  begin
    execute 'select extensions.unaccent($1)' into v using v;
  exception when others then
    -- Keep original text when unaccent extension/function is unavailable.
    null;
  end;

  -- Standardize common abbreviations.
  v := regexp_replace(v, '\bsaint\b', 'st', 'g');
  v := regexp_replace(v, '\bst[.]\b', 'st', 'g');

  -- Collapse punctuation and whitespace.
  v := regexp_replace(v, '[^a-z0-9]+', ' ', 'g');
  v := regexp_replace(v, '\s+', ' ', 'g');
  v := trim(v);
  return v;
end;
$$;

create or replace function public.to_canonical_team_slug(p_input text)
returns text
language sql
immutable
as $$
  select replace(public.normalize_team_identity_text(p_input), ' ', '_');
$$;

create table if not exists public.canonical_teams (
  team_id uuid primary key default gen_random_uuid(),
  canonical_name text not null,
  canonical_slug text not null,
  league_id text not null,
  sport text not null default 'unknown',
  logo_url text,
  is_active boolean not null default true,
  country text,
  external_refs jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint canonical_teams_slug_format_chk check (canonical_slug ~ '^[a-z0-9]+(?:_[a-z0-9]+)*$')
);

create unique index if not exists canonical_teams_slug_uidx on public.canonical_teams(canonical_slug);
create index if not exists canonical_teams_league_idx on public.canonical_teams(league_id);
create index if not exists canonical_teams_sport_idx on public.canonical_teams(sport);

create table if not exists public.team_aliases (
  alias_id bigserial primary key,
  team_id uuid not null references public.canonical_teams(team_id) on delete cascade,
  alias text not null,
  normalized_alias text not null,
  alias_type text not null default 'display',
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  constraint team_aliases_alias_nonempty_chk check (length(trim(alias)) > 0)
);

create unique index if not exists team_aliases_team_norm_uidx on public.team_aliases(team_id, normalized_alias);
create index if not exists team_aliases_normalized_idx on public.team_aliases(normalized_alias);

create or replace function public.canonical_teams_set_defaults()
returns trigger
language plpgsql
as $$
begin
  new.canonical_name := trim(coalesce(new.canonical_name, ''));
  new.league_id := trim(coalesce(new.league_id, ''));
  new.sport := trim(coalesce(new.sport, 'unknown'));

  if new.canonical_name = '' then
    raise exception 'canonical_name cannot be empty';
  end if;
  if new.league_id = '' then
    raise exception 'league_id cannot be empty';
  end if;
  if coalesce(trim(new.canonical_slug), '') = '' then
    new.canonical_slug := public.to_canonical_team_slug(new.canonical_name);
  end if;
  if new.canonical_slug = '' then
    raise exception 'canonical_slug cannot be empty';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_canonical_teams_set_defaults on public.canonical_teams;
create trigger trg_canonical_teams_set_defaults
before insert or update of canonical_name, canonical_slug, league_id, sport
on public.canonical_teams
for each row
execute function public.canonical_teams_set_defaults();

create or replace function public.team_aliases_set_normalized_alias()
returns trigger
language plpgsql
as $$
begin
  new.alias := trim(coalesce(new.alias, ''));
  if new.alias = '' then
    raise exception 'alias cannot be empty';
  end if;

  new.normalized_alias := public.normalize_team_identity_text(new.alias);
  if new.normalized_alias = '' then
    raise exception 'normalized_alias cannot be empty';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_team_aliases_set_normalized_alias on public.team_aliases;
create trigger trg_team_aliases_set_normalized_alias
before insert or update of alias
on public.team_aliases
for each row
execute function public.team_aliases_set_normalized_alias();

alter table public.canonical_teams enable row level security;
alter table public.team_aliases enable row level security;

drop policy if exists canonical_teams_select on public.canonical_teams;
create policy canonical_teams_select
on public.canonical_teams
for select
to anon, authenticated
using (true);

drop policy if exists team_aliases_select on public.team_aliases;
create policy team_aliases_select
on public.team_aliases
for select
to anon, authenticated
using (true);

create or replace function public.resolve_team_logos(
  p_names text[],
  p_league_ids text[] default null
)
returns table (
  input_name text,
  team_id uuid,
  canonical_name text,
  canonical_slug text,
  league_id text,
  logo_url text,
  match_type text
)
language sql
stable
security definer
set search_path = public
as $$
  with inputs as (
    select
      t.ordinality as idx,
      t.input_name,
      public.normalize_team_identity_text(t.input_name) as normalized_name
    from unnest(coalesce(p_names, array[]::text[])) with ordinality as t(input_name, ordinality)
    where t.input_name is not null
      and trim(t.input_name) <> ''
  ),
  matches as (
    select
      i.idx,
      i.input_name,
      m.team_id,
      m.canonical_name,
      m.canonical_slug,
      m.league_id,
      m.logo_url,
      m.match_type
    from inputs i
    left join lateral (
      select *
      from (
        select
          ct.team_id,
          ct.canonical_name,
          ct.canonical_slug,
          ct.league_id,
          ct.logo_url,
          ct.is_active,
          'exact'::text as match_type,
          1 as priority
        from public.canonical_teams ct
        where lower(ct.canonical_name) = lower(i.input_name)
          and (
            p_league_ids is null
            or array_length(p_league_ids, 1) is null
            or ct.league_id = any(p_league_ids)
          )

        union all

        select
          ct.team_id,
          ct.canonical_name,
          ct.canonical_slug,
          ct.league_id,
          ct.logo_url,
          ct.is_active,
          'alias'::text as match_type,
          2 as priority
        from public.team_aliases ta
        join public.canonical_teams ct on ct.team_id = ta.team_id
        where ta.normalized_alias = i.normalized_name
          and (
            p_league_ids is null
            or array_length(p_league_ids, 1) is null
            or ct.league_id = any(p_league_ids)
          )

        union all

        select
          ct.team_id,
          ct.canonical_name,
          ct.canonical_slug,
          ct.league_id,
          ct.logo_url,
          ct.is_active,
          'normalized'::text as match_type,
          3 as priority
        from public.canonical_teams ct
        where public.normalize_team_identity_text(ct.canonical_name) = i.normalized_name
          and (
            p_league_ids is null
            or array_length(p_league_ids, 1) is null
            or ct.league_id = any(p_league_ids)
          )
      ) ranked
      order by ranked.priority, ranked.is_active desc nulls last, ranked.canonical_name
      limit 1
    ) m on true
  )
  select
    m.input_name,
    m.team_id,
    m.canonical_name,
    m.canonical_slug,
    m.league_id,
    m.logo_url,
    coalesce(m.match_type, 'unresolved') as match_type
  from matches m
  order by m.idx;
$$;

grant execute on function public.resolve_team_logos(text[], text[]) to anon, authenticated, service_role;
