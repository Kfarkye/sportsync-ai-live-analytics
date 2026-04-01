-- Evidence State Changes: Append-only audit log for canonical tables
-- Applied to Supabase via MCP on 2026-03-31

CREATE TABLE IF NOT EXISTS evidence_state_changes (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('INSERT','UPDATE','DELETE')),
  old_data JSONB,
  new_data JSONB,
  changed_fields TEXT[],
  writer TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_esc_table_record ON evidence_state_changes (table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_esc_created ON evidence_state_changes (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_esc_writer ON evidence_state_changes (writer);

-- Append-only protection: prevent UPDATE/DELETE on audit rows
CREATE OR REPLACE FUNCTION trg_evidence_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'evidence_state_changes is append-only: % not allowed', TG_OP;
END;
$$;

CREATE TRIGGER evidence_no_update
  BEFORE UPDATE ON evidence_state_changes
  FOR EACH ROW EXECUTE FUNCTION trg_evidence_immutable();

CREATE TRIGGER evidence_no_delete
  BEFORE DELETE ON evidence_state_changes
  FOR EACH ROW EXECUTE FUNCTION trg_evidence_immutable();

-- Audit trigger function: logs mutations on canonical tables
CREATE OR REPLACE FUNCTION trg_audit_state_change()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_changed TEXT[];
  v_writer TEXT;
  k TEXT;
BEGIN
  v_writer := coalesce(
    current_setting('app.current_writer', true),
    'system'
  );

  IF TG_OP = 'INSERT' THEN
    INSERT INTO evidence_state_changes (table_name, record_id, operation, new_data, changed_fields, writer)
    VALUES (TG_TABLE_NAME, coalesce(NEW.id::text, NEW.match_id::text, ''), 'INSERT', to_jsonb(NEW), '{}', v_writer);
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    v_changed := ARRAY(
      SELECT k FROM jsonb_object_keys(to_jsonb(NEW)) AS k
      WHERE to_jsonb(NEW) -> k IS DISTINCT FROM to_jsonb(OLD) -> k
    );
    IF array_length(v_changed, 1) IS NULL THEN RETURN NEW; END IF;
    INSERT INTO evidence_state_changes (table_name, record_id, operation, old_data, new_data, changed_fields, writer)
    VALUES (TG_TABLE_NAME, coalesce(NEW.id::text, NEW.match_id::text, ''), 'UPDATE', to_jsonb(OLD), to_jsonb(NEW), v_changed, v_writer);
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO evidence_state_changes (table_name, record_id, operation, old_data, changed_fields, writer)
    VALUES (TG_TABLE_NAME, coalesce(OLD.id::text, OLD.match_id::text, ''), 'DELETE', to_jsonb(OLD), '{}', v_writer);
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

-- Attach audit triggers to canonical tables
CREATE TRIGGER audit_canonical_games
  AFTER INSERT OR UPDATE OR DELETE ON canonical_games
  FOR EACH ROW EXECUTE FUNCTION trg_audit_state_change();

CREATE TRIGGER audit_matches
  AFTER INSERT OR UPDATE OR DELETE ON matches
  FOR EACH ROW EXECUTE FUNCTION trg_audit_state_change();

CREATE TRIGGER audit_live_game_state
  AFTER INSERT OR UPDATE OR DELETE ON live_game_state
  FOR EACH ROW EXECUTE FUNCTION trg_audit_state_change();
