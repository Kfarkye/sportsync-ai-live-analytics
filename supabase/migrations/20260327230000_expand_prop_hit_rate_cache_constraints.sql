-- Expand cache constraints for MLB markets and context dimensions used by league-aware cache refresh.

ALTER TABLE public.prop_hit_rate_cache
  DROP CONSTRAINT IF EXISTS prop_hit_rate_cache_bet_type_check;

ALTER TABLE public.prop_hit_rate_cache
  ADD CONSTRAINT prop_hit_rate_cache_bet_type_check
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

ALTER TABLE public.prop_hit_rate_cache
  DROP CONSTRAINT IF EXISTS prop_hit_rate_cache_context_key_check;

ALTER TABLE public.prop_hit_rate_cache
  ADD CONSTRAINT prop_hit_rate_cache_context_key_check
  CHECK (
    context_key = ANY (
      ARRAY[
        'all', 'venue', 'rest_days', 'opp_pace_tier', 'teammate_out',
        'crew_chief', 'season_phase', 'travel_pattern', 'opponent'
      ]
    )
  );
