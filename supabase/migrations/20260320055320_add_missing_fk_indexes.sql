
-- Migration: Add indexes for unindexed foreign keys
-- FK constraints without covering indexes cause full table scans on DELETE cascades and JOINs.

CREATE INDEX IF NOT EXISTS idx_ai_chat_picks_conversation_id
  ON public.ai_chat_picks (conversation_id);

CREATE INDEX IF NOT EXISTS idx_game_alerts_trigger_event_id
  ON public.game_alerts (trigger_event_id);

CREATE INDEX IF NOT EXISTS idx_llm_model_picks_conversation_id
  ON public.llm_model_picks (conversation_id);

CREATE INDEX IF NOT EXISTS idx_match_edge_tags_trend_key
  ON public.match_edge_tags (trend_key);

CREATE INDEX IF NOT EXISTS idx_platform_odds_internal_id
  ON public.platform_odds (internal_id);

CREATE INDEX IF NOT EXISTS idx_reddit_ingest_log_subreddit_slug
  ON public.reddit_ingest_log (subreddit_slug);

CREATE INDEX IF NOT EXISTS idx_signal_validations_candidate_id
  ON public.signal_validations (candidate_id);

CREATE INDEX IF NOT EXISTS idx_team_mappings_league_id
  ON public.team_mappings (league_id);

CREATE INDEX IF NOT EXISTS idx_trend_ledger_trend_key
  ON public.trend_ledger (trend_key);

CREATE INDEX IF NOT EXISTS idx_venue_aliases_canonical_id
  ON public.venue_aliases (canonical_id);

CREATE INDEX IF NOT EXISTS idx_wc_group_standings_team_id
  ON public.wc_group_standings (team_id);

CREATE INDEX IF NOT EXISTS idx_wc_groups_host_team_id
  ON public.wc_groups (host_team_id);

CREATE INDEX IF NOT EXISTS idx_wc_knockout_bracket_match_id
  ON public.wc_knockout_bracket (match_id);

CREATE INDEX IF NOT EXISTS idx_wc_matches_away_team_id
  ON public.wc_matches (away_team_id);

CREATE INDEX IF NOT EXISTS idx_wc_matches_home_team_id
  ON public.wc_matches (home_team_id);
;
