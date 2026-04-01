from nba_api.stats.endpoints import leaguegamefinder
import pandas as pd

def get_season_avgs(team_abbr, season="2024-25"):
    finder = leaguegamefinder.LeagueGameFinder(season_nullable=season, league_id_nullable="00", season_type_nullable="Regular Season")
    games = finder.get_data_frames()[0]
    team_games = games[games['TEAM_ABBREVIATION'] == team_abbr]
    
    # Calculate simple Pace proxy: (FGA + 0.44*FTA + TOV - OREB) / (MIN/5) * 48
    # Note: This is an approximation
    team_games['POSS'] = team_games['FGA'] + (0.44 * team_games['FTA']) + team_games['TOV'] - team_games['OREB']
    team_games['PACE_CALC'] = (team_games['POSS'] / (team_games['MIN'] / 5)) * 48
    team_games['ORTG_CALC'] = (team_games['PTS'] / team_games['POSS']) * 100
    
    return {
        "Avg Pace": team_games['PACE_CALC'].mean(),
        "Avg ORTG": team_games['ORTG_CALC'].mean(),
        "Games": len(team_games)
    }

print("Pelicans Season Averages (2024-25):")
print(get_season_avgs("NOP", "2024-25"))
print("\nPelicans Season Averages (2025-26):")
print(get_season_avgs("NOP", "2025-26"))
