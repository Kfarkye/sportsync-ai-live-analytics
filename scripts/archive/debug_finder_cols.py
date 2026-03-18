from nba_api.stats.endpoints import leaguegamefinder
import pandas as pd

season = "2025-26"
try:
    print(f"Fetching game finder for {season}...")
    finder = leaguegamefinder.LeagueGameFinder(season_nullable=season, league_id_nullable="00")
    df = finder.get_data_frames()[0]
    print("Columns in LeagueGameFinder:")
    print(df.columns.tolist())
    print("\nSample row:")
    print(df.iloc[0].to_dict())
except Exception as e:
    print(f"Error: {e}")
