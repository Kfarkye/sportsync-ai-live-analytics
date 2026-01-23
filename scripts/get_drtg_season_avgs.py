from nba_api.stats.endpoints import leaguegamefinder
import pandas as pd

def get_defensive_averages(team_abbr, season="2025-26"):
    finder = leaguegamefinder.LeagueGameFinder(season_nullable=season, league_id_nullable="00", season_type_nullable="Regular Season")
    games = finder.get_data_frames()[0]
    
    # Get all games where this team played
    team_game_ids = games[games['TEAM_ABBREVIATION'] == team_abbr]['GAME_ID'].unique()
    relevant_games = games[games['GAME_ID'].isin(team_game_ids)]
    
    # For DRTG, we need the OPPONENT'S ORTG against this team
    opponents_vs_team = relevant_games[relevant_games['TEAM_ABBREVIATION'] != team_abbr]
    
    # Calculate opponent possessions to get their ORTG (which is our DRTG)
    opponents_vs_team['OPP_POSS'] = opponents_vs_team['FGA'] + (0.44 * opponents_vs_team['FTA']) + opponents_vs_team['TOV'] - opponents_vs_team['OREB']
    opponents_vs_team['OPP_ORTG'] = (opponents_vs_team['PTS'] / opponents_vs_team['OPP_POSS']) * 100
    
    return {
        "Avg DRTG": opponents_vs_team['OPP_ORTG'].mean(),
        "Games": len(opponents_vs_team)
    }

print("Pelicans Defensive Averages (2025-26):")
print(get_defensive_averages("NOP"))
print("\nMiami Heat Defensive Averages (2025-26):")
print(get_defensive_averages("MIA"))
