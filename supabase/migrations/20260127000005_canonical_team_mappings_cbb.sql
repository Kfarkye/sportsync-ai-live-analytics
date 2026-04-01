-- ═══════════════════════════════════════════════════════════════════════════════
-- CANONICAL TEAM MAPPINGS: NCAA Men's Basketball (CBB)
-- Single Source of Truth for Odds API <-> ESPN team name resolution
-- 
-- Architecture:
--   - canonical_name: The ESPN displayName (authoritative)
--   - odds_api_name: The Odds API variant (for lookup)
--   - league_id: 'basketball_ncaab' for CBB
--
-- Usage at Grading Time:
--   1. Look up pick.home_team in this table
--   2. Look up Odds API score.home_team in this table
--   3. If both resolve to same canonical_name -> MATCH
-- ═══════════════════════════════════════════════════════════════════════════════

-- Ensure table exists with proper structure
CREATE TABLE IF NOT EXISTS canonical_teams (
    id SERIAL PRIMARY KEY,
    canonical_name TEXT NOT NULL,
    odds_api_name TEXT NOT NULL,
    league_id TEXT NOT NULL DEFAULT 'basketball_ncaab',
    espn_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(odds_api_name, league_id)
);

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_canonical_teams_odds_api ON canonical_teams(odds_api_name);
CREATE INDEX IF NOT EXISTS idx_canonical_teams_canonical ON canonical_teams(canonical_name);
CREATE INDEX IF NOT EXISTS idx_canonical_teams_league ON canonical_teams(league_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- SEED DATA: 154 Odds API teams mapped to ESPN canonical names
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO canonical_teams (canonical_name, odds_api_name, league_id) VALUES
-- EXACT MATCHES (most teams)
('Akron Zips', 'Akron Zips', 'basketball_ncaab'),
('Alabama Crimson Tide', 'Alabama Crimson Tide', 'basketball_ncaab'),
('Arkansas Razorbacks', 'Arkansas Razorbacks', 'basketball_ncaab'),
('Auburn Tigers', 'Auburn Tigers', 'basketball_ncaab'),
('Baylor Bears', 'Baylor Bears', 'basketball_ncaab'),
('Belmont Bruins', 'Belmont Bruins', 'basketball_ncaab'),
('Boise State Broncos', 'Boise State Broncos', 'basketball_ncaab'),
('Bowling Green Falcons', 'Bowling Green Falcons', 'basketball_ncaab'),
('Buffalo Bulls', 'Buffalo Bulls', 'basketball_ncaab'),
('Butler Bulldogs', 'Butler Bulldogs', 'basketball_ncaab'),
('California Golden Bears', 'California Golden Bears', 'basketball_ncaab'),
('Central Michigan Chippewas', 'Central Michigan Chippewas', 'basketball_ncaab'),
('Charlotte 49ers', 'Charlotte 49ers', 'basketball_ncaab'),
('Cincinnati Bearcats', 'Cincinnati Bearcats', 'basketball_ncaab'),
('Creighton Bluejays', 'Creighton Bluejays', 'basketball_ncaab'),
('Davidson Wildcats', 'Davidson Wildcats', 'basketball_ncaab'),
('Dayton Flyers', 'Dayton Flyers', 'basketball_ncaab'),
('DePaul Blue Demons', 'DePaul Blue Demons', 'basketball_ncaab'),
('Delaware Blue Hens', 'Delaware Blue Hens', 'basketball_ncaab'),
('Denver Pioneers', 'Denver Pioneers', 'basketball_ncaab'),
('Drake Bulldogs', 'Drake Bulldogs', 'basketball_ncaab'),
('Duquesne Dukes', 'Duquesne Dukes', 'basketball_ncaab'),
('East Carolina Pirates', 'East Carolina Pirates', 'basketball_ncaab'),
('East Texas A&M Lions', 'East Texas A&M Lions', 'basketball_ncaab'),
('Eastern Michigan Eagles', 'Eastern Michigan Eagles', 'basketball_ncaab'),
('Evansville Purple Aces', 'Evansville Purple Aces', 'basketball_ncaab'),
('Florida Gators', 'Florida Gators', 'basketball_ncaab'),
('Fordham Rams', 'Fordham Rams', 'basketball_ncaab'),
('George Mason Patriots', 'George Mason Patriots', 'basketball_ncaab'),
('Georgetown Hoyas', 'Georgetown Hoyas', 'basketball_ncaab'),
('Georgia Bulldogs', 'Georgia Bulldogs', 'basketball_ncaab'),
('Georgia Tech Yellow Jackets', 'Georgia Tech Yellow Jackets', 'basketball_ncaab'),
('Houston Christian Huskies', 'Houston Christian Huskies', 'basketball_ncaab'),
('Houston Cougars', 'Houston Cougars', 'basketball_ncaab'),
('Incarnate Word Cardinals', 'Incarnate Word Cardinals', 'basketball_ncaab'),
('Indiana Hoosiers', 'Indiana Hoosiers', 'basketball_ncaab'),
('Iowa Hawkeyes', 'Iowa Hawkeyes', 'basketball_ncaab'),
('Kent State Golden Flashes', 'Kent State Golden Flashes', 'basketball_ncaab'),
('Kentucky Wildcats', 'Kentucky Wildcats', 'basketball_ncaab'),
('LSU Tigers', 'LSU Tigers', 'basketball_ncaab'),
('La Salle Explorers', 'La Salle Explorers', 'basketball_ncaab'),
('Lamar Cardinals', 'Lamar Cardinals', 'basketball_ncaab'),
('Louisiana Tech Bulldogs', 'Louisiana Tech Bulldogs', 'basketball_ncaab'),
('Loyola Marymount Lions', 'Loyola Marymount Lions', 'basketball_ncaab'),
('Marquette Golden Eagles', 'Marquette Golden Eagles', 'basketball_ncaab'),
('Marshall Thundering Herd', 'Marshall Thundering Herd', 'basketball_ncaab'),
('Massachusetts Minutemen', 'Massachusetts Minutemen', 'basketball_ncaab'),
('McNeese Cowboys', 'McNeese Cowboys', 'basketball_ncaab'),
('Miami (OH) RedHawks', 'Miami (OH) RedHawks', 'basketball_ncaab'),
('Miami Hurricanes', 'Miami Hurricanes', 'basketball_ncaab'),
('Michigan Wolverines', 'Michigan Wolverines', 'basketball_ncaab'),
('Minnesota Golden Gophers', 'Minnesota Golden Gophers', 'basketball_ncaab'),
('Missouri Tigers', 'Missouri Tigers', 'basketball_ncaab'),
('NC State Wolfpack', 'NC State Wolfpack', 'basketball_ncaab'),
('Nebraska Cornhuskers', 'Nebraska Cornhuskers', 'basketball_ncaab'),
('Nevada Wolf Pack', 'Nevada Wolf Pack', 'basketball_ncaab'),
('New Mexico Lobos', 'New Mexico Lobos', 'basketball_ncaab'),
('New Orleans Privateers', 'New Orleans Privateers', 'basketball_ncaab'),
('North Texas Mean Green', 'North Texas Mean Green', 'basketball_ncaab'),
('Northern Illinois Huskies', 'Northern Illinois Huskies', 'basketball_ncaab'),
('Northern Iowa Panthers', 'Northern Iowa Panthers', 'basketball_ncaab'),
('Notre Dame Fighting Irish', 'Notre Dame Fighting Irish', 'basketball_ncaab'),
('Oakland Golden Grizzlies', 'Oakland Golden Grizzlies', 'basketball_ncaab'),
('Ohio Bobcats', 'Ohio Bobcats', 'basketball_ncaab'),
('Oklahoma Sooners', 'Oklahoma Sooners', 'basketball_ncaab'),
('Old Dominion Monarchs', 'Old Dominion Monarchs', 'basketball_ncaab'),
('Omaha Mavericks', 'Omaha Mavericks', 'basketball_ncaab'),
('Oregon Ducks', 'Oregon Ducks', 'basketball_ncaab'),
('Pacific Tigers', 'Pacific Tigers', 'basketball_ncaab'),
('Pepperdine Waves', 'Pepperdine Waves', 'basketball_ncaab'),
('Pittsburgh Panthers', 'Pittsburgh Panthers', 'basketball_ncaab'),
('Portland Pilots', 'Portland Pilots', 'basketball_ncaab'),
('Providence Friars', 'Providence Friars', 'basketball_ncaab'),
('Purdue Boilermakers', 'Purdue Boilermakers', 'basketball_ncaab'),
('Rhode Island Rams', 'Rhode Island Rams', 'basketball_ncaab'),
('Rice Owls', 'Rice Owls', 'basketball_ncaab'),
('Richmond Spiders', 'Richmond Spiders', 'basketball_ncaab'),
('Robert Morris Colonials', 'Robert Morris Colonials', 'basketball_ncaab'),
('Rutgers Scarlet Knights', 'Rutgers Scarlet Knights', 'basketball_ncaab'),
('SE Louisiana Lions', 'SE Louisiana Lions', 'basketball_ncaab'),
('Saint Joseph''s Hawks', 'Saint Joseph''s Hawks', 'basketball_ncaab'),
('Saint Louis Billikens', 'Saint Louis Billikens', 'basketball_ncaab'),
('San Diego Toreros', 'San Diego Toreros', 'basketball_ncaab'),
('San Francisco Dons', 'San Francisco Dons', 'basketball_ncaab'),
('Santa Clara Broncos', 'Santa Clara Broncos', 'basketball_ncaab'),
('Seton Hall Pirates', 'Seton Hall Pirates', 'basketball_ncaab'),
('South Carolina Gamecocks', 'South Carolina Gamecocks', 'basketball_ncaab'),
('South Florida Bulls', 'South Florida Bulls', 'basketball_ncaab'),
('Southern Illinois Salukis', 'Southern Illinois Salukis', 'basketball_ncaab'),
('St. Bonaventure Bonnies', 'St. Bonaventure Bonnies', 'basketball_ncaab'),
('St. John''s Red Storm', 'St. John''s Red Storm', 'basketball_ncaab'),
('Stanford Cardinal', 'Stanford Cardinal', 'basketball_ncaab'),
('Stephen F. Austin Lumberjacks', 'Stephen F. Austin Lumberjacks', 'basketball_ncaab'),
('Syracuse Orange', 'Syracuse Orange', 'basketball_ncaab'),
('TCU Horned Frogs', 'TCU Horned Frogs', 'basketball_ncaab'),
('Temple Owls', 'Temple Owls', 'basketball_ncaab'),
('Tennessee Volunteers', 'Tennessee Volunteers', 'basketball_ncaab'),
('Texas Longhorns', 'Texas Longhorns', 'basketball_ncaab'),
('Texas State Bobcats', 'Texas State Bobcats', 'basketball_ncaab'),
('Toledo Rockets', 'Toledo Rockets', 'basketball_ncaab'),
('Tulane Green Wave', 'Tulane Green Wave', 'basketball_ncaab'),
('Tulsa Golden Hurricane', 'Tulsa Golden Hurricane', 'basketball_ncaab'),
('UAB Blazers', 'UAB Blazers', 'basketball_ncaab'),
('UCF Knights', 'UCF Knights', 'basketball_ncaab'),
('UCLA Bruins', 'UCLA Bruins', 'basketball_ncaab'),
('UConn Huskies', 'UConn Huskies', 'basketball_ncaab'),
('UIC Flames', 'UIC Flames', 'basketball_ncaab'),
('UNLV Rebels', 'UNLV Rebels', 'basketball_ncaab'),
('USC Trojans', 'USC Trojans', 'basketball_ncaab'),
('UTEP Miners', 'UTEP Miners', 'basketball_ncaab'),
('UTSA Roadrunners', 'UTSA Roadrunners', 'basketball_ncaab'),
('Utah State Aggies', 'Utah State Aggies', 'basketball_ncaab'),
('VCU Rams', 'VCU Rams', 'basketball_ncaab'),
('Valparaiso Beacons', 'Valparaiso Beacons', 'basketball_ncaab'),
('Vanderbilt Commodores', 'Vanderbilt Commodores', 'basketball_ncaab'),
('Virginia Cavaliers', 'Virginia Cavaliers', 'basketball_ncaab'),
('Virginia Tech Hokies', 'Virginia Tech Hokies', 'basketball_ncaab'),
('Wake Forest Demon Deacons', 'Wake Forest Demon Deacons', 'basketball_ncaab'),
('West Virginia Mountaineers', 'West Virginia Mountaineers', 'basketball_ncaab'),
('Western Kentucky Hilltoppers', 'Western Kentucky Hilltoppers', 'basketball_ncaab'),
('Western Michigan Broncos', 'Western Michigan Broncos', 'basketball_ncaab'),
('Wisconsin Badgers', 'Wisconsin Badgers', 'basketball_ncaab'),
('Wyoming Cowboys', 'Wyoming Cowboys', 'basketball_ncaab'),
('Xavier Musketeers', 'Xavier Musketeers', 'basketball_ncaab'),

-- ABBREVIATION DIFFERENCES (St vs State)
('Arizona State Sun Devils', 'Arizona St Sun Devils', 'basketball_ncaab'),
('Arkansas State Red Wolves', 'Arkansas St Red Wolves', 'basketball_ncaab'),
('Colorado State Rams', 'Colorado St Rams', 'basketball_ncaab'),
('Florida State Seminoles', 'Florida St Seminoles', 'basketball_ncaab'),
('Illinois State Redbirds', 'Illinois St Redbirds', 'basketball_ncaab'),
('Indiana State Sycamores', 'Indiana St Sycamores', 'basketball_ncaab'),
('Jacksonville State Gamecocks', 'Jacksonville St Gamecocks', 'basketball_ncaab'),
('Kansas State Wildcats', 'Kansas St Wildcats', 'basketball_ncaab'),
('Kennesaw State Owls', 'Kennesaw St Owls', 'basketball_ncaab'),
('Michigan State Spartans', 'Michigan St Spartans', 'basketball_ncaab'),
('Mississippi State Bulldogs', 'Mississippi St Bulldogs', 'basketball_ncaab'),
('Missouri State Bears', 'Missouri St Bears', 'basketball_ncaab'),
('Murray State Racers', 'Murray St Racers', 'basketball_ncaab'),
('New Mexico State Aggies', 'New Mexico St Aggies', 'basketball_ncaab'),
('Northwestern State Demons', 'Northwestern St Demons', 'basketball_ncaab'),
('Oregon State Beavers', 'Oregon St Beavers', 'basketball_ncaab'),
('San Diego State Aztecs', 'San Diego St Aztecs', 'basketball_ncaab'),
('San José State Spartans', 'San José St Spartans', 'basketball_ncaab'),
('South Dakota State Jackrabbits', 'South Dakota St Jackrabbits', 'basketball_ncaab'),
('Washington State Cougars', 'Washington St Cougars', 'basketball_ncaab'),

-- SPECIAL CASES (Different formatting)
('Florida International Panthers', 'Florida Int''l Golden Panthers', 'basketball_ncaab'),
('Purdue Fort Wayne Mastodons', 'Fort Wayne Mastodons', 'basketball_ncaab'),
('George Washington Revolutionaries', 'GW Revolutionaries', 'basketball_ncaab'),
('Grand Canyon Lopes', 'Grand Canyon Antelopes', 'basketball_ncaab'),
('IU Indianapolis Jaguars', 'IUPUI Jaguars', 'basketball_ncaab'),
('Loyola Chicago Ramblers', 'Loyola (Chi) Ramblers', 'basketball_ncaab'),
('Nicholls Colonels', 'Nicholls St Colonels', 'basketball_ncaab'),
('Sam Houston Bearkats', 'Sam Houston St Bearkats', 'basketball_ncaab'),
('Seattle U Redhawks', 'Seattle Redhawks', 'basketball_ncaab'),
('Kansas City Roos', 'UMKC Kangaroos', 'basketball_ncaab')

ON CONFLICT (odds_api_name, league_id) DO UPDATE SET
    canonical_name = EXCLUDED.canonical_name;

-- ═══════════════════════════════════════════════════════════════════════════════
-- HELPER FUNCTION: Resolve team name to canonical
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION resolve_canonical_team(
    p_team_name TEXT,
    p_league_id TEXT DEFAULT 'basketball_ncaab'
) RETURNS TEXT AS $$
DECLARE
    v_canonical TEXT;
BEGIN
    -- Try exact match on odds_api_name first
    SELECT canonical_name INTO v_canonical
    FROM canonical_teams
    WHERE odds_api_name = p_team_name AND league_id = p_league_id;
    
    IF v_canonical IS NOT NULL THEN
        RETURN v_canonical;
    END IF;
    
    -- Try exact match on canonical_name (already canonical)
    SELECT canonical_name INTO v_canonical
    FROM canonical_teams
    WHERE canonical_name = p_team_name AND league_id = p_league_id;
    
    IF v_canonical IS NOT NULL THEN
        RETURN v_canonical;
    END IF;
    
    -- Return input as-is if no match (fallback)
    RETURN p_team_name;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON TABLE canonical_teams IS 'SSOT for team name resolution between Odds API and ESPN';
COMMENT ON FUNCTION resolve_canonical_team IS 'Resolves any team name variant to its canonical ESPN name';
