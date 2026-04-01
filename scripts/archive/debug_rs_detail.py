from nba_api.stats.endpoints import leaguegamefinder
import json

season = "2025-26"
try:
    print(f"Fetching game finder for {season}...")
    finder = leaguegamefinder.LeagueGameFinder(season_nullable=season, league_id_nullable="00")
    raw = finder.get_dict()
    rs = raw["resultSets"][0]
    print("Keys in ONE result set:")
    print(list(rs.keys()))
    print("Sample data from result set:")
    for k in rs.keys():
        val = rs[k]
        if isinstance(val, list):
            print(f"  {k}: list of length {len(val)}")
            if len(val) > 0:
                print(f"    sample: {val[0]}")
        else:
            print(f"  {k}: {type(val).__name__}")
except Exception as e:
    print(f"Error: {e}")
