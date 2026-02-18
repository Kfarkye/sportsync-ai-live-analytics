-- ═══════════════════════════════════════════════════════════════════════════
-- ADD GIN INDEXES TO JSONB COLUMNS
-- Audit finding: 12+ JSONB columns lack GIN indexes, causing full table
-- scans when querying JSON content or using containment operators
-- ═══════════════════════════════════════════════════════════════════════════

-- venue_intel
CREATE INDEX IF NOT EXISTS idx_venue_intel_content_gin
  ON public.venue_intel USING GIN (content);

-- match_news (multiple JSONB columns)
CREATE INDEX IF NOT EXISTS idx_match_news_key_injuries_gin
  ON public.match_news USING GIN (key_injuries);
CREATE INDEX IF NOT EXISTS idx_match_news_betting_factors_gin
  ON public.match_news USING GIN (betting_factors);
CREATE INDEX IF NOT EXISTS idx_match_news_line_movement_gin
  ON public.match_news USING GIN (line_movement);
CREATE INDEX IF NOT EXISTS idx_match_news_weather_gin
  ON public.match_news USING GIN (weather_forecast);
CREATE INDEX IF NOT EXISTS idx_match_news_fatigue_gin
  ON public.match_news USING GIN (fatigue);
CREATE INDEX IF NOT EXISTS idx_match_news_officials_gin
  ON public.match_news USING GIN (officials);
CREATE INDEX IF NOT EXISTS idx_match_news_sources_gin
  ON public.match_news USING GIN (sources);

-- match_thesis
CREATE INDEX IF NOT EXISTS idx_match_thesis_content_gin
  ON public.match_thesis USING GIN (content);

-- narrative_intel
CREATE INDEX IF NOT EXISTS idx_narrative_intel_content_gin
  ON public.narrative_intel USING GIN (content);

-- edge_analysis
CREATE INDEX IF NOT EXISTS idx_edge_analysis_content_gin
  ON public.edge_analysis USING GIN (content);

-- box_scores
CREATE INDEX IF NOT EXISTS idx_box_scores_content_gin
  ON public.box_scores USING GIN (content);

-- conversations (previously commented out)
CREATE INDEX IF NOT EXISTS idx_conversations_messages_gin
  ON public.conversations USING GIN (messages);
CREATE INDEX IF NOT EXISTS idx_conversations_active_context_gin
  ON public.conversations USING GIN (active_context);

-- ai_signal_snapshots (created in 20260218000002 without GIN)
CREATE INDEX IF NOT EXISTS idx_ai_signal_snapshots_signals_gin
  ON public.ai_signal_snapshots USING GIN (signals);

-- deep_intel (created in 20260218000002 without GIN)
CREATE INDEX IF NOT EXISTS idx_deep_intel_content_gin
  ON public.deep_intel USING GIN (content);

-- news_intel (created in 20260218000002 without GIN)
CREATE INDEX IF NOT EXISTS idx_news_intel_content_gin
  ON public.news_intel USING GIN (content);
