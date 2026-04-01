-- 20260112000009_debug_relation_matches.sql
-- Diagnostic RPC to prove which matches relations exist and which have status column

CREATE OR REPLACE FUNCTION public.debug_relation_matches()
RETURNS TABLE(
  resolved_schema TEXT,
  resolved_name TEXT,
  has_status BOOLEAN
)
LANGUAGE SQL
SECURITY DEFINER
AS $$
  SELECT
    n.nspname::TEXT AS resolved_schema,
    c.relname::TEXT AS resolved_name,
    EXISTS (
      SELECT 1
      FROM pg_attribute a
      WHERE a.attrelid = c.oid
        AND a.attname = 'status'
        AND a.attnum > 0
        AND NOT a.attisdropped
    ) AS has_status
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relname = 'matches'
  ORDER BY n.nspname ASC;
$$;

SELECT 'Debug RPC created: debug_relation_matches()' AS status;
