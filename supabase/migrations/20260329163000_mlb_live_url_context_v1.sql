-- MLB Live URL Context System V1
-- ZONES:
-- DATA/ID (Amazon+Google): canonical receipts storage for replay/audit
-- OPS (SRE+Amazon): queryability and cooldown retrieval indexes

CREATE TABLE IF NOT EXISTS public.mlb_live_insight_receipts (
  id bigserial PRIMARY KEY,
  ts_utc timestamptz NOT NULL DEFAULT now(),
  game_id text NOT NULL,
  game_url text NOT NULL,
  inning_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  market_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  trigger text NOT NULL,
  ai_summary jsonb NOT NULL,
  confidence numeric NOT NULL,
  severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  outcome_snapshot_later jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mlb_live_receipts_game_ts_idx
  ON public.mlb_live_insight_receipts (game_id, ts_utc DESC);

CREATE INDEX IF NOT EXISTS mlb_live_receipts_trigger_ts_idx
  ON public.mlb_live_insight_receipts (trigger, ts_utc DESC);

CREATE INDEX IF NOT EXISTS mlb_live_receipts_date_idx
  ON public.mlb_live_insight_receipts ((ts_utc::date), ts_utc DESC);

ALTER TABLE public.mlb_live_insight_receipts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'mlb_live_insight_receipts'
      AND policyname = 'service_role_all_mlb_live_insight_receipts'
  ) THEN
    CREATE POLICY service_role_all_mlb_live_insight_receipts
      ON public.mlb_live_insight_receipts
      FOR ALL
      USING ((select auth.role()) = 'service_role')
      WITH CHECK ((select auth.role()) = 'service_role');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'mlb_live_insight_receipts'
      AND policyname = 'public_read_mlb_live_insight_receipts'
  ) THEN
    CREATE POLICY public_read_mlb_live_insight_receipts
      ON public.mlb_live_insight_receipts
      FOR SELECT
      USING (true);
  END IF;
END
$$;

GRANT SELECT ON public.mlb_live_insight_receipts TO anon, authenticated, service_role;
GRANT INSERT ON public.mlb_live_insight_receipts TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.mlb_live_insight_receipts_id_seq TO service_role;

COMMENT ON TABLE public.mlb_live_insight_receipts IS
'Replay/receipt log for emitted MLB live insights. One row per emitted message.';

COMMENT ON COLUMN public.mlb_live_insight_receipts.ai_summary IS
'Fixed 3-part output: what_changed, why_it_matters, what_to_watch_now, text.';

-- Read/query examples:
-- 1) By game:
-- SELECT * FROM public.mlb_live_insight_receipts
-- WHERE game_id = '401696999_mlb'
-- ORDER BY ts_utc DESC;
--
-- 2) By trigger and date:
-- SELECT trigger, count(*)::bigint AS emits
-- FROM public.mlb_live_insight_receipts
-- WHERE ts_utc::date = CURRENT_DATE
-- GROUP BY trigger
-- ORDER BY emits DESC;
