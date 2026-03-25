"""
Backtest Calibration Harness — V3 Pricing Engine

Grid search over hyperparameters against historical box scores.
Finds the optimal combination of k, edge_thresh, market_edge_thresh, tt_edge_thresh.

Usage:
    from backtest_calibration import optimize_hyperparameters
    from pricing_engine_v3 import evaluate_kalshi_game

    df = optimize_hyperparameters(historical_games, evaluate_kalshi_game)
    print(df.head(10))

Input format (historical_games):
    List of dicts, each with:
        closing_total, home_spread, ref_h_data, ref_a_data,
        actual_home_score, actual_away_score,
        market_home_tt (optional), market_away_tt (optional)
"""
import itertools
import pandas as pd


def optimize_hyperparameters(historical_games, evaluate_fn):
    """
    Grid search over parameter space. Returns sorted DataFrame of results.
    Filters for statistical significance (>= 50 bets triggered).
    """
    # 1. Define the parameter grid to search
    grid = {
        'k': [3.0, 5.0, 7.0],
        'edge_thresh': [2.5, 3.0, 3.5],
        'market_edge_thresh': [1.5, 2.0, 2.5],
        'tt_edge_thresh': [2.0, 2.5, 3.0]
    }

    keys, values = zip(*grid.items())
    combinations = [dict(zip(keys, v)) for v in itertools.product(*values)]

    results = []

    # 2. Simulate the strategy over all parameter combinations
    for params in combinations:
        units_risked = 0.0
        units_won = 0.0
        bets = 0

        for game in historical_games:
            res = evaluate_fn(
                closing_total=game['closing_total'],
                home_spread=game['home_spread'],
                ref_h_data=game['ref_h_data'],
                ref_a_data=game['ref_a_data'],
                market_home_tt=game.get('market_home_tt'),
                market_away_tt=game.get('market_away_tt'),
                **params
            )

            if res['action'] == "PLAY":
                size = res['size_multiplier']
                bets += 1
                units_risked += size

                # 3. Grade the bet against actual box scores
                actual_home = game['actual_home_score']
                actual_away = game['actual_away_score']
                actual_total = actual_home + actual_away
                actual_margin = actual_home - actual_away

                win, push = False, False

                if res['market'] == "GAME TOTAL":
                    if res['play'] == "OVER":
                        win = actual_total > game['closing_total']
                        push = actual_total == game['closing_total']
                    else:
                        win = actual_total < game['closing_total']
                        push = actual_total == game['closing_total']

                elif res['market'] == "SPREAD":
                    market_margin = -game['home_spread']
                    if res['play'] == "HOME":
                        win = actual_margin > market_margin
                        push = actual_margin == market_margin
                    else:
                        win = actual_margin < market_margin
                        push = actual_margin == market_margin

                elif "TEAM TOTAL" in res['market']:
                    if "HOME" in res['market']:
                        tt_line = game.get('market_home_tt', (game['closing_total'] - game['home_spread']) / 2.0)
                        score = actual_home
                    else:
                        tt_line = game.get('market_away_tt', (game['closing_total'] + game['home_spread']) / 2.0)
                        score = actual_away

                    if res['play'] == "OVER":
                        win = score > tt_line
                        push = score == tt_line
                    else:
                        win = score < tt_line
                        push = score == tt_line

                # 4. Apply Vig (standard -110: risk 1.1 to win 1.0)
                if win:
                    units_won += size * (1.0 / 1.1)
                elif not push:
                    units_won -= size

        roi = (units_won / units_risked) if units_risked > 0 else 0
        results.append({
            **params,
            'bets': bets,
            'units_risked': round(units_risked, 2),
            'units_won': round(units_won, 2),
            'roi': round(roi, 4)
        })

    # 5. Output sorted by highest ROI
    df = pd.DataFrame(results)

    # Filter for statistical significance
    df_valid = df[df['bets'] >= 50]
    if df_valid.empty:
        return df.sort_values(by='roi', ascending=False)

    return df_valid.sort_values(by='roi', ascending=False)
