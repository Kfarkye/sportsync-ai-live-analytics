BEGIN;

ALTER TABLE public.kalshi_orderbook_snapshots
  ADD COLUMN IF NOT EXISTS league text,
  ADD COLUMN IF NOT EXISTS market_type text,
  ADD COLUMN IF NOT EXISTS market_label text,
  ADD COLUMN IF NOT EXISTS line_value numeric,
  ADD COLUMN IF NOT EXISTS line_side text,
  ADD COLUMN IF NOT EXISTS mid_price numeric,
  ADD COLUMN IF NOT EXISTS spread_width numeric,
  ADD COLUMN IF NOT EXISTS last_trade_at timestamptz,
  ADD COLUMN IF NOT EXISTS yes_price numeric,
  ADD COLUMN IF NOT EXISTS no_price numeric;

CREATE INDEX IF NOT EXISTS idx_kalshi_ob_type
  ON public.kalshi_orderbook_snapshots (market_type, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_kalshi_ob_sport_date
  ON public.kalshi_orderbook_snapshots (sport, captured_at DESC);

CREATE TABLE IF NOT EXISTS public.kalshi_events_active (
  event_ticker text PRIMARY KEY,
  sport text,
  league text,
  title text,
  home_team text,
  away_team text,
  game_date date,
  market_count int,
  market_tickers text[],
  status text NOT NULL DEFAULT 'active',
  discovered_at timestamptz NOT NULL DEFAULT now(),
  last_snapshot_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kalshi_events_date
  ON public.kalshi_events_active (game_date, status);

CREATE OR REPLACE VIEW public.v_kalshi_event_flow AS
SELECT
  k.event_ticker,
  k.market_ticker,
  k.market_type,
  k.market_label,
  k.line_value,
  k.yes_price,
  k.volume,
  k.open_interest,
  k.yes_no_imbalance,
  k.recent_volume_imbalance,
  k.spread_width,
  k.captured_at,
  ROW_NUMBER() OVER (
    PARTITION BY k.event_ticker, k.market_ticker
    ORDER BY k.captured_at DESC
  ) AS rn
FROM public.kalshi_orderbook_snapshots k;

CREATE OR REPLACE VIEW public.v_kalshi_book_timeseries AS
SELECT
  k.market_ticker,
  k.market_label,
  k.yes_best_bid,
  k.no_best_bid,
  k.mid_price,
  k.yes_total_bid_qty,
  k.no_total_bid_qty,
  k.yes_no_imbalance,
  k.volume,
  k.captured_at
FROM public.kalshi_orderbook_snapshots k
ORDER BY k.market_ticker, k.captured_at;

DO $$
DECLARE
  v_old_job_id bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    SELECT jobid INTO v_old_job_id
    FROM cron.job
    WHERE jobname = 'drain-kalshi-orderbook'
    LIMIT 1;

    IF v_old_job_id IS NOT NULL THEN
      PERFORM cron.unschedule(v_old_job_id);
    END IF;

    SELECT jobid INTO v_old_job_id
    FROM cron.job
    WHERE jobname = 'drain-kalshi-orderbook-discovery'
    LIMIT 1;

    IF v_old_job_id IS NOT NULL THEN
      PERFORM cron.unschedule(v_old_job_id);
    END IF;

    SELECT jobid INTO v_old_job_id
    FROM cron.job
    WHERE jobname = 'drain-kalshi-orderbook-snapshot'
    LIMIT 1;

    IF v_old_job_id IS NOT NULL THEN
      PERFORM cron.unschedule(v_old_job_id);
    END IF;

    PERFORM cron.schedule(
      'drain-kalshi-orderbook-discovery',
      '0 8 * * *',
      $job$
        SELECT net.http_post(
          url := current_setting('app.settings.supabase_url') || '/functions/v1/drain-kalshi-orderbook',
          headers := jsonb_build_object(
            'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
            'Content-Type', 'application/json'
          ),
          body := jsonb_build_object('phase', 'discover', 'sport', 'all')
        );
      $job$
    );

    PERFORM cron.schedule(
      'drain-kalshi-orderbook-snapshot',
      '*/5 * * * *',
      $job$
        SELECT CASE
          WHEN EXISTS (
            SELECT 1
            FROM public.kalshi_events_active ke
            WHERE ke.status = 'active'
              AND ke.game_date = (now() AT TIME ZONE 'utc')::date
          ) THEN net.http_post(
            url := current_setting('app.settings.supabase_url') || '/functions/v1/drain-kalshi-orderbook',
            headers := jsonb_build_object(
              'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
              'Content-Type', 'application/json'
            ),
            body := jsonb_build_object('phase', 'snapshot', 'sport', 'all')
          )
          ELSE NULL
        END;
      $job$
    );
  END IF;
END;
$$;

COMMIT;
