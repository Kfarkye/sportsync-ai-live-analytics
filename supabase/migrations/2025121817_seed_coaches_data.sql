-- ============================================================================
-- COACHES SEED DATA - 2024-25 Season (CORRECT ESPN TEAM IDs)
-- All major sports leagues with current head coaches
-- ============================================================================

-- Clear existing data and reseed
TRUNCATE TABLE coaches;

-- ============================================================================
-- NFL COACHES (2024-25 Season) - Using ESPN Team IDs
-- ============================================================================
INSERT INTO coaches (team_id, team_name, team_abbrev, coach_name, sport, league_id) VALUES
('22', 'Arizona Cardinals', 'ARI', 'Jonathan Gannon', 'NFL', 'nfl'),
('1', 'Atlanta Falcons', 'ATL', 'Raheem Morris', 'NFL', 'nfl'),
('33', 'Baltimore Ravens', 'BAL', 'John Harbaugh', 'NFL', 'nfl'),
('2', 'Buffalo Bills', 'BUF', 'Sean McDermott', 'NFL', 'nfl'),
('29', 'Carolina Panthers', 'CAR', 'Dave Canales', 'NFL', 'nfl'),
('3', 'Chicago Bears', 'CHI', 'Matt Eberflus', 'NFL', 'nfl'),
('4', 'Cincinnati Bengals', 'CIN', 'Zac Taylor', 'NFL', 'nfl'),
('5', 'Cleveland Browns', 'CLE', 'Kevin Stefanski', 'NFL', 'nfl'),
('6', 'Dallas Cowboys', 'DAL', 'Mike McCarthy', 'NFL', 'nfl'),
('7', 'Denver Broncos', 'DEN', 'Sean Payton', 'NFL', 'nfl'),
('8', 'Detroit Lions', 'DET', 'Dan Campbell', 'NFL', 'nfl'),
('9', 'Green Bay Packers', 'GB', 'Matt LaFleur', 'NFL', 'nfl'),
('34', 'Houston Texans', 'HOU', 'DeMeco Ryans', 'NFL', 'nfl'),
('11', 'Indianapolis Colts', 'IND', 'Shane Steichen', 'NFL', 'nfl'),
('30', 'Jacksonville Jaguars', 'JAX', 'Doug Pederson', 'NFL', 'nfl'),
('12', 'Kansas City Chiefs', 'KC', 'Andy Reid', 'NFL', 'nfl'),
('13', 'Las Vegas Raiders', 'LV', 'Antonio Pierce', 'NFL', 'nfl'),
('24', 'Los Angeles Chargers', 'LAC', 'Jim Harbaugh', 'NFL', 'nfl'),
('14', 'Los Angeles Rams', 'LAR', 'Sean McVay', 'NFL', 'nfl'),
('15', 'Miami Dolphins', 'MIA', 'Mike McDaniel', 'NFL', 'nfl'),
('16', 'Minnesota Vikings', 'MIN', 'Kevin O''Connor', 'NFL', 'nfl'),
('17', 'New England Patriots', 'NE', 'Jerod Mayo', 'NFL', 'nfl'),
('18', 'New Orleans Saints', 'NO', 'Dennis Allen', 'NFL', 'nfl'),
('19', 'New York Giants', 'NYG', 'Brian Daboll', 'NFL', 'nfl'),
('20', 'New York Jets', 'NYJ', 'Robert Saleh', 'NFL', 'nfl'),
('21', 'Philadelphia Eagles', 'PHI', 'Nick Sirianni', 'NFL', 'nfl'),
('23', 'Pittsburgh Steelers', 'PIT', 'Mike Tomlin', 'NFL', 'nfl'),
('25', 'San Francisco 49ers', 'SF', 'Kyle Shanahan', 'NFL', 'nfl'),
('26', 'Seattle Seahawks', 'SEA', 'Mike Macdonald', 'NFL', 'nfl'),
('27', 'Tampa Bay Buccaneers', 'TB', 'Todd Bowles', 'NFL', 'nfl'),
('10', 'Tennessee Titans', 'TEN', 'Brian Callahan', 'NFL', 'nfl'),
('28', 'Washington Commanders', 'WSH', 'Dan Quinn', 'NFL', 'nfl');

