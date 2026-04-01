
ALTER TABLE ai_chat_picks 
ADD COLUMN IF NOT EXISTS extraction_method TEXT DEFAULT 'legacy_regex';

ALTER TABLE ai_chat_picks
ADD COLUMN IF NOT EXISTS extraction_validated BOOLEAN DEFAULT false;

-- Add index heavily used for grading lookups
CREATE INDEX IF NOT EXISTS idx_ai_chat_picks_graded_at ON ai_chat_picks(graded_at);
CREATE INDEX IF NOT EXISTS idx_ai_chat_picks_result ON ai_chat_picks(result);
