ALTER TABLE public.pregame_intel
ADD COLUMN IF NOT EXISTS data_context_summary jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.pregame_intel.data_context_summary
IS 'Audit snapshot of database context availability used by pregame-intel-worker (section flags, counts, context length).';

