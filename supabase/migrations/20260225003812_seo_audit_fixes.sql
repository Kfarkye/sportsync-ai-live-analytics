
-- SEO Audit Fixes Migration
-- Addresses: og_image_url column, title length constraint, structured data support

-- 1. Add og_image_url for dynamic Open Graph per team page
ALTER TABLE wc26_teams ADD COLUMN IF NOT EXISTS og_image_url text;

-- 2. Add CHECK constraint: title tags must stay ≤60 chars (Google truncation threshold)
ALTER TABLE wc26_teams ADD CONSTRAINT chk_seo_title_length 
  CHECK (char_length(seo_title) <= 60);

-- 3. Add CHECK constraint: meta descriptions 70–160 chars
ALTER TABLE wc26_teams ADD CONSTRAINT chk_seo_description_length 
  CHECK (seo_description IS NULL OR (char_length(seo_description) BETWEEN 70 AND 160));

-- 4. Set default og_image_url from flag_uri for teams that have flags
UPDATE wc26_teams SET og_image_url = flag_uri WHERE flag_uri IS NOT NULL AND og_image_url IS NULL;

-- 5. Add comment for documentation
COMMENT ON COLUMN wc26_teams.og_image_url IS 'Open Graph image URL for social sharing. Falls back to flag_uri if not set.';
COMMENT ON CONSTRAINT chk_seo_title_length ON wc26_teams IS 'Google truncates titles >600px (~60 chars). Enforced at DB level.';
;
