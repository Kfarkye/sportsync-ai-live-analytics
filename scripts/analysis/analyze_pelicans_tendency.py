import requests
import json
import pandas as pd

def get_nop_stats(gid, q):
    url = "https://stats.nba.com/stats/boxscoreadvancedv2"
    params = {
        "GameID": gid,
        "StartPeriod": q,
        "EndPeriod": q,
        "StartRange": 0,
        "EndRange": 0,
        "RangeType": 0
    }
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://stats.nba.com/",
        "x-nba-stats-origin": "stats",
        "x-nba-stats-token": "true",
    }
    
    resp = requests.get(url, params=params, headers=headers, timeout=30)
    data = resp.json()
    
    # Manually parse resultSets
    results = data.get("resultSets", [])
    if not results:
        results = data.get("resultSet", [])
    
    if isinstance(results, dict):
        results = [results]
        
    for ds in results:
        if ds.get("name") == "TeamStats":
            headers = ds.get("headers", [])
            rows = ds.get("rowSet", []) # or "data"
            if not rows and "data" in ds:
                rows = ds.get("data")
                
            df = pd.DataFrame(rows, columns=headers)
            nop = df[df['TEAM_ABBREVIATION'] == 'NOP']
            if not nop.empty:
                row = nop.iloc[0]
                return {
                    "Period": q,
                    "Pace": row['PACE'],
                    "ORTG": row['OFF_RATING'],
                    "DRTG": row['DEF_RATING'],
                    "NETR": row['NET_RATING']
                }
    return None

gid = "0022500366"
print(f"Analyzing quarterly performance for Pelicans (NOP) in game {gid}:")
all_stats = []
for q in range(1, 5):
    res = get_nop_stats(gid, q)
    if res:
        all_stats.append(res)
    else:
        print(f"Failed to get stats for Period {q}")

if all_stats:
    df = pd.DataFrame(all_stats)
    print(df)
else:
    print("No stats found.")
