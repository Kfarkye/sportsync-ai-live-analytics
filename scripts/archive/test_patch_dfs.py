import requests
import pandas as pd
import numpy as np
from urllib3.util.retry import Retry
from requests.adapters import HTTPAdapter
from nba_api.stats.library.http import NBAStatsHTTP, NBAStatsResponse

def setup_test_session():
    s = requests.Session()
    retries = Retry(total=5, backoff_factor=1.0, status_forcelist=[429, 500, 502, 503, 504])
    s.mount("https://", HTTPAdapter(max_retries=retries))
    s.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://stats.nba.com/",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "x-nba-stats-origin": "stats",
        "x-nba-stats-token": "true",
    })
    NBAStatsHTTP.get_session = staticmethod(lambda: s)
    NBAStatsHTTP._session = s

setup_test_session()

original_get_data_sets = NBAStatsResponse.get_data_sets

def patched_get_data_sets(self):
    try:
        raw_dict = self.get_dict()
        data_sets = None
        if "resultSet" in raw_dict:
            data_sets = raw_dict["resultSet"]
        elif "resultSets" in raw_dict:
            data_sets = raw_dict["resultSets"]
        
        if data_sets is None:
            return original_get_data_sets(self)

        if isinstance(data_sets, list):
            results = {}
            for ds in data_sets:
                if "name" in ds:
                    if "rowSet" in ds and "data" not in ds:
                        ds["data"] = ds["rowSet"]
                    results[ds["name"]] = ds
            return results
        
        if isinstance(data_sets, dict) and "name" in data_sets:
            if "rowSet" in data_sets and "data" not in data_sets:
                data_sets["data"] = data_sets["rowSet"]
            return {data_sets["name"]: data_sets}
            
        return data_sets
    except Exception:
        return original_get_data_sets(self)

NBAStatsResponse.get_data_sets = patched_get_data_sets

try:
    gid = "0022500420"
    print(f"Fetching playbyplay for {gid}...")
    from nba_api.stats.endpoints import playbyplayv2
    pbp = playbyplayv2.PlayByPlayV2(game_id=gid)
    dfs = pbp.get_data_frames()
    print(f"Success! Found {len(dfs)} data frames.")
    if len(dfs) > 0:
        print(dfs[0].head())
except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()
