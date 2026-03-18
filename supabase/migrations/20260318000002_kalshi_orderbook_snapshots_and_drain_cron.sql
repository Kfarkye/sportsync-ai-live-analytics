BEGIN;

CREATE TABLE IF NOT EXISTS public.kalshi_orderbook_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_ticker text NOT NULL,
  event_ticker text NOT NULL,
  sport text,
  snapshot_type text NOT NULL CHECK (snapshot_type IN ('pregame', 'live', 'settled')),

  yes_best_bid numeric,
  yes_best_bid_qty integer,
  yes_total_bid_qty integer,
  yes_depth_levels jsonb,

  no_best_bid numeric,
  no_best_bid_qty integer,
  no_total_bid_qty integer,
  no_depth_levels jsonb,

  spread numeric GENERATED ALWAYS AS (yes_best_bid + no_best_bid - 1.0) STORED,
  yes_no_imbalance numeric,

  recent_trade_count integer,
  recent_yes_volume integer,
  recent_no_volume integer,
  recent_volume_imbalance numeric,
  last_trade_price numeric,
  last_trade_side text,

  volume integer,
  open_interest integer,

  captured_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kalshi_ob_ticker
  ON public.kalshi_orderbook_snapshots (market_ticker, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_kalshi_ob_event
  ON public.kalshi_orderbook_snapshots (event_ticker, captured_at DESC);

DO $$
DECLARE
  v_job_id bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    SELECT jobid INTO v_job_id
    FROM cron.job
    WHERE jobname = 'drain-kalshi-orderbook'
    LIMIT 1;

    IF v_job_id IS NOT NULL THEN
      PERFORM cron.unschedule(v_job_id);
    END IF;

    PERFORM cron.schedule(
      'drain-kalshi-orderbook',
      '*/5 * * * *',
      $job$
        SELECT net.http_post(
          url := current_setting('app.settings.supabase_url') || '/functions/v1/drain-kalshi-orderbook',
          headers := jsonb_build_object(
            'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
            'Content-Type', 'application/json'
          ),
          body := '{}'::jsonb
        );
      $job$
    );
  END IF;
END;
$$;

COMMIT;
