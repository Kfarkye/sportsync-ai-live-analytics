
-- Add the 3 migration tracking fields
ALTER TABLE public.data_registry 
  ADD COLUMN IF NOT EXISTS destination_system TEXT DEFAULT 'supabase',
  ADD COLUMN IF NOT EXISTS last_migrated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cutover_ready BOOLEAN DEFAULT false;

-- Mark the first vertical slice as migrating
UPDATE public.data_registry SET status = 'migrating', destination_system = 'firebase'
WHERE canonical_name IN (
  'JOB_RUNS', 'JOB_ALERTS', 'JOB_DATA_REGISTRY',
  'HUB_GAMES_CURRENT', 'HUB_GAMES_LIVE',
  'APP_REF_TENDENCIES_CURRENT'
);
;
