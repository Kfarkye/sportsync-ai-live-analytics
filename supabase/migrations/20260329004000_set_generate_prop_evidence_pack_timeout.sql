-- Prevent evidence-pack RPC aborts on large cache scans.
-- Keep execution bounded but long enough for production payload generation.
ALTER FUNCTION public.generate_prop_evidence_pack() SET statement_timeout = '120s';
