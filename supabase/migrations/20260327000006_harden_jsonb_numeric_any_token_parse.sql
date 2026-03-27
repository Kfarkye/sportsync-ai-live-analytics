-- Harden jsonb_numeric_any parsing:
-- extract the first signed decimal token from each candidate key value.
-- Prevents cast failures on composite strings like '228.5/228.5'.
-- Zone: DATA/ID (Amazon+Google)

CREATE OR REPLACE FUNCTION public.jsonb_numeric_any(p_payload jsonb, p_keys text[])
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT (
    SELECT CASE
      WHEN rx.match_text IS NULL THEN NULL
      ELSE rx.match_text::numeric
    END
    FROM unnest(p_keys) AS k
    CROSS JOIN LATERAL (
      SELECT NULLIF(BTRIM(p_payload ->> k), '') AS raw_text
    ) AS v
    CROSS JOIN LATERAL (
      SELECT (REGEXP_MATCH(v.raw_text, '([+-]?[0-9]+(?:\.[0-9]+)?)'))[1] AS match_text
    ) AS rx
    WHERE p_payload IS NOT NULL
      AND p_payload ? k
      AND v.raw_text IS NOT NULL
    LIMIT 1
  );
$$;

COMMENT ON FUNCTION public.jsonb_numeric_any(jsonb, text[]) IS
'Returns first numeric token found for the first matching JSON key in p_keys; tolerant of decorated strings.';
