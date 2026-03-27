
-- Enable RLS on internal/pipeline tables that should be service_role only
-- These are backfill queues, ingest logs, internal state tables

-- Backfill / queue tables
ALTER TABLE public._pbp_backfill_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._prob_backfill_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._probe_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backfill_errors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backfill_queue ENABLE ROW LEVEL SECURITY;

-- Ingest / pipeline internals
ALTER TABLE public.ai_chat_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entry_signals_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingest_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingestion_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intel_worker_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_events_ingest_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.season_backfill_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snapshot_health_audit ENABLE ROW LEVEL SECURITY;

-- Add service_role ALL policy to each (using select initplan pattern)
CREATE POLICY "service_role_all" ON public._pbp_backfill_queue FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "service_role_all" ON public._prob_backfill_queue FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "service_role_all" ON public._probe_results FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "service_role_all" ON public.backfill_errors FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "service_role_all" ON public.backfill_queue FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "service_role_all" ON public.ai_chat_runs FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "service_role_all" ON public.entry_signals_log FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "service_role_all" ON public.ingest_runs FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "service_role_all" ON public.ingestion_locks FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "service_role_all" ON public.intel_worker_leases FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "service_role_all" ON public.match_events_ingest_log FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "service_role_all" ON public.season_backfill_schedule FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "service_role_all" ON public.snapshot_health_audit FOR ALL USING ((select auth.role()) = 'service_role');
;
