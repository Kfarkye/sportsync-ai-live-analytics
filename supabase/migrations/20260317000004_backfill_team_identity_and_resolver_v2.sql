-- Phase 2:
-- 1) Backfill canonical team identity from team_logos
-- 2) Upgrade resolver contract with ambiguity visibility

do $$
begin
  if to_regclass('public.team_logos') is null then
    raise notice 'Skipping team identity backfill: public.team_logos not found';
  else
    execute $sql$
      with source_rows as (
        select
          trim(tl.team_name) as team_name,
          trim(coalesce(tl.league_id, 'unknown')) as league_id,
          nullif(trim(tl.logo_url), '') as logo_url,
          public.normalize_team_identity_text(tl.team_name) as normalized_name
        from public.team_logos tl
        where tl.team_name is not null
          and trim(tl.team_name) <> ''
      ),
      deduped as (
        select distinct on (sr.league_id, sr.normalized_name)
          sr.team_name,
          sr.league_id,
          sr.logo_url,
          sr.normalized_name
        from source_rows sr
        where sr.normalized_name <> ''
        order by sr.league_id, sr.normalized_name, (sr.logo_url is not null) desc, length(sr.team_name) desc
      ),
      slugged as (
        select
          d.team_name as canonical_name,
          d.league_id,
          d.logo_url,
          d.normalized_name,
          public.to_canonical_team_slug(d.team_name) as base_slug,
          row_number() over (
            partition by public.to_canonical_team_slug(d.team_name)
            order by d.league_id, d.team_name
          ) as slug_rank
        from deduped d
      ),
      prepared as (
        select
          s.canonical_name,
          case
            when coalesce(s.base_slug, '') = '' then 'team_' || substr(md5(s.league_id || ':' || s.normalized_name), 1, 16)
            when s.slug_rank = 1 then s.base_slug
            else s.base_slug || '_' || regexp_replace(lower(s.league_id), '[^a-z0-9]+', '_', 'g')
          end as canonical_slug,
          s.league_id,
          case
            when s.league_id = 'mens-college-basketball' then 'basketball'
            when s.league_id like 'nba%' then 'basketball'
            when s.league_id like 'ncaab%' then 'basketball'
            when s.league_id like 'nhl%' then 'hockey'
            when s.league_id like 'mlb%' then 'baseball'
            when s.league_id like 'nfl%' then 'football'
            when s.league_id = 'college-football' then 'football'
            else 'soccer'
          end as sport,
          s.logo_url,
          s.normalized_name
        from slugged s
      )
      insert into public.canonical_teams (
        canonical_name,
        canonical_slug,
        league_id,
        sport,
        logo_url,
        external_refs
      )
      select
        p.canonical_name,
        p.canonical_slug,
        p.league_id,
        p.sport,
        p.logo_url,
        jsonb_build_object('seed', 'team_logos_backfill')
      from prepared p
      on conflict (canonical_slug) do update
      set
        canonical_name = excluded.canonical_name,
        league_id = excluded.league_id,
        sport = excluded.sport,
        logo_url = coalesce(excluded.logo_url, canonical_teams.logo_url),
        external_refs = canonical_teams.external_refs || excluded.external_refs,
        updated_at = now();
    $sql$;

    execute $sql$
      with source_aliases as (
        select
          trim(tl.team_name) as team_name,
          trim(coalesce(tl.league_id, 'unknown')) as league_id,
          public.normalize_team_identity_text(tl.team_name) as normalized_name
        from public.team_logos tl
        where tl.team_name is not null
          and trim(tl.team_name) <> ''
      ),
      mapped_aliases as (
        select distinct
          ct.team_id,
          sa.team_name as alias
        from source_aliases sa
        join public.canonical_teams ct
          on ct.league_id = sa.league_id
         and public.normalize_team_identity_text(ct.canonical_name) = sa.normalized_name
        where sa.normalized_name <> ''
      )
      insert into public.team_aliases (
        team_id,
        alias,
        alias_type,
        source
      )
      select
        ma.team_id,
        ma.alias,
        'display',
        'team_logos_backfill'
      from mapped_aliases ma
      on conflict (team_id, normalized_alias) do nothing;
    $sql$;
  end if;
end
$$;

-- Resolver V2: expose ambiguity explicitly.
drop function if exists public.resolve_team_logos(text[], text[]);

create function public.resolve_team_logos(
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
  match_type text,
  is_ambiguous boolean
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
  candidates_raw as (
    select
      i.idx,
      i.input_name,
      ct.team_id,
      ct.canonical_name,
      ct.canonical_slug,
      ct.league_id,
      ct.logo_url,
      ct.is_active,
      'exact'::text as match_type,
      1 as priority
    from inputs i
    join public.canonical_teams ct
      on lower(ct.canonical_name) = lower(i.input_name)
    where p_league_ids is null
      or array_length(p_league_ids, 1) is null
      or ct.league_id = any(p_league_ids)

    union all

    select
      i.idx,
      i.input_name,
      ct.team_id,
      ct.canonical_name,
      ct.canonical_slug,
      ct.league_id,
      ct.logo_url,
      ct.is_active,
      'alias'::text as match_type,
      2 as priority
    from inputs i
    join public.team_aliases ta
      on ta.normalized_alias = i.normalized_name
    join public.canonical_teams ct
      on ct.team_id = ta.team_id
    where p_league_ids is null
      or array_length(p_league_ids, 1) is null
      or ct.league_id = any(p_league_ids)

    union all

    select
      i.idx,
      i.input_name,
      ct.team_id,
      ct.canonical_name,
      ct.canonical_slug,
      ct.league_id,
      ct.logo_url,
      ct.is_active,
      'normalized'::text as match_type,
      3 as priority
    from inputs i
    join public.canonical_teams ct
      on public.normalize_team_identity_text(ct.canonical_name) = i.normalized_name
    where p_league_ids is null
      or array_length(p_league_ids, 1) is null
      or ct.league_id = any(p_league_ids)
  ),
  candidates as (
    select *
    from (
      select
        cr.*,
        row_number() over (
          partition by cr.idx, cr.team_id
          order by cr.priority, cr.canonical_name
        ) as team_rank
      from candidates_raw cr
    ) ranked_per_team
    where ranked_per_team.team_rank = 1
  ),
  ranked as (
    select
      c.*,
      row_number() over (
        partition by c.idx
        order by c.priority, c.is_active desc, c.canonical_name
      ) as pick_rank,
      count(*) over (partition by c.idx) as candidate_count
    from candidates c
  )
  select
    i.input_name,
    r.team_id,
    r.canonical_name,
    r.canonical_slug,
    r.league_id,
    r.logo_url,
    coalesce(r.match_type, 'unresolved') as match_type,
    coalesce(r.candidate_count > 1, false) as is_ambiguous
  from inputs i
  left join ranked r
    on r.idx = i.idx
   and r.pick_rank = 1
  order by i.idx;
$$;

grant execute on function public.resolve_team_logos(text[], text[]) to anon, authenticated, service_role;
