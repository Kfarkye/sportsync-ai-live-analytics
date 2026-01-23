-- =================================================================
-- Google-Tier Data Upgrade
-- Adds Confidence Scoring & Probabilistic Analytics columns
-- =================================================================

-- 1. Add confidence_score to main intel table (0-100 probability)
ALTER TABLE pregame_intel 
ADD COLUMN IF NOT EXISTS confidence_score INT DEFAULT 75;

-- 2. Add confidence logic to the cards table (if we normalize later)
-- ALTER TABLE pregame_intel_cards 
-- ADD COLUMN IF NOT EXISTS confidence_score INT DEFAULT 75;

-- 3. Add source_count to track research depth
ALTER TABLE pregame_intel 
ADD COLUMN IF NOT EXISTS source_count INT DEFAULT 0;

-- 4. Index for sorting by highest confidence/probabilistic value
CREATE INDEX IF NOT EXISTS idx_pregame_intel_confidence 
ON pregame_intel(confidence_score DESC);

SELECT 'Google-Tier Schema Applied: Confidence Scoring & Probabilistic Indexing' as status;
