-- Expand outcomes bet_type constraint to support MLB v1 markets and legacy MLB aliases.

ALTER TABLE public.player_prop_outcomes
  DROP CONSTRAINT IF EXISTS player_prop_outcomes_bet_type_check;

ALTER TABLE public.player_prop_outcomes
  ADD CONSTRAINT player_prop_outcomes_bet_type_check
  CHECK (
    bet_type = ANY (
      ARRAY[
        'points', 'threes_made', 'rebounds', 'assists', 'pra',
        'pts_rebs', 'pts_asts', 'steals', 'blocks', 'turnovers', 'fantasy_score',
        'pitcher_strikeouts', 'batter_hits', 'batter_total_bases',
        'strikeouts', 'hits', 'total_bases'
      ]
    )
  );
