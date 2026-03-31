"""
V3 Pricing Engine — Production Locked (2026-03-25)

Referee-based edge detection with:
  1. Empirical Bayes shrinkage (low-sample noise dampening)
  2. Cross-coupled offensive/defensive arbitration
  3. Continuous conflict penalty (overlapping contradiction scaling)
  4. Shape-based capital routing (7 geometric profiles)
  5. Strict market-edge gating (no fire without vig confirmation)

Verdict: DRIP.OBJ.PRICING_ENGINE.V3
"""


def apply_shrinkage(raw_dev, games, baseline=0.0, k=5.0):
    """Continuous empirical Bayes shrinkage."""
    if games < 3:
        return baseline, 0.0
    shrink_factor = float(games) / (float(games) + k)
    adj_dev = (raw_dev * shrink_factor) + (baseline * (1.0 - shrink_factor))
    return adj_dev, float(games)


def calculate_conflict_multiplier(view_a, view_b, max_overlap=4.0):
    """
    Replaces the binary 0.5 haircut with an overlapping conflict penalty.
    +6.0 vs -0.3 -> overlap is 0.3 -> multiplier is ~0.96 (minor noise).
    +6.0 vs -5.8 -> overlap is 5.8 -> multiplier is 0.50 (severe structural conflict).
    """
    if view_a * view_b >= 0:
        return 1.0  # Views agree or are neutral

    # The true severity of a conflict is determined by the smaller of the two opposing forces
    overlap = min(abs(view_a), abs(view_b))

    # Scale penalty up to a maximum 50% cut
    penalty = (overlap / max_overlap) * 0.5
    return max(0.5, 1.0 - penalty)


def classify_shape(pred_home_dev, pred_away_dev, edge_thresh=3.0, iso_thresh=1.5, balance_ratio=0.6):
    """Evaluates the geometric shape of the deviations to ROUTE capital."""
    ah, aa = abs(pred_home_dev), abs(pred_away_dev)

    if ah < iso_thresh and aa < iso_thresh:
        return "NEUTRAL"

    same_sign = (pred_home_dev * pred_away_dev) > 0
    opp_sign = (pred_home_dev * pred_away_dev) < 0

    if same_sign:
        ratio = min(ah, aa) / max(ah, aa) if max(ah, aa) > 0 else 0.0
        if ah >= edge_thresh and aa >= edge_thresh and ratio >= balance_ratio:
            return "BALANCED_TOTAL"
        if ah >= edge_thresh and aa <= iso_thresh:
            return "HOME_TT_ONLY"
        if aa >= edge_thresh and ah <= iso_thresh:
            return "AWAY_TT_ONLY"
        return "LOPSIDED_SAME_SIGN"

    if opp_sign:
        if ah >= edge_thresh and aa >= edge_thresh:
            return "SPREAD"
        if ah >= edge_thresh and aa <= iso_thresh:
            return "HOME_TT_ONLY"
        if aa >= edge_thresh and ah <= iso_thresh:
            return "AWAY_TT_ONLY"
        return "MIXED"

    if ah >= edge_thresh:
        return "HOME_TT_ONLY"
    if aa >= edge_thresh:
        return "AWAY_TT_ONLY"

    return "NEUTRAL"


