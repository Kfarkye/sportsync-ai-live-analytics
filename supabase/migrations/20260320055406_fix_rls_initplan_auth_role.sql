
-- Migration: Fix auth RLS initplan issue
-- Replace auth.role() with (select auth.role()) to prevent per-row re-evaluation.
-- This converts the subexpression to an InitPlan that evaluates once per query.

-- 1. espn_historical_odds
DROP POLICY IF EXISTS "Service role full access on espn_historical_odds" ON public.espn_historical_odds;
CREATE POLICY "Service role full access on espn_historical_odds" ON public.espn_historical_odds
  FOR ALL USING ((select auth.role()) = 'service_role');

-- 2. espn_odds_backfill_log
DROP POLICY IF EXISTS "Service role full access on espn_odds_backfill_log" ON public.espn_odds_backfill_log;
CREATE POLICY "Service role full access on espn_odds_backfill_log" ON public.espn_odds_backfill_log
  FOR ALL USING ((select auth.role()) = 'service_role');

-- 3. match_book_odds
DROP POLICY IF EXISTS "Service role full access" ON public.match_book_odds;
CREATE POLICY "Service role full access" ON public.match_book_odds
  FOR ALL USING ((select auth.role()) = 'service_role');

-- 4. poly_ingest_log
DROP POLICY IF EXISTS "poly_ingest_log_service_only" ON public.poly_ingest_log;
CREATE POLICY "poly_ingest_log_service_only" ON public.poly_ingest_log
  FOR ALL USING ((select auth.role()) = 'service_role');

-- 5. poly_league_map
DROP POLICY IF EXISTS "poly_league_map_service_write" ON public.poly_league_map;
CREATE POLICY "poly_league_map_service_write" ON public.poly_league_map
  FOR ALL USING ((select auth.role()) = 'service_role');

-- 6. poly_odds
DROP POLICY IF EXISTS "poly_odds_service_write" ON public.poly_odds;
CREATE POLICY "poly_odds_service_write" ON public.poly_odds
  FOR ALL USING ((select auth.role()) = 'service_role');

-- 7. reddit_comments
DROP POLICY IF EXISTS "reddit_comments_write" ON public.reddit_comments;
CREATE POLICY "reddit_comments_write" ON public.reddit_comments
  FOR ALL
  USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');

-- 8. reddit_ingest_log
DROP POLICY IF EXISTS "reddit_ingest_log_write" ON public.reddit_ingest_log;
CREATE POLICY "reddit_ingest_log_write" ON public.reddit_ingest_log
  FOR ALL
  USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');

-- 9. reddit_posts
DROP POLICY IF EXISTS "reddit_posts_write" ON public.reddit_posts;
CREATE POLICY "reddit_posts_write" ON public.reddit_posts
  FOR ALL
  USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');

-- 10. reddit_subreddits
DROP POLICY IF EXISTS "reddit_subreddits_write" ON public.reddit_subreddits;
CREATE POLICY "reddit_subreddits_write" ON public.reddit_subreddits
  FOR ALL
  USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');

-- 11. research_candidates
DROP POLICY IF EXISTS "research_candidates_write" ON public.research_candidates;
CREATE POLICY "research_candidates_write" ON public.research_candidates
  FOR ALL
  USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');

-- 12. signal_validations
DROP POLICY IF EXISTS "signal_validations_write" ON public.signal_validations;
CREATE POLICY "signal_validations_write" ON public.signal_validations
  FOR ALL
  USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');

-- 13. wc26_venues
DROP POLICY IF EXISTS "Service write wc26_venues" ON public.wc26_venues;
CREATE POLICY "Service write wc26_venues" ON public.wc26_venues
  FOR ALL USING ((select auth.role()) = 'service_role');
;
