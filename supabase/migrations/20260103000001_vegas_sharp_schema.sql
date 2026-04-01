-- v4.0 Vegas Sharp Upgrade: Database Hardening
-- Adds sharp_data and thoughts columns to match_news if they don't exist

DO $$
BEGIN
    -- 1. sharp_data: Structured JSON for the forensic analysis
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='match_news' AND column_name='sharp_data') THEN
        ALTER TABLE match_news ADD COLUMN sharp_data JSONB DEFAULT '{}';
    END IF;

    -- 2. thoughts: The hidden reasoning trace (Chain of Thought)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='match_news' AND column_name='thoughts') THEN
        ALTER TABLE match_news ADD COLUMN thoughts TEXT;
    END IF;

    -- 3. error_message: For debugging background failures
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='match_news' AND column_name='error_message') THEN
        ALTER TABLE match_news ADD COLUMN error_message TEXT;
    END IF;
END $$;
