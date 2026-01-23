-- ═══════════════════════════════════════════════════════════════════════════
-- SRE-GRADE MONITORING: ODDS HEALTH
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.odds_health_audit AS
SELECT 
    m.id AS match_id,
    m.home_team,
    m.away_team,
    m.status,
    m.last_odds_update,
    (m.current_odds->>'isInstitutional')::boolean AS is_institutional,
    (m.current_odds->>'provider') AS provider,
    EXTRACT(EPOCH FROM (NOW() - m.last_odds_update)) / 60 AS minutes_since_update,
    CASE 
        WHEN m.status = 'IN_PROGRESS' AND EXTRACT(EPOCH FROM (NOW() - m.last_odds_update)) > 300 THEN '🔴 STALE_LIVE'
        WHEN m.status = 'SCHEDULED' AND EXTRACT(EPOCH FROM (NOW() - m.last_odds_update)) > 3600 THEN '🟡 STALE_PREGAME'
        ELSE '🟢 HEALTHY'
    END AS health_status
FROM public.matches m
WHERE m.status IN ('IN_PROGRESS', 'SCHEDULED')
  AND m.start_time > NOW() - INTERVAL '12 hours';

-- ═══════════════════════════════════════════════════════════════════════════
-- SELF-HEALING BRIDGE: MARKET RESOLVER
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.resolve_market_feed(p_match_id TEXT, p_canonical_id TEXT DEFAULT NULL)
RETURNS JSONB AS $$
DECLARE
    v_odds_api_id TEXT;
    v_feed JSONB;
BEGIN
    -- 1. Try to find the Odds API ID via mappings
    SELECT external_id INTO v_odds_api_id
    FROM public.entity_mappings
    WHERE (canonical_id = p_canonical_id OR canonical_id = p_match_id)
      AND provider = 'THE_ODDS_API'
    LIMIT 1;

    -- 2. Fetch the feed
    IF v_odds_api_id IS NOT NULL THEN
        SELECT jsonb_build_object(
            'spread', best_spread,
            'total', best_total,
            'h2h', best_h2h,
            'is_live', is_live,
            'last_updated', last_updated,
            'external_id', external_id
        ) INTO v_feed
        FROM public.market_feeds
        WHERE external_id = v_odds_api_id
        ORDER BY last_updated DESC
        LIMIT 1;
    END IF;

    -- 3. Fallback: Fuzzy match by canonical_id directly in market_feeds
    -- (Some feeds use canonical_id as external_id)
    IF v_feed IS NULL AND p_canonical_id IS NOT NULL THEN
        SELECT jsonb_build_object(
            'spread', best_spread,
            'total', best_total,
            'h2h', best_h2h,
            'is_live', is_live,
            'last_updated', last_updated,
            'external_id', external_id
        ) INTO v_feed
        FROM public.market_feeds
        WHERE external_id = p_canonical_id
        ORDER BY last_updated DESC
        LIMIT 1;
    END IF;

    RETURN v_feed;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
