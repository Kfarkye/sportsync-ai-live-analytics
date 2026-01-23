-- Create the missing conversation helper to prevent crashes
DROP FUNCTION IF EXISTS get_or_create_conversation(text, text) CASCADE;
CREATE OR REPLACE FUNCTION get_or_create_conversation(p_session_id text, p_match_id text)
RETURNS uuid AS $$
DECLARE v_conv_id uuid;
BEGIN
  SELECT id INTO v_conv_id FROM conversations 
  WHERE session_id = p_session_id AND match_id = p_match_id LIMIT 1;
  
  IF v_conv_id IS NULL THEN
    INSERT INTO conversations (session_id, match_id, messages)
    VALUES (p_session_id, p_match_id, '[]'::jsonb)
    RETURNING id INTO v_conv_id;
  END IF;
  RETURN v_conv_id;
END;
$$ LANGUAGE plpgsql;
