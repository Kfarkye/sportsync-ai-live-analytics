import pandas as pd

def calculate_q4_drtg(target_team, csv_path="raw_q4_data_2025-26.csv"):
    df = pd.read_csv(csv_path, names=["game_id", "team", "game_state", "team_state", "pace", "ortg", "poss", "fta_rate"])
    
    # Ensure numeric types
    df['ortg'] = pd.to_numeric(df['ortg'], errors='coerce')
    
    # Get all game IDs for the target team
    target_games = df[df['team'] == target_team]['game_id'].unique()
    
    results = []
    for gid in target_games:
        # Find the game rows
        game_rows = df[df['game_id'] == gid]
        if len(game_rows) >= 2:
            # The opponent's ORTG is our DRTG
            opponent_row = game_rows[game_rows['team'] != target_team]
            if not opponent_row.empty:
                val = opponent_row.iloc[0]['ortg']
                if not pd.isna(val):
                    results.append(val)
    
    if results:
        avg_drtg = sum(results) / len(results)
        return avg_drtg, len(results)
    return 0, 0

print("Pelicans Q4 Defensive Average (2025-26):")
drtg_nop, count_nop = calculate_q4_drtg("NOP")
print(f"Avg Q4 DRTG: {drtg_nop:.2f} (Games: {count_nop})")

print("\nMiami Heat Q4 Defensive Average (2025-26):")
drtg_mia, count_mia = calculate_q4_drtg("MIA")
print(f"Avg Q4 DRTG: {drtg_mia:.2f} (Games: {count_mia})")
