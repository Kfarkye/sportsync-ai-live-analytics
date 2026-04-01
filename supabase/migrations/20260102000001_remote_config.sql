-- Remote Configuration Table for Hot-swapping Engine Constants
-- Allows tuning "magic numbers" (e.g. NHL P3 Inflation) without code deploys.

create table if not exists app_config (
    key text primary key,
    value jsonb not null,
    description text,
    updated_at timestamptz default now()
);

-- Enable RLS (Read-only for public/anon if needed, or service_role only)
alter table app_config enable row level security;

create policy "Allow public read access" on app_config
    for select to anon, authenticated using (true);

create policy "Allow internal write access" on app_config
    for all to service_role using (true);

-- Seed Initial "Golden" Values from v5.9 Patch
-- These match src/config/gates.ts defaults
insert into app_config (key, value, description) values
    ('NHL_GATES', '{
        "SOG_CONVERSION_AVG": 0.096,
        "MIN_EVENTS_TRUST": 15,
        "TIED_DECAY_MULT": 0.75,
        "EN_INJECTION_1G": 0.85,
        "EN_INJECTION_2G": 0.70,
        "P3_INFLATION": 1.25,
        "PROACTIVE_EN_WEIGHT": 0.45
    }'::jsonb, 'Hockey Physics Constants (v5.9 Volatility Patch)'),
    
    ('NBA_GATES', '{
        "BLOWOUT_DIFF": 22,
        "ACTIONABLE_EDGE": 3.5,
        "MIN_REV_PER_MIN": 3.2
    }'::jsonb, 'NBA Thresholds')
    ON CONFLICT (key) DO NOTHING;

-- Function to key-value upsert config (for admin dashboard tools)
create or replace function set_app_config(k text, v jsonb, d text default null)
returns void as $$
begin
    insert into app_config (key, value, description, updated_at)
    values (k, v, d, now())
    on conflict (key) do update
    set value = excluded.value,
        description = coalesce(excluded.description, app_config.description),
        updated_at = now();
end;
$$ language plpgsql security definer;
