-- PRODUCTION HARDENING: Automated Tennis Sync & Performance Indices

-- 1. Create a function to handle automated tennis match creation
CREATE OR REPLACE FUNCTION sync_tennis_matches_from_feeds()
RETURNS TRIGGER AS $$
BEGIN
    -- Only process tennis sports
    IF NEW.sport_key LIKE 'tennis_%' AND NEW.home_team IS NOT NULL AND NEW.away_team IS NOT NULL THEN
        INSERT INTO matches (
            id,
            league_id,
            sport,
            home_team,
            away_team,
            start_time,
            status,
            current_odds,
            last_odds_update
        )
        VALUES (
            NEW.external_id || '_tennis',
            CASE 
                WHEN NEW.sport_key LIKE '%atp%' THEN 'atp'
                WHEN NEW.sport_key LIKE '%wta%' THEN 'wta'
                ELSE 'tennis'
            END,
            'tennis',
            NEW.home_team,
            NEW.away_team,
            NEW.commence_time,
            'STATUS_SCHEDULED',
            jsonb_build_object(
                'homeWin', NULLIF((NEW.best_h2h->'home'->>'price'), '')::int,
                'awayWin', NULLIF((NEW.best_h2h->'away'->>'price'), '')::int,
                'total', NULLIF((NEW.best_total->'over'->>'point'), '')::numeric,
                'overOdds', NULLIF((NEW.best_total->'over'->>'price'), '')::int,
                'underOdds', NULLIF((NEW.best_total->'under'->>'price'), '')::int,
                'homeSpread', NULLIF((NEW.best_spread->'home'->>'point'), '')::numeric,
                'awaySpread', NULLIF((NEW.best_spread->'away'->>'point'), '')::numeric,
                'homeSpreadOdds', NULLIF((NEW.best_spread->'home'->>'price'), '')::int,
                'awaySpreadOdds', NULLIF((NEW.best_spread->'away'->>'price'), '')::int,
                'provider', COALESCE(NEW.best_h2h->>'bookmaker', 'Consensus'),
                'lastUpdated', NEW.last_updated,
                'isInstitutional', true
            ),
            NEW.last_updated
        )
        ON CONFLICT (id) DO UPDATE SET
            home_team = EXCLUDED.home_team,
            away_team = EXCLUDED.away_team,
            start_time = COALESCE(EXCLUDED.start_time, matches.start_time),
            current_odds = EXCLUDED.current_odds,
            last_odds_update = EXCLUDED.last_odds_update
        WHERE matches.last_odds_update IS NULL 
           OR matches.last_odds_update < EXCLUDED.last_odds_update;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Attach the trigger to market_feeds
DROP TRIGGER IF EXISTS tr_sync_tennis_matches ON market_feeds;
CREATE TRIGGER tr_sync_tennis_matches
AFTER INSERT OR UPDATE ON market_feeds
FOR EACH ROW EXECUTE FUNCTION sync_tennis_matches_from_feeds();

-- 3. Update Sport Normalization to include Tennis
-- Run this to fix existing records and the view
UPDATE pregame_intel 
SET sport = 'tennis'
WHERE league_id IN ('atp', 'wta') OR sport = 'tennis';

CREATE OR REPLACE VIEW pick_record_by_sport AS
SELECT 
    CASE 
        WHEN sport = 'nba' THEN 'NBA'
        WHEN sport = 'college_basketball' THEN 'College Basketball'
        WHEN sport = 'hockey' THEN 'NHL'
        WHEN sport = 'nfl' THEN 'NFL'
        WHEN sport = 'college_football' THEN 'College Football'
        WHEN sport = 'soccer' THEN 'Soccer'
        WHEN sport = 'tennis' THEN 'Tennis'
        ELSE INITCAP(sport)
    END as sport,
    COUNT(*) FILTER (WHERE pick_result = 'WIN') as wins,
    COUNT(*) FILTER (WHERE pick_result = 'LOSS') as losses,
    COUNT(*) FILTER (WHERE pick_result = 'PUSH') as pushes,
    ROUND(100.0 * COUNT(*) FILTER (WHERE pick_result = 'WIN') / 
        NULLIF(COUNT(*) FILTER (WHERE pick_result IN ('WIN', 'LOSS')), 0), 1) as win_pct
FROM pregame_intel
WHERE pick_result IN ('WIN', 'LOSS', 'PUSH')
GROUP BY 1
ORDER BY (COUNT(*) FILTER (WHERE pick_result = 'WIN') + COUNT(*) FILTER (WHERE pick_result = 'LOSS')) DESC;

-- 4. PERFORMANCE TUNING: Add indices for the most used queries
CREATE INDEX IF NOT EXISTS idx_pregame_intel_grading_lookup 
ON pregame_intel (pick_result, sport, game_date);

CREATE INDEX IF NOT EXISTS idx_matches_sport_start 
ON matches (sport, start_time);

-- 5. VERIFY
SELECT sport, wins, losses, win_pct FROM pick_record_by_sport;
