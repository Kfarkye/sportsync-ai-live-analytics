-- ============================================================================
-- Live Realtime Architecture Baseline
-- - Lightweight live_scores table + sync trigger from live_game_state
-- - Realtime publication + replica identity hardening for live tables
-- - 1-minute live ingest cron alignment (function-signature aware)
-- - Cleanup cron for finished live scores
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Lightweight live scores projection table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.live_scores (
  match_id text PRIMARY KEY,
  league_id text NOT NULL,
  sport text,
  home_team text,
  away_team text,
  home_score integer DEFAULT 0,
  away_score integer DEFAULT 0,
  period integer,
  clock text,
  display_clock text,
  game_status text,
  spread numeric,
  total numeric,
  home_ml integer,
  away_ml integer,
  over_odds integer,
  under_odds integer,
  home_win_prob numeric,
  last_play_text text,
  last_play_type text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_live_scores_league_status
  ON public.live_scores (league_id, game_status);

CREATE INDEX IF NOT EXISTS idx_live_scores_status
  ON public.live_scores (game_status);

ALTER TABLE public.live_scores ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'live_scores'
      AND policyname = 'live_scores_read_public'
  ) THEN
    CREATE POLICY live_scores_read_public
      ON public.live_scores
      FOR SELECT
      TO anon, authenticated
      USING (true);
  END IF;
END
$$;

GRANT SELECT ON public.live_scores TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2) Sync trigger from live_game_state -> live_scores
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_live_scores()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_odds jsonb := COALESCE(NEW.odds::jsonb, '{}'::jsonb);
  v_current jsonb := COALESCE(v_odds->'current', '{}'::jsonb);
  v_spread_text text := COALESCE(v_current->>'homeSpread', v_current->>'spread', '');
  v_total_text text := COALESCE(v_current->>'total', v_current->>'overUnder', '');
  v_home_ml_text text := COALESCE(v_current->>'homeWin', v_current->>'moneylineHome', v_current->>'home_ml', '');
  v_away_ml_text text := COALESCE(v_current->>'awayWin', v_current->>'moneylineAway', v_current->>'away_ml', '');
  v_over_odds_text text := COALESCE(v_current->>'overOdds', v_current->>'over_odds', '');
  v_under_odds_text text := COALESCE(v_current->>'underOdds', v_current->>'under_odds', '');
  v_home_win_prob_text text := COALESCE(
    COALESCE(NEW.predictor::jsonb, '{}'::jsonb)->>'homeWinPct',
    CASE
      WHEN jsonb_typeof(NEW.momentum::jsonb) = 'array' THEN (NEW.momentum::jsonb->-1->>'winProb')
      ELSE NULL
    END,
    ''
  );
BEGIN
  INSERT INTO public.live_scores (
    match_id,
    league_id,
    sport,
    home_team,
    away_team,
    home_score,
    away_score,
    period,
    clock,
    display_clock,
    game_status,
    spread,
    total,
    home_ml,
    away_ml,
    over_odds,
    under_odds,
    home_win_prob,
    last_play_text,
    last_play_type,
    updated_at
  ) VALUES (
    NEW.id,
    COALESCE(NEW.league_id, 'unknown'),
    COALESCE(NEW.sport, split_part(NEW.id, '_', 2)),
    NEW.home_team,
    NEW.away_team,
    COALESCE(NEW.home_score, 0),
    COALESCE(NEW.away_score, 0),
    NEW.period,
    NEW.clock,
    NEW.display_clock,
    NEW.game_status,
    NULLIF(regexp_replace(v_spread_text, '[^0-9+.\-]', '', 'g'), '')::numeric,
    NULLIF(regexp_replace(v_total_text, '[^0-9+.\-]', '', 'g'), '')::numeric,
    NULLIF(regexp_replace(v_home_ml_text, '[^0-9+\-]', '', 'g'), '')::integer,
    NULLIF(regexp_replace(v_away_ml_text, '[^0-9+\-]', '', 'g'), '')::integer,
    NULLIF(regexp_replace(v_over_odds_text, '[^0-9+\-]', '', 'g'), '')::integer,
    NULLIF(regexp_replace(v_under_odds_text, '[^0-9+\-]', '', 'g'), '')::integer,
    NULLIF(regexp_replace(v_home_win_prob_text, '[^0-9+.\-]', '', 'g'), '')::numeric,
    COALESCE(NEW.last_play::jsonb->>'text', NULL),
    COALESCE(NEW.last_play::jsonb->>'type', NEW.last_play::jsonb->'type'->>'text', NULL),
    now()
  )
  ON CONFLICT (match_id) DO UPDATE SET
    league_id = EXCLUDED.league_id,
    sport = EXCLUDED.sport,
    home_team = EXCLUDED.home_team,
    away_team = EXCLUDED.away_team,
    home_score = EXCLUDED.home_score,
    away_score = EXCLUDED.away_score,
    period = EXCLUDED.period,
    clock = EXCLUDED.clock,
    display_clock = EXCLUDED.display_clock,
    game_status = EXCLUDED.game_status,
    spread = EXCLUDED.spread,
    total = EXCLUDED.total,
    home_ml = EXCLUDED.home_ml,
    away_ml = EXCLUDED.away_ml,
    over_odds = EXCLUDED.over_odds,
    under_odds = EXCLUDED.under_odds,
    home_win_prob = EXCLUDED.home_win_prob,
    last_play_text = EXCLUDED.last_play_text,
    last_play_type = EXCLUDED.last_play_type,
    updated_at = now();

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_live_scores ON public.live_game_state;
CREATE TRIGGER trg_sync_live_scores
AFTER INSERT OR UPDATE ON public.live_game_state
FOR EACH ROW
EXECUTE FUNCTION public.sync_live_scores();

