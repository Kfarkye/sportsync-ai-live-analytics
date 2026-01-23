-- 1. DROP EXISTING FUNCTIONS (Fixes the "Return Type" Error)
-- We remove all variations to ensure a fresh start
DROP FUNCTION IF EXISTS release_originator_lock(text);
DROP FUNCTION IF EXISTS acquire_originator_lock(text);
DROP FUNCTION IF EXISTS acquire_originator_lock(text, int);

-- 2. CREATE TABLE (If not exists)
CREATE TABLE IF NOT EXISTS originator_locks (
  key TEXT PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL
);

-- 3. CREATE ACQUIRE FUNCTION (With TTL support)
-- Returns TRUE if lock acquired, FALSE if busy
CREATE OR REPLACE FUNCTION acquire_originator_lock(lock_key text, ttl_seconds int default 60)
RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  -- A. Clean up expired locks first (Self-healing)
  DELETE FROM originator_locks WHERE expires_at < now();

  -- B. Attempt to acquire
  INSERT INTO originator_locks (key, expires_at)
  VALUES (lock_key, now() + (ttl_seconds || ' seconds')::interval)
  ON CONFLICT (key) DO NOTHING;

  -- C. Return true if we inserted (acquired), false if it existed
  RETURN FOUND;
END;
$$;

-- 4. CREATE RELEASE FUNCTION
-- Returns void (fire and forget)
CREATE OR REPLACE FUNCTION release_originator_lock(lock_key text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM originator_locks WHERE key = lock_key;
END;
$$;
