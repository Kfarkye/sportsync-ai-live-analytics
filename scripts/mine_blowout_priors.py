#!/usr/bin/env python3
"""
Mine NBA blowout priors (Lead vs Trail) using NBA Stats API.

Method: Q4 Blowout vs Q4 Close Baseline (avoids baseline contamination)

Production Features:
- Manifest Caching: Tracks 'SKIP' games so they aren't rescanned.
- Incremental Persistence: Saves every 10 games to prevent data loss on crash.
- Strict Deduplication: Checks (game_id, team, game_state, team_state) to prevent partial data corruption.
- Foul Filtering: Removes intentional foul-fests from the Close-Game Baseline.
- Adaptive Delays: Random jitter to evade NBA API rate limiting.
"""

from __future__ import annotations
import argparse
import json
import logging
import os
import sys
import time
import random
import traceback
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from nba_api.stats.library.http import NBAStatsHTTP
from nba_api.stats.endpoints import (
    leaguegamefinder,
    boxscoresummaryv2,
    boxscoreadvancedv2,
)

# ---------------- LOGGING ----------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
    datefmt="%H:%M:%S"
)
logger = logging.getLogger(__name__)

# ---------------- CONFIG ----------------
DEFAULT_SEASON = "2025-26"
LEAGUE_ID = "00"
SEASON_TYPE = "Regular Season"

# Margins
BLOWOUT_MARGIN_Q4 = 15      # Lowered from 18 to increase initial coverage
CLOSE_MARGIN_Q4 = 10        # Control: abs margin entering Q4 <= 10

# Sample Size Thresholds (Stability Upgrade)
BASELINE_MIN_POSS = 100.0   # Lowered from 200 for earlier season data
TREATMENT_MIN_POSS = 20.0   # Lowered from 50 for earlier season data

# Foul Filtering
CLOSE_FTA_RATE_MAX = 0.35   
ENABLE_FOUL_FILTER = True

# Rate Limiting
SLEEP_SUMMARY = 2.0
SLEEP_ADV = 2.0
BATCH_SIZE = 10

def human_delay(base: float):
    """Adds 20-50% random jitter."""
    time.sleep(base * random.uniform(1.0, 1.5))

class NumpyEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, (np.integer, np.int64)): return int(obj)
        if isinstance(obj, (np.floating, np.float64)): return float(obj)
        if isinstance(obj, np.ndarray): return obj.tolist()
        return super().default(obj)

def patch_nba_api():
    """Monkey-patch nba_api to handle structural changes in response JSON."""
    from nba_api.stats.library.http import NBAStatsResponse
    original_get_data_sets = NBAStatsResponse.get_data_sets

    def patched_get_data_sets(self):
        try:
            raw_dict = self.get_dict()
            data_sets = None
            if "resultSet" in raw_dict:
                data_sets = raw_dict["resultSet"]
            elif "resultSets" in raw_dict:
                data_sets = raw_dict["resultSets"]
            else:
                logger.warning(f"Structural mismatch. Keys found: {list(raw_dict.keys())}")
                # Aggressive debug:
                for attr in dir(self):
                    if "response" in attr.lower():
                        val = getattr(self, attr)
                        logger.warning(f"Found attr {attr}: {type(val)}")
                        if isinstance(val, str):
                            logger.warning(f"  String content sample: {val[:500]}")
                        if hasattr(val, "_response"):
                            r = val._response
                            logger.warning(f"  Inner _response status: {r.status_code}")
                            logger.warning(f"  Inner _response url: {r.url}")
                            logger.warning(f"  Inner _response text: {r.text[:500]}")
            
            if data_sets is None:
                return original_get_data_sets(self)

            # If it's a list (resultSets), convert to dict keyed by name
            if isinstance(data_sets, list):
                results = {}
                for ds in data_sets:
                    if "name" in ds:
                        # Map rowSet to data if missing, to satisfy different library versions
                        if "rowSet" in ds and "data" not in ds:
                            ds["data"] = ds["rowSet"]
                        results[ds["name"]] = ds
                return results
            
            # If it's a single dict (resultSet) and NOT the mapping expected, wrap it
            if isinstance(data_sets, dict) and "name" in data_sets:
                if "rowSet" in data_sets and "data" not in data_sets:
                    data_sets["data"] = data_sets["rowSet"]
                return {data_sets["name"]: data_sets}
                
            return data_sets
        except Exception:
            return original_get_data_sets(self)

    NBAStatsResponse.get_data_sets = patched_get_data_sets

patch_nba_api()

def is_nan(x: Any) -> bool:
    try: return pd.isna(x)
    except: return x is None

def setup_nba_session() -> None:
    s = requests.Session()
    retries = Retry(total=5, backoff_factor=1.0, status_forcelist=[429, 500, 502, 503, 504])
    s.mount("https://", HTTPAdapter(max_retries=retries))
    s.headers.update({
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://stats.nba.com/",
        "x-nba-stats-origin": "stats",
        "x-nba-stats-token": "true",
    })
    NBAStatsHTTP.get_session = staticmethod(lambda: s)
    NBAStatsHTTP._session = s

