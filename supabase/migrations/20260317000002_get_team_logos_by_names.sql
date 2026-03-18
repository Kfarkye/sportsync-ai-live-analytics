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
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if to_regclass('public.team_logos') is null then
    return;
  end if;

  return query execute $q$
    with normalized_names as (
      select lower(trim(n)) as name_key
      from unnest(coalesce($1, array[]::text[])) as n
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
        $2 is null
        or array_length($2, 1) is null
        or tl.league_id = any($2)
      )
  $q$ using p_names, p_league_ids;
end;
$$;

grant execute on function public.get_team_logos_by_names(text[], text[]) to anon, authenticated, service_role;
