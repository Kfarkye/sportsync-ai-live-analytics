-- Pregame Observability Hardening
-- Description: Adds tracing and error columns to pregame tables for high-resolution diagnostics.

-- 1. Updates specifically for pregame_intel (Generation Layer)
ALTER TABLE pregame_intel 
ADD COLUMN IF NOT EXISTS ingest_trace JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS last_error TEXT;

-- 2. Updates for pregame_intel_log (Cron Layer)
ALTER TABLE pregame_intel_log
ADD COLUMN IF NOT EXISTS trace JSONB DEFAULT '[]'::jsonb;

-- 3. Ensure GIN indexes for trace columns to support SRE queries
CREATE INDEX IF NOT EXISTS idx_pregame_intel_ingest_trace ON pregame_intel USING GIN (ingest_trace);
CREATE INDEX IF NOT EXISTS idx_pregame_intel_log_trace ON pregame_intel_log USING GIN (trace);

-- 4. Verify
SELECT 'Pregame Observability Columns Added' as status;