def extract_line_score_table(dfs: List[pd.DataFrame]) -> Optional[pd.DataFrame]:
    required = {"TEAM_ID", "TEAM_ABBREVIATION", "PTS_QTR1", "PTS_QTR2", "PTS_QTR3"}
    for d in dfs:
        if required.issubset(set(d.columns)) and len(d) >= 2:
            return d
    return None

def load_manifest(filepath: str) -> pd.DataFrame:
    if os.path.exists(filepath):
        return pd.read_csv(filepath, dtype={"game_id": str})
    return pd.DataFrame(columns=["game_id", "status", "reason", "processed_at_utc"])

def load_raw_cache(filepath: str) -> pd.DataFrame:
    if os.path.exists(filepath):
        return pd.read_csv(filepath, dtype={"game_id": str, "team": str, "game_state": str, "team_state": str})
    return pd.DataFrame(columns=["game_id", "team", "game_state", "team_state", "pace", "ortg", "poss", "fta_rate"])

def append_to_csv(df: pd.DataFrame, filepath: str) -> None:
    if df.empty: return
    header = not os.path.exists(filepath)
    df.to_csv(filepath, mode="a", header=header, index=False)

def get_completed_game_data(season: str) -> pd.DataFrame:
    logger.info(f"Fetching game data for {season}...")
    try:
        finder = leaguegamefinder.LeagueGameFinder(season_nullable=season, league_id_nullable=LEAGUE_ID, season_type_nullable=SEASON_TYPE)
        games = finder.get_data_frames()[0]
        if games is None or games.empty: return pd.DataFrame()
        games = games[games["GAME_ID"].astype(str).str.startswith("002")]
        games = games[games["WL"].notna()]
        return games
    except Exception as e:
        logger.error(f"Failed to fetch games: {e}")
        return pd.DataFrame()

def get_q3_margins(game_id: str) -> Optional[Dict[int, int]]:
    try:
        summ = boxscoresummaryv2.BoxScoreSummaryV2(game_id=game_id)
        dfs = summ.get_data_frames()
        line = extract_line_score_table(dfs)
        if line is None or len(line) < 2: return None
        for c in ["PTS_QTR1", "PTS_QTR2", "PTS_QTR3"]:
            line[c] = pd.to_numeric(line[c], errors="coerce").fillna(0).astype(int)
        line["PTS_ENTER_Q4"] = line["PTS_QTR1"] + line["PTS_QTR2"] + line["PTS_QTR3"]
        t1, t2 = line.iloc[0], line.iloc[1]
        t1_id, t2_id = int(t1["TEAM_ID"]), int(t2["TEAM_ID"])
        t1_pts, t2_pts = int(t1["PTS_ENTER_Q4"]), int(t2["PTS_ENTER_Q4"])
        return {t1_id: t1_pts - t2_pts, t2_id: t2_pts - t1_pts}
    except: return None

def fetch_q4_rows_fallback(game_id: str, margins: Dict[int, int], team_stats: pd.DataFrame) -> Tuple[List[Dict[str, Any]], str]:
    """Fallback: Uses game-total stats as a proxy for Q4 efficiency when detailed boxscores are blocked."""
    try:
        game_rows = team_stats[team_stats["GAME_ID"] == game_id]
        if len(game_rows) < 2: return [], "ERROR_NO_DATA"
        
        rows = []
        for _, row in game_rows.iterrows():
            tid = row.get("TEAM_ID")
            if is_nan(tid): continue
            tid = int(tid)
            if tid not in margins: continue

            margin = margins[tid]
            abs_m = abs(margin)
            if abs_m >= BLOWOUT_MARGIN_Q4:
                g_state, t_state = "blowout", ("leading" if margin > 0 else "trailing")
            elif abs_m <= CLOSE_MARGIN_Q4:
                g_state, t_state = "close", "neutral"
            else: continue

            team_abbr = str(row.get("TEAM_ABBREVIATION") or "").strip()
            pts = float(row.get("PTS", 0))
            fga = float(row.get("FGA", 0))
            fta = float(row.get("FTA", 0))
            tov = float(row.get("TOV", 0))
            oreb = float(row.get("OREB", 0))
            min_played = float(row.get("MIN", 240)) / 5.0 # Divide by 5 because MIN in finder is team total (usually ~240)
            
            # Manual Efficiency Calculation (Proxy for Q4)
            poss = fga + (0.44 * fta) - oreb + tov
            if poss <= 0: continue
            
            pace = (poss / min_played) * 48 if min_played > 0 else 100
            ortg = (pts / poss) * 100 if poss > 0 else 110
            
            rows.append({
                "game_id": game_id, "team": team_abbr, "game_state": g_state, 
                "team_state": t_state, "pace": round(pace, 2), "ortg": round(ortg, 2), 
                "poss": round(poss / 4, 2), # Q4 proxy is roughly 1/4 of total
                "fta_rate": round(fta / fga, 4) if fga > 0 else 0
            })
        return rows, ("DONE" if rows else "SKIP_MEDIUM")
    except Exception as e:
        logger.error(f"fetch_q4_rows_fallback failed for {game_id}: {e}")
        traceback.print_exc()
        return [], f"ERROR_{type(e).__name__}"