-- ----------------------------------------------------------------------------
-- 3) Realtime publication + replica identity for live push tables
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'live_game_state'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.live_game_state;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'game_events'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.game_events;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'live_scores'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.live_scores;
    END IF;
  END IF;
END
$$;

ALTER TABLE public.live_game_state REPLICA IDENTITY FULL;
ALTER TABLE public.game_events REPLICA IDENTITY FULL;
ALTER TABLE public.live_scores REPLICA IDENTITY FULL;

-- ----------------------------------------------------------------------------
-- 4) 1-minute live ingest cron alignment (handles both invoke signatures)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_job record;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RETURN;
  END IF;

  FOR v_job IN
    SELECT jobid
    FROM cron.job
    WHERE jobname IN (
      'high-frequency-live-ingest',
      'ingest-live-nba-2m',
      'ingest-live-nhl-2m',
      'ingest-live-ncaab-2m',
      'ingest-live-nba-1m',
      'ingest-live-nhl-1m',
      'ingest-live-ncaab-1m',
      'ingest-live-soccer-2m'
    )
  LOOP
    PERFORM cron.unschedule(v_job.jobid);
  END LOOP;
END
$$;

DO $$
DECLARE
  v_has_targeted_invoke boolean;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'invoke_ingest_live_games'
      AND p.pronargs = 2
  )
  INTO v_has_targeted_invoke;

  IF v_has_targeted_invoke THEN
    PERFORM cron.schedule('ingest-live-nba-1m', '* * * * *', $cmd$SELECT public.invoke_ingest_live_games('nba', 3)$cmd$);
    PERFORM cron.schedule('ingest-live-nhl-1m', '* * * * *', $cmd$SELECT public.invoke_ingest_live_games('nhl', 3)$cmd$);
    PERFORM cron.schedule('ingest-live-ncaab-1m', '* * * * *', $cmd$SELECT public.invoke_ingest_live_games('ncaab', 10)$cmd$);
    PERFORM cron.schedule('ingest-live-soccer-2m', '*/2 * * * *', $cmd$SELECT public.invoke_ingest_live_games('soccer', 5)$cmd$);
  ELSE
    PERFORM cron.schedule('high-frequency-live-ingest', '* * * * *', $cmd$SELECT public.invoke_ingest_live_games()$cmd$);
  END IF;
END
$$;

-- ----------------------------------------------------------------------------
-- 5) Live score cleanup for finished games
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleanup_finished_live_scores()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
BEGIN
  DELETE FROM public.live_scores
  WHERE game_status IN ('STATUS_FINAL', 'STATUS_FULL_TIME', 'STATUS_CANCELED', 'STATUS_POSTPONED')
    AND updated_at < now() - interval '10 minutes';
END;
$function$;

DO $$
DECLARE
  v_job record;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RETURN;
  END IF;

  FOR v_job IN
    SELECT jobid
    FROM cron.job
    WHERE jobname = 'cleanup-live-scores'
  LOOP
    PERFORM cron.unschedule(v_job.jobid);
  END LOOP;

  PERFORM cron.schedule(
    'cleanup-live-scores',
    '*/5 * * * *',
    $cmd$SELECT public.cleanup_finished_live_scores()$cmd$
  );
END
$$;
