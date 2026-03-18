import requests
import json
import pandas as pd

gid = "0022500366"
url = "https://stats.nba.com/stats/boxscoreadvancedv2"
params = {
    "GameID": gid,
    "StartPeriod": 4,
    "EndPeriod": 4,
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

try:
    print(f"Fetching raw JSON for {gid}...")
    resp = requests.get(url, params=params, headers=headers, timeout=30)
    print(f"Status: {resp.status_code}")
    data = resp.json()
    print("Keys found in JSON:")
    print(list(data.keys()))
    
    if "resultSets" in data:
        print("Structure uses 'resultSets' (plural)")
    elif "resultSet" in data:
        print("Structure uses 'resultSet' (singular)")
    else:
        print("Unexpected structure!")
        print(json.dumps(data, indent=2)[:1000])

except Exception as e:
    print(f"Error: {e}")
