-- Fixed-window rate limiting support for API gateway

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'uq_rate_limit_bucket'
      AND conrelid = 'public.rate_limit_buckets'::regclass
  ) THEN
    ALTER TABLE public.rate_limit_buckets
      ADD CONSTRAINT uq_rate_limit_bucket
      UNIQUE (api_key_id, window_start, window_type);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_rate_limit(
  p_key_id uuid,
  p_window_start timestamptz,
  p_window_type text
)
RETURNS TABLE (request_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  INSERT INTO public.rate_limit_buckets (api_key_id, window_start, window_type, request_count)
  VALUES (p_key_id, p_window_start, p_window_type, 1)
  ON CONFLICT (api_key_id, window_start, window_type)
  DO UPDATE SET request_count = public.rate_limit_buckets.request_count + 1
  RETURNING public.rate_limit_buckets.request_count;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_rate_limit(uuid, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_rate_limit(uuid, timestamptz, text) TO service_role;