-- ============================================================================
-- NBA COACHES (2024-25 Season) - Using ESPN Team IDs
-- ============================================================================
INSERT INTO coaches (team_id, team_name, team_abbrev, coach_name, sport, league_id) VALUES
('1', 'Atlanta Hawks', 'ATL', 'Quin Snyder', 'NBA', 'nba'),
('2', 'Boston Celtics', 'BOS', 'Joe Mazzulla', 'NBA', 'nba'),
('17', 'Brooklyn Nets', 'BKN', 'Jordi Fernández', 'NBA', 'nba'),
('30', 'Charlotte Hornets', 'CHA', 'Charles Lee', 'NBA', 'nba'),
('4', 'Chicago Bulls', 'CHI', 'Billy Donovan', 'NBA', 'nba'),
('5', 'Cleveland Cavaliers', 'CLE', 'Kenny Atkinson', 'NBA', 'nba'),
('6', 'Dallas Mavericks', 'DAL', 'Jason Kidd', 'NBA', 'nba'),
('7', 'Denver Nuggets', 'DEN', 'Michael Malone', 'NBA', 'nba'),
('8', 'Detroit Pistons', 'DET', 'J.B. Bickerstaff', 'NBA', 'nba'),
('9', 'Golden State Warriors', 'GS', 'Steve Kerr', 'NBA', 'nba'),
('10', 'Houston Rockets', 'HOU', 'Ime Udoka', 'NBA', 'nba'),
('11', 'Indiana Pacers', 'IND', 'Rick Carlisle', 'NBA', 'nba'),
('12', 'LA Clippers', 'LAC', 'Tyronn Lue', 'NBA', 'nba'),
('13', 'Los Angeles Lakers', 'LAL', 'JJ Redick', 'NBA', 'nba'),
('29', 'Memphis Grizzlies', 'MEM', 'Taylor Jenkins', 'NBA', 'nba'),
('14', 'Miami Heat', 'MIA', 'Erik Spoelstra', 'NBA', 'nba'),
('15', 'Milwaukee Bucks', 'MIL', 'Doc Rivers', 'NBA', 'nba'),
('16', 'Minnesota Timberwolves', 'MIN', 'Chris Finch', 'NBA', 'nba'),
('3', 'New Orleans Pelicans', 'NO', 'Willie Green', 'NBA', 'nba'),
('18', 'New York Knicks', 'NY', 'Tom Thibodeau', 'NBA', 'nba'),
('25', 'Oklahoma City Thunder', 'OKC', 'Mark Daigneault', 'NBA', 'nba'),
('19', 'Orlando Magic', 'ORL', 'Jamahl Mosley', 'NBA', 'nba'),
('20', 'Philadelphia 76ers', 'PHI', 'Nick Nurse', 'NBA', 'nba'),
('21', 'Phoenix Suns', 'PHX', 'Mike Budenholzer', 'NBA', 'nba'),
('22', 'Portland Trail Blazers', 'POR', 'Chauncey Billups', 'NBA', 'nba'),
('23', 'Sacramento Kings', 'SAC', 'Mike Brown', 'NBA', 'nba'),
('24', 'San Antonio Spurs', 'SA', 'Gregg Popovich', 'NBA', 'nba'),
('28', 'Toronto Raptors', 'TOR', 'Darko Rajaković', 'NBA', 'nba'),
('26', 'Utah Jazz', 'UTAH', 'Will Hardy', 'NBA', 'nba'),
('27', 'Washington Wizards', 'WSH', 'Brian Keefe', 'NBA', 'nba');

