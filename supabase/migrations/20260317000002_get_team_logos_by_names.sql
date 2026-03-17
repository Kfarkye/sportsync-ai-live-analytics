-- Bulk-safe team logo lookup for punctuation/accent-heavy display names.
-- Keeps parsing server-side and avoids brittle URL in.(...) filters.

create or replace function public.get_team_logos_by_names(
  p_names text[],
  p_league_ids text[] default null
)
returns table (
  team_name text,
  league_id text,
  logo_url text
)
language sql
stable
security definer
set search_path = public
as $$
  with normalized_names as (
    select lower(trim(n)) as name_key
    from unnest(coalesce(p_names, array[]::text[])) as n
    where n is not null and trim(n) <> ''
  )
  select
    tl.team_name,
    tl.league_id,
    tl.logo_url
  from public.team_logos tl
  join normalized_names nn
    on lower(trim(tl.team_name)) = nn.name_key
  where tl.logo_url is not null
    and (
      p_league_ids is null
      or array_length(p_league_ids, 1) is null
      or tl.league_id = any(p_league_ids)
    );
$$;

grant execute on function public.get_team_logos_by_names(text[], text[]) to anon, authenticated, service_role;
