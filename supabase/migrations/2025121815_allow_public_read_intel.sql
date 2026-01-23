
-- 1. Enable RLS on player_prop_bets
ALTER TABLE player_prop_bets ENABLE ROW LEVEL SECURITY;

-- 2. Create a public read policy
-- This allows any user (including anonymous) to read player prop data.
-- Since the app is read-heavy and props are public data, this is safe.
CREATE POLICY "Public Read Access for Player Props"
ON player_prop_bets
FOR SELECT
TO anon, authenticated
USING (true);

-- 3. Also do it for other intel tables that might be locked
ALTER TABLE match_news ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public Read Access for Match News" ON match_news FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE match_thesis ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public Read Access for Match Thesis" ON match_thesis FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE team_trends ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public Read Access for Team Trends" ON team_trends FOR SELECT TO anon, authenticated USING (true);