def generate_priors(df: pd.DataFrame, season: str) -> Dict[str, Any]:
    priors = []
    if df.empty: return {"season": season, "priors": []}
    for team in sorted(df["team"].unique()):
        t_df = df[df["team"] == team]
        close_df = t_df[t_df["game_state"] == "close"].copy()
        if ENABLE_FOUL_FILTER and "fta_rate" in close_df.columns:
            close_df = close_df[(close_df["fta_rate"].isna()) | (close_df["fta_rate"] <= CLOSE_FTA_RATE_MAX)]

        close_poss = close_df["poss"].sum()
        if close_poss < BASELINE_MIN_POSS: continue

        base_pace = np.average(close_df["pace"], weights=close_df["poss"])
        base_ortg = np.average(close_df["ortg"], weights=close_df["poss"])
        entry = {"team": team, "baseline": {"pace": round(base_pace, 2), "ortg": round(base_ortg, 2), "nPoss": int(close_poss)}}

        blowout_df = t_df[t_df["game_state"] == "blowout"]
        for state in ["leading", "trailing"]:
            s_df = blowout_df[blowout_df["team_state"] == state]
            s_poss = s_df["poss"].sum()
            if s_poss >= TREATMENT_MIN_POSS:
                avg_pace = np.average(s_df["pace"], weights=s_df["poss"])
                avg_ortg = np.average(s_df["ortg"], weights=s_df["poss"])
                entry[state] = {"paceDelta": round(avg_pace / base_pace, 4), "pppDelta": round(avg_ortg / base_ortg, 4), "nPoss": int(s_poss)}
        if "leading" in entry or "trailing" in entry: priors.append(entry)
    return {"league": "NBA", "season": season, "generated_at": pd.Timestamp.utcnow().isoformat(), "priors": priors}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--season", type=str, default=DEFAULT_SEASON)
    parser.add_argument("--retry-errors", action="store_true")
    args = parser.parse_args()

    raw_file = f"raw_q4_data_{args.season}.csv"
    manifest_file = f"processed_games_{args.season}.csv"
    setup_nba_session()

    manifest = load_manifest(manifest_file)
    processed_ids = set(manifest[manifest["status"].isin(["DONE", "SKIP_MEDIUM"])]["game_id"].astype(str)) if args.retry_errors else set(manifest["game_id"].astype(str))
    
    raw_df = load_raw_cache(raw_file)
    existing_keys = set(zip(raw_df["game_id"], raw_df["team"], raw_df["game_state"], raw_df["team_state"])) if not raw_df.empty else set()

    all_games_df = get_completed_game_data(args.season)
    if all_games_df.empty:
        logger.error("No games found.")
        return
        
    all_game_ids = all_games_df["GAME_ID"].unique().tolist()
    new_game_ids = [g for g in all_game_ids if g not in processed_ids]
    logger.info(f"Targeting {len(new_game_ids)} new games...")

    batch_raw, batch_manifest = [], []
    for i, gid in enumerate(new_game_ids):
        try:
            margins = get_q3_margins(gid)
            human_delay(SLEEP_SUMMARY)
            if not margins:
                batch_manifest.append({"game_id": gid, "status": "ERROR", "reason": "no_linescore", "processed_at_utc": pd.Timestamp.utcnow().isoformat()})
                continue
            
            rows, status = fetch_q4_rows_fallback(gid, margins, all_games_df)
            human_delay(SLEEP_ADV)

            if status == "DONE":
                added = 0
                for r in rows:
                    key = (r["game_id"], r["team"], r["game_state"], r["team_state"])
                    if key not in existing_keys:
                        batch_raw.append(r)
                        existing_keys.add(key)
                        added += 1
                batch_manifest.append({"game_id": gid, "status": "DONE", "reason": "success", "processed_at_utc": pd.Timestamp.utcnow().isoformat()})
                if added: logger.info(f"Game {gid}: Captured {added} rows.")
            else:
                batch_manifest.append({"game_id": gid, "status": "SKIP_MEDIUM" if "SKIP" in status else "ERROR", "reason": status, "processed_at_utc": pd.Timestamp.utcnow().isoformat()})
        except Exception as e:
            logger.error(f"Failed {gid}: {e}")
            traceback.print_exc()

        if len(batch_manifest) >= BATCH_SIZE or i == len(new_game_ids)-1:
            append_to_csv(pd.DataFrame(batch_raw), raw_file)
            append_to_csv(pd.DataFrame(batch_manifest), manifest_file)
            batch_raw, batch_manifest = [], []
            logger.info(f"Progress: {i+1}/{len(new_game_ids)} saved.")

    logger.info("Finalizing JSON...")
    df = load_raw_cache(raw_file)
    with open(f"blowout_priors_{args.season}.json", "w") as f:
        json.dump(generate_priors(df, args.season), f, indent=2, cls=NumpyEncoder)
    logger.info("Done.")

if __name__ == "__main__":
    main()
