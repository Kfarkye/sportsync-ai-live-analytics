#!/usr/bin/env python3
import argparse
import json
import os
import sys
from supabase import create_client

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("file", help="Path to blowout_priors_XXXX.json")
    args = parser.parse_args()

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Error: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars")
        sys.exit(1)

    if not os.path.exists(args.file):
        print(f"Error: File {args.file} not found")
        sys.exit(1)

    with open(args.file, "r", encoding="utf-8") as f:
        data = json.load(f)

    sb = create_client(url, key)
    rows = []
    
    for p in data.get("priors", []):
        rows.append({
            "league": data.get("league", "NBA"),
            "season": data.get("season"),
            "team_abbr": p["team"],
            "leading": p.get("leading"),
            "trailing": p.get("trailing"),
            "baseline": p.get("baseline"),
            "meta": {
                "method": data.get("method"),
                "thresholds": data.get("thresholds"),
                "generated_at": data.get("generated_at")
            }
        })

    if rows:
        # Upsert using composite unique key
        res = sb.table("team_blowout_priors").upsert(
            rows, 
            on_conflict="league,season,team_abbr"
        ).execute()
        print(f"Successfully uploaded {len(rows)} rows from {args.file}.")
    else:
        print("No priors found in JSON.")

if __name__ == "__main__":
    main()
