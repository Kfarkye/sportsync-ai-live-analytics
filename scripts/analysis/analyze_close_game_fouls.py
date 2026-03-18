#!/usr/bin/env python3
import pandas as pd
from nba_api.stats.endpoints import leaguegamefinder
import sys

def main():
    print("Fetching 2025-26 season data...")
    finder = leaguegamefinder.LeagueGameFinder(
        season_nullable='2025-26', 
        league_id_nullable='00', 
        season_type_nullable='Regular Season'
    )
    df = finder.get_data_frames()[0]
    
    # 1. Identify "Close Games" (Final Score Margin <= 5)
    # Plus/Minus in LeagueGameFinder is from the perspective of the team in that row.
    # So abs(PLUS_MINUS) <= 5 means the game ended within 5 points.
    close_games_df = df[df['PLUS_MINUS'].abs() <= 5].copy()
    
    if close_games_df.empty:
        print("No close games found for 2025-26 yet.")
        return

    # 2. Aggregate PF (Personal Fouls) per team in these close games
    stats = close_games_df.groupby('TEAM_ABBREVIATION').agg({
        'PF': ['mean', 'count', 'max'],
        'PLUS_MINUS': 'mean'
    })
    
    # Flatten columns
    stats.columns = ['avg_fouls', 'game_count', 'max_fouls', 'avg_margin']
    
    # Sort by highest average fouls
    stats = stats.sort_values(by='avg_fouls', ascending=False)
    
    print("\nTop Fouling Teams in Close Games (Margin <= 5) - 2025-26 Season")
    print("=" * 70)
    print(stats.head(20).to_string())
    print("=" * 70)
    
    # Optional: Save to CSV for the user
    stats.to_csv("close_game_foul_stats_2025-26.csv")
    print("\nDetailed stats saved to close_game_foul_stats_2025-26.csv")

if __name__ == "__main__":
    main()
