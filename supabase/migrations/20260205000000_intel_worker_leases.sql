-- Global concurrency guard for pregame intel AI calls
-- Ensures a bounded number of Gemini requests across all edge workers.

create table if not exists public.intel_worker_leases (
  id uuid primary key default gen_random_uuid(),
  request_id text not null,
  acquired_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists idx_intel_worker_leases_expires
  on public.intel_worker_leases (expires_at);

-- Acquire a lease with a hard concurrency cap (transactional)
create or replace function public.acquire_intel_lease(
  p_request_id text,
  p_limit int,
  p_ttl_seconds int
) returns uuid
language plpgsql
as $$
declare
  active_count int;
  lease_id uuid;
begin
  lock table public.intel_worker_leases in share row exclusive mode;

  delete from public.intel_worker_leases where expires_at < now();

  select count(*) into active_count
  from public.intel_worker_leases
  where expires_at >= now();

  if active_count >= p_limit then
    return null;
  end if;

  insert into public.intel_worker_leases(request_id, expires_at)
  values (p_request_id, now() + (p_ttl_seconds::text || ' seconds')::interval)
  returning id into lease_id;

  return lease_id;
end;
$$;

create or replace function public.release_intel_lease(
  p_lease_id uuid
) returns void
language plpgsql
as $$
begin
  delete from public.intel_worker_leases where id = p_lease_id;
end;
$$;
