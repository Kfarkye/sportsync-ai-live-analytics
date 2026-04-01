from nba_api.stats.endpoints import leaguegamefinder
import pandas as pd

def get_season_avgs(team_abbr, season="2025-26"):
    finder = leaguegamefinder.LeagueGameFinder(season_nullable=season, league_id_nullable="00", season_type_nullable="Regular Season")
    games = finder.get_data_frames()[0]
    team_games = games[games['TEAM_ABBREVIATION'] == team_abbr]
    
    team_games['POSS'] = team_games['FGA'] + (0.44 * team_games['FTA']) + team_games['TOV'] - team_games['OREB']
    team_games['PACE_CALC'] = (team_games['POSS'] / (team_games['MIN'] / 5)) * 48
    team_games['ORTG_CALC'] = (team_games['PTS'] / team_games['POSS']) * 100
    
    return {
        "Avg Pace": team_games['PACE_CALC'].mean(),
        "Avg ORTG": team_games['ORTG_CALC'].mean(),
        "Games": len(team_games)
    }

print("Miami Heat Season Averages (2025-26):")
print(get_season_avgs("MIA", "2025-26"))
