from nba_api.stats.endpoints import boxscoreadvancedv2
import pandas as pd
import sys

gid = "0022500366"
try:
    print(f"Fetching {gid}...")
    adv = boxscoreadvancedv2.BoxScoreAdvancedV2(game_id=gid, start_period=4, end_period=4)
    dfs = adv.get_data_frames()
    print(f"Dataframes found: {len(dfs)}")
    if len(dfs) > 1:
        print("Team Stats Sample:")
        print(dfs[1].head())
        print("Columns in Team Stats:")
        print(dfs[1].columns.tolist())
except Exception as e:
    print(f"Error: {type(e).__name__}: {e}")