def evaluate_kalshi_game(closing_total, home_spread, ref_h_data, ref_a_data,
                         market_home_tt=None, market_away_tt=None,
                         edge_thresh=3.0, iso_thresh=1.5, balance_ratio=0.6, k=5.0, min_weight=4.0,
                         market_edge_thresh=2.5, tt_edge_thresh=3.0):
    """
    Core pricing and routing engine with strict Market-Edge Confirmation.
    """
    # 1. Reconstruct Vegas Implied Totals
    implied_home = (closing_total - home_spread) / 2.0
    implied_away = (closing_total + home_spread) / 2.0

    # Use real TT lines if provided by your API, else default to implied math
    market_home_tt = market_home_tt if market_home_tt is not None else implied_home
    market_away_tt = market_away_tt if market_away_tt is not None else implied_away

    # 2. Continuous Shrinkage BEFORE Cross-Coupling
    h_from_h, h_w_off = apply_shrinkage(ref_h_data['team_dev'], ref_h_data['games'], k=k)
    a_from_h, h_w_def = apply_shrinkage(ref_h_data['opp_dev'], ref_h_data['games'], k=k)
    a_from_a, a_w_off = apply_shrinkage(ref_a_data['team_dev'], ref_a_data['games'], k=k)
    h_from_a, a_w_def = apply_shrinkage(ref_a_data['opp_dev'], ref_a_data['games'], k=k)

    home_total_weight = h_w_off + a_w_def
    away_total_weight = a_w_off + h_w_def

    # 3. Minimum Effective-Weight Gate
    if home_total_weight < min_weight or away_total_weight < min_weight:
        return {"action": "SKIP", "reason": f"Insufficient combined weight. (Home: {home_total_weight:.1f}, Away: {away_total_weight:.1f})"}

    # 4. Cross-Coupling
    pred_home_dev = ((h_from_h * h_w_off) + (h_from_a * a_w_def)) / home_total_weight
    pred_away_dev = ((a_from_a * a_w_off) + (a_from_h * h_w_def)) / away_total_weight

    # 5. Continuous Contradiction Penalty
    home_contradicts = (h_from_h * h_from_a) < 0
    away_contradicts = (a_from_a * a_from_h) < 0

    if home_contradicts and away_contradicts:
        return {"action": "SKIP", "reason": "Dual-sided contradiction. Views entirely conflict."}

    home_mult = calculate_conflict_multiplier(h_from_h, h_from_a)
    away_mult = calculate_conflict_multiplier(a_from_a, a_from_h)
    size_multiplier = min(home_mult, away_mult)

    # 6. Full Market Re-derivation
    predicted_home = implied_home + pred_home_dev
    predicted_away = implied_away + pred_away_dev
    predicted_total = predicted_home + predicted_away
    predicted_spread = predicted_home - predicted_away

    total_edge = predicted_total - closing_total
    spread_edge = predicted_spread - (-home_spread)
    home_tt_edge = predicted_home - market_home_tt
    away_tt_edge = predicted_away - market_away_tt

    # 7. Shape-Based Routing -> Explicit Market-Edge Gating
    shape = classify_shape(pred_home_dev, pred_away_dev, edge_thresh, iso_thresh, balance_ratio)
    action, market, play, reason = "SKIP", "NONE", "NONE", ""

    if shape == "BALANCED_TOTAL":
        if abs(total_edge) >= market_edge_thresh:
            action, market = "PLAY", "GAME TOTAL"
            play = "OVER" if total_edge > 0 else "UNDER"
        else:
            reason = f"Balanced total shape, but total edge ({abs(total_edge):.1f}) < thresh ({market_edge_thresh})."

    elif shape == "SPREAD":
        if abs(spread_edge) >= market_edge_thresh:
            action, market = "PLAY", "SPREAD"
            play = "HOME" if spread_edge > 0 else "AWAY"
        else:
            reason = f"Spread shape, but spread edge ({abs(spread_edge):.1f}) < thresh ({market_edge_thresh})."

    elif shape == "HOME_TT_ONLY":
        if abs(home_tt_edge) >= tt_edge_thresh:
            action, market = "PLAY", "HOME TEAM TOTAL"
            play = "OVER" if home_tt_edge > 0 else "UNDER"
        else:
            reason = f"Home TT shape, but market edge ({abs(home_tt_edge):.1f}) < thresh ({tt_edge_thresh})."

    elif shape == "AWAY_TT_ONLY":
        if abs(away_tt_edge) >= tt_edge_thresh:
            action, market = "PLAY", "AWAY TEAM TOTAL"
            play = "OVER" if away_tt_edge > 0 else "UNDER"
        else:
            reason = f"Away TT shape, but market edge ({abs(away_tt_edge):.1f}) < thresh ({tt_edge_thresh})."

    elif shape == "LOPSIDED_SAME_SIGN":
        if abs(pred_home_dev) > abs(pred_away_dev):
            if abs(home_tt_edge) >= tt_edge_thresh:
                action, market, play = "PLAY", "HOME TEAM TOTAL", ("OVER" if home_tt_edge > 0 else "UNDER")
            else:
                reason = "Lopsided same-sign shape, but dominant (Home) edge < thresh."
        else:
            if abs(away_tt_edge) >= tt_edge_thresh:
                action, market, play = "PLAY", "AWAY TEAM TOTAL", ("OVER" if away_tt_edge > 0 else "UNDER")
            else:
                reason = "Lopsided same-sign shape, but dominant (Away) edge < thresh."

    elif shape == "MIXED":
        reason = "Sub-optimal mixed edge shape."
    else:
        reason = "No material edge found."

    result = {
        "action": action,
        "market": market,
        "play": play,
        "size_multiplier": round(size_multiplier, 2) if action == "PLAY" else 0.0,
        "shape_profile": shape,
        "metrics": {
            "total_edge": round(total_edge, 2),
            "spread_edge": round(spread_edge, 2),
            "home_tt_edge": round(home_tt_edge, 2),
            "away_tt_edge": round(away_tt_edge, 2),
            "pred_home_dev": round(pred_home_dev, 2),
            "pred_away_dev": round(pred_away_dev, 2),
            "eff_home_weight": round(home_total_weight, 1),
            "eff_away_weight": round(away_total_weight, 1)
        }
    }

    if action == "SKIP":
        result["reason"] = reason

    return result
