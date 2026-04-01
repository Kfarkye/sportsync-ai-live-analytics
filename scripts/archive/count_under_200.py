import sys
import pandas as pd
try:
    from nba_api.stats.endpoints import leaguegamefinder
    print("Successfully imported nba_api", file=sys.stderr)
except ImportError as e:
    print(f"ImportError: {e}", file=sys.stderr)
    sys.exit(1)

def count_games_under_200():
    season = "2025-26"
    print(f"Fetching data for {season} season...", file=sys.stderr)
    try:
        finder = leaguegamefinder.LeagueGameFinder(season_nullable=season, league_id_nullable="00", season_type_nullable="Regular Season")
        games = finder.get_data_frames()[0]
        print(f"Data fetched: {len(games)} rows", file=sys.stderr)
        
        # Filter for NBA regular season games
        games = games[games["GAME_ID"].astype(str).str.startswith("002")]
        games = games[games["WL"].notna()]
        
        # Group by GAME_ID and sum PTS to get total points per game
        game_totals = games.groupby("GAME_ID")["PTS"].sum().reset_index()
        
        # Count games where total points < 200
        under_200 = game_totals[game_totals["PTS"] < 200]
        count = len(under_200)
        
        print(f"Total NBA regular season games played so far (2025-26): {len(game_totals)}")
        print(f"Games with < 200 total points: {count}")
        
        if count > 0:
            print("\nDetail of low-scoring games:")
            # Filter the original games DF for these IDs
            low_score_games = games[games["GAME_ID"].isin(under_200["GAME_ID"])]
            
            # Group by GAME_ID and iterate
            for gid, group in low_score_games.groupby("GAME_ID"):
                if len(group) == 2:
                    t1 = group.iloc[0]["TEAM_ABBREVIATION"]
                    s1 = group.iloc[0]["PTS"]
                    t2 = group.iloc[1]["TEAM_ABBREVIATION"]
                    s2 = group.iloc[1]["PTS"]
                    date = group.iloc[0]["GAME_DATE"]
                    total = s1 + s2
                    print(f"- {date}: {t1} ({s1}) vs {t2} ({s2}) | Total: {total}")
                else:
                    # Incomplete data for this game ID
                    t1 = group.iloc[0]["TEAM_ABBREVIATION"]
                    s1 = group.iloc[0]["PTS"]
                    print(f"- {group.iloc[0]['GAME_DATE']}: Game {gid} (Only {t1} {s1} found)")

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    count_games_under_200()
