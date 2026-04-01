from nba_api.stats.endpoints import leaguegamefinder
import json

season = "2025-26"
try:
    print(f"Fetching game finder for {season}...")
    finder = leaguegamefinder.LeagueGameFinder(season_nullable=season, league_id_nullable="00")
    raw = finder.get_dict()
    print("Keys in finder dict:")
    print(list(raw.keys()))
    if isinstance(raw, list):
        print(f"Raw is a LIST of length {len(raw)}")
        if len(raw) > 0:
            print("First item keys:")
            print(list(raw[0].keys()))
    else:
        print("Raw is a DICT")
        if "resultSets" in raw:
            print("Has resultSets")
        if "resultSet" in raw:
            print("Has resultSet")
except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()
