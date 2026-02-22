-- =================================================================
-- Forensic Audit Chain — Hash-linked tamper-evident audit log
--
-- Adds cryptographic chaining to nba_audit_log so each entry's
-- integrity depends on every previous entry.  Any INSERT, UPDATE,
-- or DELETE of a historical row is detectable by walking the chain.
--
-- Properties:
--   chain_hash = SHA-256( previous_chain_hash || log_id || ts ||
--                          function_name || operation || game_id )
--   Genesis row (log_id = min) uses a fixed seed so the chain is
--   self-bootstrapping.
-- =================================================================

-- 1. Add chain_hash column (nullable initially for backfill)
ALTER TABLE nba_audit_log
  ADD COLUMN IF NOT EXISTS chain_hash TEXT;

-- 2. Index for fast "latest hash" lookups
CREATE INDEX IF NOT EXISTS idx_audit_log_chain
  ON nba_audit_log (log_id DESC)
  WHERE chain_hash IS NOT NULL;

-- 3. Trigger function: computes chain_hash on every INSERT
CREATE OR REPLACE FUNCTION audit_chain_hash()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    prev_hash TEXT;
BEGIN
    -- Fetch the most recent chain_hash
    SELECT chain_hash INTO prev_hash
      FROM nba_audit_log
     WHERE chain_hash IS NOT NULL
     ORDER BY log_id DESC
     LIMIT 1;

    -- Genesis case: no previous hash exists
    IF prev_hash IS NULL THEN
        prev_hash := 'GENESIS:sportsync-forensic-audit-v1';
    END IF;

    -- chain_hash = SHA-256(prev_hash || log_id || ts || function_name || operation || game_id)
    NEW.chain_hash := encode(
        sha256(
            convert_to(
                prev_hash
                || '|' || NEW.log_id::TEXT
                || '|' || COALESCE(NEW.ts::TEXT, '')
                || '|' || COALESCE(NEW.function_name, '')
                || '|' || COALESCE(NEW.operation, '')
                || '|' || COALESCE(NEW.game_id, ''),
                'UTF8'
            )
        ),
        'hex'
    );

    RETURN NEW;
END;
$$;

-- 4. Attach trigger (BEFORE INSERT so NEW.chain_hash is set before write)
DROP TRIGGER IF EXISTS trg_audit_chain_hash ON nba_audit_log;
CREATE TRIGGER trg_audit_chain_hash
    BEFORE INSERT ON nba_audit_log
    FOR EACH ROW
    EXECUTE FUNCTION audit_chain_hash();

-- 5. Backfill existing rows in log_id order so the chain is consistent.
--    Uses a cursor-style loop to set each row's chain_hash sequentially.
DO $$
DECLARE
    row_rec RECORD;
    prev_hash TEXT := 'GENESIS:sportsync-forensic-audit-v1';
BEGIN
    FOR row_rec IN
        SELECT log_id, ts, function_name, operation, game_id
          FROM nba_audit_log
         ORDER BY log_id ASC
    LOOP
        prev_hash := encode(
            sha256(
                convert_to(
                    prev_hash
                    || '|' || row_rec.log_id::TEXT
                    || '|' || COALESCE(row_rec.ts::TEXT, '')
                    || '|' || COALESCE(row_rec.function_name, '')
                    || '|' || COALESCE(row_rec.operation, '')
                    || '|' || COALESCE(row_rec.game_id, ''),
                    'UTF8'
                )
            ),
            'hex'
        );

        UPDATE nba_audit_log
           SET chain_hash = prev_hash
         WHERE log_id = row_rec.log_id;
    END LOOP;
END;
$$;

-- 6. Verification function: walk the chain and report any breaks
CREATE OR REPLACE FUNCTION verify_audit_chain(
    start_id BIGINT DEFAULT NULL,
    end_id   BIGINT DEFAULT NULL
)
RETURNS TABLE(log_id BIGINT, expected_hash TEXT, actual_hash TEXT, valid BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
    row_rec  RECORD;
    prev_hash TEXT := 'GENESIS:sportsync-forensic-audit-v1';
    computed TEXT;
BEGIN
    FOR row_rec IN
        SELECT a.log_id, a.ts, a.function_name, a.operation, a.game_id, a.chain_hash
          FROM nba_audit_log a
         WHERE (start_id IS NULL OR a.log_id >= start_id)
           AND (end_id   IS NULL OR a.log_id <= end_id)
         ORDER BY a.log_id ASC
    LOOP
        computed := encode(
            sha256(
                convert_to(
                    prev_hash
                    || '|' || row_rec.log_id::TEXT
                    || '|' || COALESCE(row_rec.ts::TEXT, '')
                    || '|' || COALESCE(row_rec.function_name, '')
                    || '|' || COALESCE(row_rec.operation, '')
                    || '|' || COALESCE(row_rec.game_id, ''),
                    'UTF8'
                )
            ),
            'hex'
        );

        log_id        := row_rec.log_id;
        expected_hash := computed;
        actual_hash   := row_rec.chain_hash;
        valid         := (computed = row_rec.chain_hash);
        RETURN NEXT;

        prev_hash := row_rec.chain_hash;
    END LOOP;
END;
$$;

-- 7. Update cleanup to preserve a chain anchor before deleting old entries.
--    The anchor stores the final chain_hash of deleted rows so verification
--    can resume from the retention boundary.
CREATE TABLE IF NOT EXISTS audit_chain_anchors (
    anchor_id   BIGSERIAL PRIMARY KEY,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    last_log_id BIGINT NOT NULL,
    chain_hash  TEXT NOT NULL,
    rows_pruned BIGINT NOT NULL DEFAULT 0
);

ALTER TABLE audit_chain_anchors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role only" ON audit_chain_anchors FOR ALL USING (true);

-- Replace cleanup function to anchor the chain before pruning
CREATE OR REPLACE FUNCTION cleanup_old_nba_data()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    cutoff TIMESTAMPTZ := NOW() - INTERVAL '90 days';
    anchor_log_id BIGINT;
    anchor_hash   TEXT;
    pruned_count  BIGINT;
BEGIN
    -- Delete ticks older than 30 days
    DELETE FROM nba_ticks WHERE ts < NOW() - INTERVAL '30 days';

    -- Delete snapshots older than 30 days
    DELETE FROM nba_snapshots WHERE ts < NOW() - INTERVAL '30 days';

    -- Anchor the chain before pruning audit logs
    SELECT a.log_id, a.chain_hash
      INTO anchor_log_id, anchor_hash
      FROM nba_audit_log a
     WHERE a.ts < cutoff
       AND a.chain_hash IS NOT NULL
     ORDER BY a.log_id DESC
     LIMIT 1;

    IF anchor_log_id IS NOT NULL THEN
        -- Count rows to be pruned
        SELECT COUNT(*) INTO pruned_count
          FROM nba_audit_log
         WHERE ts < cutoff;

        -- Save the anchor
        INSERT INTO audit_chain_anchors (last_log_id, chain_hash, rows_pruned)
        VALUES (anchor_log_id, anchor_hash, pruned_count);

        -- Now safe to delete
        DELETE FROM nba_audit_log WHERE ts < cutoff;
    END IF;

    -- Log the cleanup (this entry will be chained by the trigger)
    INSERT INTO nba_audit_log (function_name, operation, details)
    VALUES ('cleanup_old_nba_data', 'CLEANUP', jsonb_build_object(
        'completed_at', NOW(),
        'anchor_log_id', anchor_log_id,
        'rows_pruned', pruned_count
    ));
END;
$$;
