-- =================================================================
-- Google-Grade Mutex: Advisory Locking for Singleflight
-- Prevents "Thundering Herd" API spikes when cache expires.
-- =================================================================

-- 1. Atomic lock acquisition helper
DROP FUNCTION IF EXISTS acquire_originator_lock(text);
CREATE OR REPLACE FUNCTION acquire_originator_lock(lock_key text)
RETURNS boolean AS $$
DECLARE
  -- Hash the string key into a 64-bit integer for the advisory lock
  lock_id bigint := ('x' || substr(md5(lock_key), 1, 16))::bit(64)::bigint;
BEGIN
  -- Attempt to acquire a session-level lock (not transaction-level, as serverless persists connections)
  -- returns true if successful, false if busy
  RETURN pg_try_advisory_lock(lock_id);
END;
$$ LANGUAGE plpgsql VOLATILE;

-- 2. Atomic lock release helper
DROP FUNCTION IF EXISTS release_originator_lock(text);
CREATE OR REPLACE FUNCTION release_originator_lock(lock_key text)
RETURNS boolean AS $$
DECLARE
  lock_id bigint := ('x' || substr(md5(lock_key), 1, 16))::bit(64)::bigint;
BEGIN
  RETURN pg_advisory_unlock(lock_id);
END;
$$ LANGUAGE plpgsql VOLATILE;

SELECT 'Advisory Lock protocol deployed' as status;
