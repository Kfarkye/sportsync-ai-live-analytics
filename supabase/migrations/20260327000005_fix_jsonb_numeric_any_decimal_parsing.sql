-- Fix numeric parsing in jsonb_numeric_any.
-- Previous implementation rejected decimal strings like "-7.5".
-- Zone: DATA/ID (Amazon+Google)

CREATE OR REPLACE FUNCTION public.jsonb_numeric_any(p_payload jsonb, p_keys text[])
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT (
    SELECT public.safe_to_numeric(p_payload ->> k)
    FROM unnest(p_keys) AS k
    WHERE p_payload IS NOT NULL
      AND p_payload ? k
      AND NULLIF(BTRIM(p_payload ->> k), '') IS NOT NULL
    LIMIT 1
  );
$$;

COMMENT ON FUNCTION public.jsonb_numeric_any(jsonb, text[]) IS
'Returns the first numeric value found in a JSON object for any candidate key. Supports signed decimal strings.';
