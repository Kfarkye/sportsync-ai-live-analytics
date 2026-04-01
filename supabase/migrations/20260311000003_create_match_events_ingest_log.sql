-- Migration: create_match_events_ingest_log

CREATE TABLE IF NOT EXISTS match_events_ingest_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  run_at timestamptz DEFAULT now(),
  leagues_polled text[],
  events_found int DEFAULT 0,
  odds_snapshots_written int DEFAULT 0,
  errors jsonb DEFAULT '[]'::jsonb,
  duration_ms int,
  status text CHECK (status IN ('success', 'partial', 'failure'))
);
