import numpy as np
import pandas as pd

# ==============================================================================
# MODULE 1: THE CONFIGURATION (YOUR "BEST ENHANCE" WEIGHTS)
# ==============================================================================
class ModelConfig:
    # 1. INJURY DAMPENER ("The Next Man Up")
    # We weigh injuries at only 40% of the market. 
    # Logic: Market overreacts to stars sitting; we bet on system continuity.
    INJURY_WEIGHT = 0.40  

    # 2. FATIGUE AMPLIFIER ("The Apron Reality")
    # In 2026, thin benches crumble on B2Bs. We punish this 2.5x - 3.5x harder.
    FATIGUE_BASE_PENALTY = 2.0
    APRON_TAX_MULTIPLIER = 1.75 # Extra penalty if they are a "Second Apron" team
    
    # 3. ATS MOMENTUM ("The Market Lag")
    # If a team covers >60% of spreads, the market hasn't caught up.
    ATS_THRESHOLD = 0.60
    ATS_BONUS_POINTS = 3.0
    
    # 4. GAME PHYSICS (2026 Rules)
    AVG_PACE = 100.8
    HEAVE_PROB = 0.045  # 4.5% make rate on "Free Heaves" (High Variance)
    HOME_COURT = 2.6

# ==============================================================================
# MODULE 2: THE CALCULATOR (PHYSICS + SITUATION)
# ==============================================================================
class GameEngine:
    def __init__(self, config):
        self.cfg = config

    def get_effective_rating(self, team):
        """
        Adjusts a team's Net Rating based on User Constraints.
        Returns: Adjusted Rating, List of applied flags (Notes)
        """
        rating = team['net_rating']
        notes = []
        
        # A. INJURY ADJUSTMENT (Dampened)
        # If market drops them 5 pts, we only drop them 2 pts.
        injury_hit = team['market_injury_val'] * self.cfg.INJURY_WEIGHT
        rating -= injury_hit
        if injury_hit > 0:
            notes.append(f"Injury Dampened (Market:-{team['market_injury_val']} -> Model:-{round(injury_hit,1)})")
        
        # B. FATIGUE / SITUATIONAL ADJUSTMENT (Enhanced)
        if team['situation'] in ['B2B', '3in4', 'EndRoadTrip']:
            penalty = self.cfg.FATIGUE_BASE_PENALTY
            
            # The "Second Apron" Kicker
            if team['is_apron_team']: 
                penalty *= self.cfg.APRON_TAX_MULTIPLIER
                notes.append("APRON FATIGUE CRUSH")
            else:
                notes.append("Standard Fatigue")
                
            rating -= penalty

        # C. ATS MOMENTUM (Market Lag)
        if team['ats_pct'] >= self.cfg.ATS_THRESHOLD:
            rating += self.cfg.ATS_BONUS_POINTS
            notes.append(f"ATS WAGON (+{self.cfg.ATS_BONUS_POINTS})")
            
        return rating, notes

    def simulate(self, home, away, iterations=10000):
        """
        Runs Monte Carlo sim including 2026 'Heave' Variance.
        """
        h_rtg, h_notes = self.get_effective_rating(home)
        a_rtg, a_notes = self.get_effective_rating(away)
        
        results = []
        
        for _ in range(iterations):
            # Base Score (Pace * Rating) + Noise (Shooting Variance)
            h_score = (self.cfg.AVG_PACE/2) * (1 + h_rtg/100) + np.random.normal(0, 11)
            a_score = (self.cfg.AVG_PACE/2) * (1 + a_rtg/100) + np.random.normal(0, 11)
            
            # THE HEAVE RULE (Variance Injection)
            # 3 random end-of-quarter heaves per game (New 2026 Rule)
            h_score += np.random.binomial(3, self.cfg.HEAVE_PROB) * 3
            a_score += np.random.binomial(3, self.cfg.HEAVE_PROB) * 3
            
            h_score += self.cfg.HOME_COURT
            
            results.append(a_score - h_score) # Spread (Negative = Home Win)

        fair_line = np.percentile(results, 50) # Median
        return round(fair_line, 1), h_notes, a_notes