-- ============================================================================
-- NHL COACHES (2024-25 Season) - Using ESPN Team IDs
-- ============================================================================
INSERT INTO coaches (team_id, team_name, team_abbrev, coach_name, sport, league_id) VALUES
('25', 'Anaheim Ducks', 'ANA', 'Greg Cronin', 'NHL', 'nhl'),
('1', 'Boston Bruins', 'BOS', 'Jim Montgomery', 'NHL', 'nhl'),
('2', 'Buffalo Sabres', 'BUF', 'Lindy Ruff', 'NHL', 'nhl'),
('3', 'Calgary Flames', 'CGY', 'Ryan Huska', 'NHL', 'nhl'),
('7', 'Carolina Hurricanes', 'CAR', 'Rod Brind''Amour', 'NHL', 'nhl'),
('4', 'Chicago Blackhawks', 'CHI', 'Luke Richardson', 'NHL', 'nhl'),
('17', 'Colorado Avalanche', 'COL', 'Jared Bednar', 'NHL', 'nhl'),
('29', 'Columbus Blue Jackets', 'CBJ', 'Dean Evason', 'NHL', 'nhl'),
('9', 'Dallas Stars', 'DAL', 'Peter DeBoer', 'NHL', 'nhl'),
('5', 'Detroit Red Wings', 'DET', 'Derek Lalonde', 'NHL', 'nhl'),
('6', 'Edmonton Oilers', 'EDM', 'Kris Knoblauch', 'NHL', 'nhl'),
('26', 'Florida Panthers', 'FLA', 'Paul Maurice', 'NHL', 'nhl'),
('8', 'Los Angeles Kings', 'LA', 'Jim Hiller', 'NHL', 'nhl'),
('30', 'Minnesota Wild', 'MIN', 'John Hynes', 'NHL', 'nhl'),
('10', 'Montreal Canadiens', 'MTL', 'Martin St. Louis', 'NHL', 'nhl'),
('27', 'Nashville Predators', 'NSH', 'Andrew Brunette', 'NHL', 'nhl'),
('11', 'New Jersey Devils', 'NJ', 'Sheldon Keefe', 'NHL', 'nhl'),
('12', 'New York Islanders', 'NYI', 'Patrick Roy', 'NHL', 'nhl'),
('13', 'New York Rangers', 'NYR', 'Peter Laviolette', 'NHL', 'nhl'),
('14', 'Ottawa Senators', 'OTT', 'Travis Green', 'NHL', 'nhl'),
('15', 'Philadelphia Flyers', 'PHI', 'John Tortorella', 'NHL', 'nhl'),
('16', 'Pittsburgh Penguins', 'PIT', 'Mike Sullivan', 'NHL', 'nhl'),
('18', 'San Jose Sharks', 'SJ', 'Ryan Warsofsky', 'NHL', 'nhl'),
('124292', 'Seattle Kraken', 'SEA', 'Dan Bylsma', 'NHL', 'nhl'),
('19', 'St. Louis Blues', 'STL', 'Drew Bannister', 'NHL', 'nhl'),
('20', 'Tampa Bay Lightning', 'TB', 'Jon Cooper', 'NHL', 'nhl'),
('21', 'Toronto Maple Leafs', 'TOR', 'Craig Berube', 'NHL', 'nhl'),
('129764', 'Utah Hockey Club', 'UTAH', 'André Tourigny', 'NHL', 'nhl'),
('22', 'Vancouver Canucks', 'VAN', 'Rick Tocchet', 'NHL', 'nhl'),
('37', 'Vegas Golden Knights', 'VGK', 'Bruce Cassidy', 'NHL', 'nhl'),
('23', 'Washington Capitals', 'WSH', 'Spencer Carbery', 'NHL', 'nhl'),
('28', 'Winnipeg Jets', 'WPG', 'Scott Arniel', 'NHL', 'nhl');
