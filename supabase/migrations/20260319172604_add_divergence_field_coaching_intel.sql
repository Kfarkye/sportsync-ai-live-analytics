
ALTER TABLE coaching_intel 
ADD COLUMN IF NOT EXISTS divergence text,
ADD COLUMN IF NOT EXISTS divergence_direction text, -- 'OVER', 'UNDER', 'COVER', 'MISS', 'NEUTRAL'
ADD COLUMN IF NOT EXISTS narrative_says text, -- What the public believes from the coaching narrative
ADD COLUMN IF NOT EXISTS truth_says text; -- What the data actually shows
;