# ==============================================================================
# MODULE 3: THE READER (MARKET NARRATIVE)
# ==============================================================================
class MarketReader:
    def analyze(self, game_data, fair_line, h_notes, a_notes):
        vegas = game_data['vegas_line']
        ticket_pct = game_data['ticket_pct']
        
        # 1. PUBLIC PERCEPTION (Recency Bias)
        # Public expects the last 5 games to repeat forever.
        recency_bias = (game_data['last_5_diff'] * 0.35)
        public_price = fair_line + recency_bias
        
        delta_math = vegas - fair_line
        
        story = "Standard Market"
        action = "PASS"
        size = "1 Unit"

        # --- NARRATIVE DETECTION LOGIC ---

        # SCENARIO 1: "THE STRUCTURAL EDGE" (Fatigue Mismatch)
        # Our model heavily penalized the tired team ("APRON CRUSH"), creating a huge edge.
        if abs(delta_math) > 4.0 and ("APRON FATIGUE CRUSH" in str(h_notes) or "APRON FATIGUE CRUSH" in str(a_notes)):
            story = "STRUCTURAL MISMATCH (Apron/Fatigue)"
            action = "BET MODEL (Fade the Tired Team)"
            size = "2 UNITS (Hammer)"

        # SCENARIO 2: "THE STINK" (Trap Line)
        # Public > 75% on Fav, but Vegas line is 'too good to be true'.
        elif ticket_pct > 75 and abs(vegas - public_price) > 3.0 and abs(delta_math) < 1.0:
            story = "THE STINK (Vegas Trap)"
            action = f"FADE PUBLIC (Bet {game_data['underdog']})"
            size = "1.5 Units"

        # SCENARIO 3: "NEXT MAN UP" (Injury Value)
        # Market dropped line 5 pts for injury. We dropped it 2. We are buying.
        elif abs(delta_math) > 2.5 and (game_data['home_inj_val'] > 4 or game_data['away_inj_val'] > 4):
            story = "INJURY OVERREACTION (Ewing Theory)"
            action = "BET MODEL (Take the Points)"
            size = "1 Unit"
            
        # SCENARIO 4: "ATS WAGON"
        # Pure trend following backed by math.
        elif ("ATS WAGON" in str(h_notes) or "ATS WAGON" in str(a_notes)) and (vegas - fair_line) * (1 if fair_line < 0 else -1) > 0:
            story = "MARKET LAG (Ride the Trend)"
            action = "BET MODEL (Don't step in front of train)"
            size = "1 Unit"

        return story, action, size

# ==============================================================================
# EXECUTION: THE 2026 WAR ROOM
# ==============================================================================

# EXAMPLE SCENARIO: 
# Golden State (Home) vs. Miami Heat (Away)
# Miami is on a B2B (Tired). Miami is an "Apron Team" (Old).
# Butler is "Questionable" (Market assumes Out = -4.5 pts).
# GSW is covering 62% ATS (Wagon).

gsw = {
    'name': 'Warriors',
    'net_rating': +5.2,
    'market_injury_val': 0.0,
    'situation': 'Home_Rest',
    'is_apron_team': False,
    'ats_pct': 0.62, # >60% Threshold
}

mia = {
    'name': 'Heat',
    'net_rating': +1.5,
    'market_injury_val': 4.5, # Market penalizing heavily
    'situation': 'B2B',       # BAD SPOT
    'is_apron_team': True,    # THIN BENCH
    'ats_pct': 0.48,
}

# MARKET CONTEXT
game_market = {
    'matchup': 'Heat @ Warriors',
    'vegas_line': -6.5,       # Warriors -6.5
    'ticket_pct': 82,         # Public hammering Warriors
    'last_5_diff': +12.0,     # Warriors blowing people out
    'underdog': 'Heat',
    'home_inj_val': gsw['market_injury_val'],
    'away_inj_val': mia['market_injury_val']
}

# 1. INITIALIZE SYSTEMS
config = ModelConfig()
engine = GameEngine(config)
reader = MarketReader()

# 2. RUN MATH (The "Deep Dive")
fair_line, h_notes, a_notes = engine.simulate(gsw, mia)

# 3. READ NARRATIVE
story, action, size = reader.analyze(game_market, fair_line, h_notes, a_notes)

# 4. PRINT REPORT
print(f"--- 2026 APEX REPORT: {game_market['matchup']} ---")
print(f"DATE: Jan 13, 2026\n")

print(f"[THE INPUTS]")
print(f"GSW Flags: {h_notes}")
print(f"MIA Flags: {a_notes}")
print(f"Injuries:  Market Impact -4.5 | Your Impact -{round(4.5 * config.INJURY_WEIGHT, 1)}")

print(f"\n[THE TRIANGULATION]")
print(f"Your Math (Fair Price): Warriors {fair_line}")
print(f"Vegas Line:             Warriors {game_market['vegas_line']}")
print(f"Edge:                   {round(game_market['vegas_line'] - fair_line, 1)} points")

print(f"\n[THE VERDICT]")
print(f"STORY:  {story}")
print(f"ACTION: {action}")
print(f"SIZE:   {size}")
