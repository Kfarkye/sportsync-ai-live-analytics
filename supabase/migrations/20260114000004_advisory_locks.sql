
-- Expose advisory lock helpers as RPC-callable functions.
-- Verified secure for service_role usage.

create or replace function public.pg_try_advisory_lock(key int)
returns boolean
language sql
security definer
as $$
  select pg_try_advisory_lock(key);
$$;

create or replace function public.pg_advisory_unlock(key int)
returns boolean
language sql
security definer
as $$
  select pg_advisory_unlock(key);
$$;
