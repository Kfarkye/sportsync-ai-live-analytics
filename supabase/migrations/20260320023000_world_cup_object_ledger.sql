-- World Cup object-ledger foundation.
-- Canonical objects: tournament, group, match, team, team_market.
-- Guarantees:
-- 1) Durable identities via object_id/public_path.
-- 2) Current-state reads via object_ledger_current_state.
-- 3) Append-only event history via object_ledger_events.

CREATE TABLE IF NOT EXISTS public.object_ledger_objects (
  object_id text PRIMARY KEY,
  domain text NOT NULL DEFAULT 'world-cup',
  tournament_slug text NOT NULL,
  object_type text NOT NULL CHECK (object_type IN ('tournament', 'group', 'match', 'team', 'team_market')),
  slug text NOT NULL,
  public_path text NOT NULL UNIQUE,
  title text NOT NULL,
  parent_object_id text NULL REFERENCES public.object_ledger_objects(object_id) ON DELETE SET NULL,
  identity jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tournament_slug, object_type, slug)
);

CREATE TABLE IF NOT EXISTS public.object_ledger_current_state (
  object_id text PRIMARY KEY REFERENCES public.object_ledger_objects(object_id) ON DELETE CASCADE,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  last_event_id bigint NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.object_ledger_events (
  event_id bigserial PRIMARY KEY,
  object_id text NOT NULL REFERENCES public.object_ledger_objects(object_id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (
    event_type IN (
      'match_completed',
      'odds_updated',
      'qualification_state_changed',
      'team_eliminated',
      'team_qualified',
      'host_city_updated',
      'lineup_news_added',
      'group_table_updated'
    )
  ),
  event_ts timestamptz NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'object_ledger_current_state'
      AND column_name = 'last_event_id'
  ) THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'object_ledger_current_state'
      AND constraint_name = 'object_ledger_current_state_last_event_fkey'
  ) THEN
    ALTER TABLE public.object_ledger_current_state
      ADD CONSTRAINT object_ledger_current_state_last_event_fkey
      FOREIGN KEY (last_event_id)
      REFERENCES public.object_ledger_events(event_id)
      ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_object_ledger_objects_tournament_type
  ON public.object_ledger_objects (tournament_slug, object_type);

CREATE INDEX IF NOT EXISTS idx_object_ledger_objects_parent
  ON public.object_ledger_objects (parent_object_id);

CREATE INDEX IF NOT EXISTS idx_object_ledger_events_object_ts
  ON public.object_ledger_events (object_id, event_ts DESC);

CREATE OR REPLACE FUNCTION public.set_object_ledger_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_object_ledger_objects_updated_at ON public.object_ledger_objects;
CREATE TRIGGER trg_object_ledger_objects_updated_at
BEFORE UPDATE ON public.object_ledger_objects
FOR EACH ROW
EXECUTE FUNCTION public.set_object_ledger_updated_at();

DROP TRIGGER IF EXISTS trg_object_ledger_current_state_updated_at ON public.object_ledger_current_state;
CREATE TRIGGER trg_object_ledger_current_state_updated_at
BEFORE UPDATE ON public.object_ledger_current_state
FOR EACH ROW
EXECUTE FUNCTION public.set_object_ledger_updated_at();

CREATE OR REPLACE FUNCTION public.prevent_object_ledger_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'object_ledger_events is append-only; % is not allowed', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS trg_object_ledger_events_append_only ON public.object_ledger_events;
CREATE TRIGGER trg_object_ledger_events_append_only
BEFORE UPDATE OR DELETE ON public.object_ledger_events
FOR EACH ROW
EXECUTE FUNCTION public.prevent_object_ledger_event_mutation();

CREATE OR REPLACE FUNCTION public.upsert_object_current_state(
  p_object_id text,
  p_state jsonb,
  p_event_type text,
  p_event_payload jsonb DEFAULT '{}'::jsonb,
  p_event_ts timestamptz DEFAULT now(),
  p_source text DEFAULT 'system'
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.object_ledger_objects o
    WHERE o.object_id = p_object_id
  ) THEN
    RAISE EXCEPTION 'Unknown object id: %', p_object_id;
  END IF;

  INSERT INTO public.object_ledger_current_state (
    object_id,
    state,
    state_version,
    updated_at
  )
  VALUES (
    p_object_id,
    COALESCE(p_state, '{}'::jsonb),
    1,
    now()
  )
  ON CONFLICT (object_id) DO UPDATE
  SET
    state = EXCLUDED.state,
    state_version = public.object_ledger_current_state.state_version + 1,
    updated_at = now();

  INSERT INTO public.object_ledger_events (
    object_id,
    event_type,
    event_ts,
    payload,
    source
  )
  VALUES (
    p_object_id,
    p_event_type,
    COALESCE(p_event_ts, now()),
    COALESCE(p_event_payload, '{}'::jsonb),
    COALESCE(NULLIF(p_source, ''), 'system')
  )
  RETURNING event_id INTO v_event_id;

  UPDATE public.object_ledger_current_state
  SET last_event_id = v_event_id,
      updated_at = now()
  WHERE object_id = p_object_id;

  RETURN v_event_id;
END;
$$;

ALTER TABLE public.object_ledger_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.object_ledger_current_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.object_ledger_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS object_ledger_objects_public_read ON public.object_ledger_objects;
CREATE POLICY object_ledger_objects_public_read
ON public.object_ledger_objects
FOR SELECT
USING (true);

DROP POLICY IF EXISTS object_ledger_state_public_read ON public.object_ledger_current_state;
CREATE POLICY object_ledger_state_public_read
ON public.object_ledger_current_state
FOR SELECT
USING (true);

DROP POLICY IF EXISTS object_ledger_events_public_read ON public.object_ledger_events;
CREATE POLICY object_ledger_events_public_read
ON public.object_ledger_events
FOR SELECT
USING (true);

DROP POLICY IF EXISTS object_ledger_objects_service_all ON public.object_ledger_objects;
CREATE POLICY object_ledger_objects_service_all
ON public.object_ledger_objects
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS object_ledger_state_service_all ON public.object_ledger_current_state;
CREATE POLICY object_ledger_state_service_all
ON public.object_ledger_current_state
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS object_ledger_events_service_all ON public.object_ledger_events;
CREATE POLICY object_ledger_events_service_all
ON public.object_ledger_events
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Required derived group summaries:
-- at_a_glance, match_anchor, history, share_snapshot, seo_summary
CREATE OR REPLACE VIEW public.v_wc_group_summaries AS
WITH group_objects AS (
  SELECT
    o.object_id,
    o.slug,
    o.title,
    o.public_path,
    o.parent_object_id,
    cs.state AS payload,
    cs.updated_at AS state_updated_at
  FROM public.object_ledger_objects o
  LEFT JOIN public.object_ledger_current_state cs
    ON cs.object_id = o.object_id
  WHERE o.object_type = 'group'
    AND o.tournament_slug = 'world-cup-2026'
),
anchor_match AS (
  SELECT
    g.object_id AS group_object_id,
    mo.object_id AS match_object_id,
    mo.title AS match_title,
    mo.public_path AS match_public_path,
    ms.state AS match_payload,
    ms.updated_at AS match_state_updated_at
  FROM group_objects g
  LEFT JOIN public.object_ledger_objects mo
    ON mo.object_id = COALESCE(g.payload->>'next_match_id', '')
   AND mo.object_type = 'match'
  LEFT JOIN public.object_ledger_current_state ms
    ON ms.object_id = mo.object_id
),
group_events AS (
  SELECT
    g.object_id AS group_object_id,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'event_type', e.event_type,
          'event_ts', e.event_ts,
          'payload', e.payload
        )
        ORDER BY e.event_ts DESC
      ) FILTER (WHERE e.event_id IS NOT NULL),
      '[]'::jsonb
    ) AS recent_events,
    count(*) FILTER (WHERE e.event_type = 'odds_updated') AS odds_updates,
    count(*) FILTER (WHERE e.event_type = 'qualification_state_changed') AS qualification_changes,
    count(*) FILTER (WHERE e.event_type = 'match_completed') AS matches_completed
  FROM group_objects g
  LEFT JOIN public.object_ledger_events e
    ON e.object_id = g.object_id
    OR e.object_id IN (
      SELECT child.object_id
      FROM public.object_ledger_objects child
      WHERE child.parent_object_id = g.object_id
    )
  GROUP BY g.object_id
)
SELECT
  g.object_id,
  g.slug,
  g.title AS group_title,
  g.public_path,
  COALESCE(g.payload->>'host_city', '') AS host_city,
  COALESCE(g.payload->>'host_city_image_url', '') AS host_city_image_url,
  COALESCE(g.payload->'standings', '[]'::jsonb) AS standings,
  COALESCE(g.payload->'fixtures', '[]'::jsonb) AS fixtures,
  COALESCE(g.payload->'related_links', '[]'::jsonb) AS related_links,
  jsonb_build_object(
    'group_name', COALESCE(NULLIF(g.payload->>'group_name', ''), g.title),
    'current_leader', COALESCE(g.payload#>>'{standings,0,team}', 'No leader yet'),
    'qualification_odds', COALESCE(g.payload->'qualification_odds', '[]'::jsonb),
    'group_state', COALESCE(NULLIF(g.payload->>'group_state', ''), 'open'),
    'next_decisive_match_id', COALESCE(g.payload->>'next_match_id', ''),
    'next_decisive_match', COALESCE(am.match_title, g.payload->>'next_match_id')
  ) AS at_a_glance,
  jsonb_build_object(
    'match_id', COALESCE(am.match_object_id, g.payload->>'next_match_id'),
    'match_path', COALESCE(am.match_public_path, ''),
    'round', COALESCE(am.match_payload->>'round', ''),
    'home_team', COALESCE(am.match_payload->>'home_team', ''),
    'away_team', COALESCE(am.match_payload->>'away_team', ''),
    'status', COALESCE(am.match_payload->>'status', ''),
    'scheduled_at', COALESCE(am.match_payload->>'scheduled_at', ''),
    'moneyline', COALESCE(am.match_payload->'moneyline', '{}'::jsonb),
    'total', COALESCE(am.match_payload->'total', '{}'::jsonb),
    'team_needs', COALESCE(am.match_payload->'team_needs', '{}'::jsonb)
  ) AS match_anchor,
  jsonb_build_object(
    'summary', COALESCE(g.payload->>'history_summary', 'Group state and market movement ledger.'),
    'event_counts', jsonb_build_object(
      'odds_updated', ge.odds_updates,
      'qualification_state_changed', ge.qualification_changes,
      'match_completed', ge.matches_completed
    ),
    'recent_events', ge.recent_events
  ) AS history,
  jsonb_build_object(
    'title', COALESCE(NULLIF(g.payload->>'group_name', ''), g.title),
    'state', COALESCE(NULLIF(g.payload->>'group_state', ''), 'open'),
    'leader', COALESCE(g.payload#>>'{standings,0,team}', 'TBD'),
    'next_match_id', COALESCE(g.payload->>'next_match_id', ''),
    'host_city', COALESCE(g.payload->>'host_city', '')
  ) AS share_snapshot,
  jsonb_build_object(
    'title', format(
      '%s odds, fixtures, and qualification state | The Drip',
      COALESCE(NULLIF(g.payload->>'group_name', ''), g.title)
    ),
    'description', format(
      '%s in %s: qualification odds, match anchor, and round context from an object-ledger source of truth.',
      COALESCE(NULLIF(g.payload->>'group_name', ''), g.title),
      COALESCE(NULLIF(g.payload->>'host_city', ''), 'the host city')
    )
  ) AS seo_summary,
  GREATEST(
    COALESCE(g.state_updated_at, '-infinity'::timestamptz),
    COALESCE(am.match_state_updated_at, '-infinity'::timestamptz)
  ) AS last_updated_at
FROM group_objects g
LEFT JOIN anchor_match am
  ON am.group_object_id = g.object_id
LEFT JOIN group_events ge
  ON ge.group_object_id = g.object_id;

-- Compatibility bridge for legacy readers that still look for canonical_registry fields.
-- This is read-only and derived from ledger objects (no duplicate source of truth).
CREATE OR REPLACE VIEW public.v_canonical_registry_compat AS
SELECT
  o.object_id AS internal_id,
  NULLIF(cs.state->>'home_team', '') AS home_team,
  NULLIF(cs.state->>'away_team', '') AS away_team,
  'soccer'::text AS sport,
  'WORLD CUP 2026'::text AS league,
  COALESCE(
    NULLIF(cs.state->>'scheduled_at', ''),
    NULLIF(cs.state->>'last_updated_at', '')
  ) AS event_date
FROM public.object_ledger_objects o
LEFT JOIN public.object_ledger_current_state cs
  ON cs.object_id = o.object_id
WHERE o.tournament_slug = 'world-cup-2026';

-- Seed baseline object map for first build slice: wc-2026-group-b.
INSERT INTO public.object_ledger_objects (
  object_id,
  tournament_slug,
  object_type,
  slug,
  public_path,
  title,
  parent_object_id,
  identity
)
VALUES
  (
    'wc-2026',
    'world-cup-2026',
    'tournament',
    'world-cup-2026',
    '/world-cup-2026',
    'FIFA World Cup 2026',
    NULL,
    '{"canonical": true}'::jsonb
  ),
  (
    'wc-2026-group-b',
    'world-cup-2026',
    'group',
    'group-b',
    '/world-cup-2026/groups/group-b',
    'Group B',
    'wc-2026',
    '{"canonical": true}'::jsonb
  ),
  (
    'wc-2026-group-b-argentina-vs-mexico-2026-06-18',
    'world-cup-2026',
    'match',
    'argentina-vs-mexico',
    '/world-cup-2026/groups/group-b/argentina-vs-mexico',
    'Argentina vs Mexico',
    'wc-2026-group-b',
    '{"round": "matchday_2"}'::jsonb
  ),
  (
    'wc-2026-group-b-poland-vs-saudi-arabia-2026-06-19',
    'world-cup-2026',
    'match',
    'poland-vs-saudi-arabia',
    '/world-cup-2026/groups/group-b/poland-vs-saudi-arabia',
    'Poland vs Saudi Arabia',
    'wc-2026-group-b',
    '{"round": "matchday_2"}'::jsonb
  ),
  (
    'wc-2026-argentina',
    'world-cup-2026',
    'team',
    'argentina',
    '/world-cup-2026/teams/argentina',
    'Argentina',
    'wc-2026-group-b',
    '{"fifa_code": "ARG"}'::jsonb
  ),
  (
    'wc-2026-mexico',
    'world-cup-2026',
    'team',
    'mexico',
    '/world-cup-2026/teams/mexico',
    'Mexico',
    'wc-2026-group-b',
    '{"fifa_code": "MEX"}'::jsonb
  ),
  (
    'wc-2026-poland',
    'world-cup-2026',
    'team',
    'poland',
    '/world-cup-2026/teams/poland',
    'Poland',
    'wc-2026-group-b',
    '{"fifa_code": "POL"}'::jsonb
  ),
  (
    'wc-2026-saudi-arabia',
    'world-cup-2026',
    'team',
    'saudi-arabia',
    '/world-cup-2026/teams/saudi-arabia',
    'Saudi Arabia',
    'wc-2026-group-b',
    '{"fifa_code": "KSA"}'::jsonb
  ),
  (
    'wc-2026-argentina-to-qualify-group-b',
    'world-cup-2026',
    'team_market',
    'argentina-to-qualify',
    '/world-cup-2026/teams/argentina/to-qualify',
    'Argentina to Qualify (Group B)',
    'wc-2026-argentina',
    '{"market_type": "to_qualify"}'::jsonb
  ),
  (
    'wc-2026-argentina-to-win-group-b',
    'world-cup-2026',
    'team_market',
    'argentina-to-win-group-b',
    '/world-cup-2026/teams/argentina/to-win-group-b',
    'Argentina to Win Group B',
    'wc-2026-argentina',
    '{"market_type": "to_win_group"}'::jsonb
  )
ON CONFLICT (object_id) DO UPDATE
SET
  title = EXCLUDED.title,
  public_path = EXCLUDED.public_path,
  parent_object_id = EXCLUDED.parent_object_id,
  identity = EXCLUDED.identity,
  updated_at = now();

INSERT INTO public.object_ledger_current_state (
  object_id,
  state,
  state_version
)
VALUES
  (
    'wc-2026',
    jsonb_build_object(
      'name', 'FIFA World Cup 2026',
      'host_countries', jsonb_build_array('United States', 'Mexico', 'Canada'),
      'group_ids', jsonb_build_array('wc-2026-group-b'),
      'last_updated_at', '2026-03-20T15:00:00Z'
    ),
    1
  ),
  (
    'wc-2026-group-b',
    jsonb_build_object(
      'group_name', 'Group B',
      'host_city', 'Los Angeles',
      'host_city_image_url', '/world-cup/host-cities/los-angeles.svg',
      'standings', jsonb_build_array(
        jsonb_build_object('team', 'Argentina', 'played', 1, 'points', 3, 'goal_diff', 2),
        jsonb_build_object('team', 'Mexico', 'played', 1, 'points', 1, 'goal_diff', 0),
        jsonb_build_object('team', 'Poland', 'played', 1, 'points', 1, 'goal_diff', 0),
        jsonb_build_object('team', 'Saudi Arabia', 'played', 1, 'points', 0, 'goal_diff', -2)
      ),
      'qualification_odds', jsonb_build_array(
        jsonb_build_object('team', 'Argentina', 'to_qualify_pct', 76, 'to_win_group_pct', 58, 'to_qualify_price_cents', 76, 'to_win_group_price_cents', 58, 'provider', 'Kalshi', 'last_updated_at', '2026-03-20T15:00:00Z'),
        jsonb_build_object('team', 'Mexico', 'to_qualify_pct', 49, 'to_win_group_pct', 20, 'to_qualify_price_cents', 49, 'to_win_group_price_cents', 20, 'provider', 'Kalshi', 'last_updated_at', '2026-03-20T15:00:00Z'),
        jsonb_build_object('team', 'Poland', 'to_qualify_pct', 44, 'to_win_group_pct', 16, 'to_qualify_price_cents', 44, 'to_win_group_price_cents', 16, 'provider', 'Kalshi', 'last_updated_at', '2026-03-20T15:00:00Z'),
        jsonb_build_object('team', 'Saudi Arabia', 'to_qualify_pct', 31, 'to_win_group_pct', 6, 'to_qualify_price_cents', 31, 'to_win_group_price_cents', 6, 'provider', 'Kalshi', 'last_updated_at', '2026-03-20T15:00:00Z')
      ),
      'fixtures', jsonb_build_array(
        jsonb_build_object(
          'match_id', 'wc-2026-group-b-argentina-vs-mexico-2026-06-18',
          'label', 'Argentina vs Mexico',
          'scheduled_at', '2026-06-18T20:00:00Z',
          'round', 'matchday_2'
        ),
        jsonb_build_object(
          'match_id', 'wc-2026-group-b-poland-vs-saudi-arabia-2026-06-19',
          'label', 'Poland vs Saudi Arabia',
          'scheduled_at', '2026-06-19T17:00:00Z',
          'round', 'matchday_2'
        )
      ),
      'next_match_id', 'wc-2026-group-b-argentina-vs-mexico-2026-06-18',
      'group_state', 'open',
      'history_summary', 'Round-one prices widened early, then compressed into matchday-two anchor windows.',
      'related_links', jsonb_build_array(
        jsonb_build_object('label', 'Argentina', 'path', '/world-cup-2026/teams/argentina'),
        jsonb_build_object('label', 'Mexico', 'path', '/world-cup-2026/teams/mexico'),
        jsonb_build_object('label', 'Argentina vs Mexico', 'path', '/world-cup-2026/groups/group-b/argentina-vs-mexico')
      ),
      'last_updated_at', '2026-03-20T15:00:00Z'
    ),
    1
  ),
  (
    'wc-2026-group-b-argentina-vs-mexico-2026-06-18',
    jsonb_build_object(
      'round', 'matchday_2',
      'home_team', 'Argentina',
      'away_team', 'Mexico',
      'status', 'pregame',
      'scheduled_at', '2026-06-18T20:00:00Z',
      'moneyline', jsonb_build_object('home', '-138', 'away', '+385', 'draw', '+255', 'provider', 'DraftKings'),
      'total', jsonb_build_object('line', 2.5, 'over', '-112', 'under', '-108'),
      'team_needs', jsonb_build_object(
        'home', 'Win to stay in direct control of the group.',
        'away', 'Draw keeps qualification path above coin-flip.'
      ),
      'last_updated_at', '2026-03-20T15:00:00Z'
    ),
    1
  ),
  (
    'wc-2026-group-b-poland-vs-saudi-arabia-2026-06-19',
    jsonb_build_object(
      'round', 'matchday_2',
      'home_team', 'Poland',
      'away_team', 'Saudi Arabia',
      'status', 'pregame',
      'scheduled_at', '2026-06-19T17:00:00Z',
      'moneyline', jsonb_build_object('home', '+125', 'away', '+240', 'draw', '+210', 'provider', 'DraftKings'),
      'total', jsonb_build_object('line', 2.25, 'over', '+102', 'under', '-122'),
      'team_needs', jsonb_build_object(
        'home', 'Three points likely moves qualification probability above 60%.',
        'away', 'Anything less than a draw puts elimination pressure on matchday three.'
      ),
      'last_updated_at', '2026-03-20T15:00:00Z'
    ),
    1
  ),
  (
    'wc-2026-argentina',
    jsonb_build_object(
      'team_name', 'Argentina',
      'group_id', 'wc-2026-group-b',
      'market_ids', jsonb_build_array('wc-2026-argentina-to-qualify-group-b', 'wc-2026-argentina-to-win-group-b'),
      'last_updated_at', '2026-03-20T15:00:00Z'
    ),
    1
  ),
  (
    'wc-2026-argentina-to-qualify-group-b',
    jsonb_build_object(
      'team', 'Argentina',
      'market_type', 'to_qualify',
      'probability_pct', 76,
      'provider', 'DraftKings',
      'last_updated_at', '2026-03-20T15:00:00Z'
    ),
    1
  ),
  (
    'wc-2026-argentina-to-win-group-b',
    jsonb_build_object(
      'team', 'Argentina',
      'market_type', 'to_win_group',
      'probability_pct', 58,
      'provider', 'DraftKings',
      'last_updated_at', '2026-03-20T15:00:00Z'
    ),
    1
  )
ON CONFLICT (object_id) DO UPDATE
SET
  state = EXCLUDED.state,
  state_version = public.object_ledger_current_state.state_version + 1,
  updated_at = now();

INSERT INTO public.object_ledger_events (
  object_id,
  event_type,
  event_ts,
  payload,
  source
)
SELECT
  x.object_id,
  x.event_type,
  x.event_ts,
  x.payload,
  x.source
FROM (
  VALUES
    (
      'wc-2026-group-b',
      'host_city_updated',
      '2026-03-15T09:00:00Z'::timestamptz,
      jsonb_build_object('host_city', 'Los Angeles', 'image_url', '/world-cup/host-cities/los-angeles.svg'),
      'editorial_seed'
    ),
    (
      'wc-2026-group-b',
      'group_table_updated',
      '2026-03-17T18:10:00Z'::timestamptz,
      jsonb_build_object('round', 'matchday_1', 'leader', 'Argentina'),
      'editorial_seed'
    ),
    (
      'wc-2026-group-b',
      'odds_updated',
      '2026-03-19T12:30:00Z'::timestamptz,
      jsonb_build_object('provider', 'DraftKings', 'market_scope', 'group_qualification'),
      'editorial_seed'
    ),
    (
      'wc-2026-group-b',
      'qualification_state_changed',
      '2026-03-19T18:45:00Z'::timestamptz,
      jsonb_build_object('state', 'open', 'reason', 'matchday_2 prices tightened'),
      'editorial_seed'
    ),
    (
      'wc-2026-group-b-argentina-vs-mexico-2026-06-18',
      'lineup_news_added',
      '2026-03-20T10:00:00Z'::timestamptz,
      jsonb_build_object('headline', 'Argentina expected XI unchanged from opening match'),
      'editorial_seed'
    )
) AS x(object_id, event_type, event_ts, payload, source)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.object_ledger_events existing
  WHERE existing.object_id = x.object_id
    AND existing.event_type = x.event_type
    AND existing.event_ts = x.event_ts
);

GRANT SELECT ON public.object_ledger_objects TO anon, authenticated, service_role;
GRANT SELECT ON public.object_ledger_current_state TO anon, authenticated, service_role;
GRANT SELECT ON public.object_ledger_events TO anon, authenticated, service_role;
GRANT SELECT ON public.v_wc_group_summaries TO anon, authenticated, service_role;
GRANT SELECT ON public.v_canonical_registry_compat TO anon, authenticated, service_role;
GRANT INSERT, UPDATE, DELETE ON public.object_ledger_objects TO service_role;
GRANT INSERT, UPDATE, DELETE ON public.object_ledger_current_state TO service_role;
GRANT INSERT, UPDATE, DELETE ON public.object_ledger_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.object_ledger_events_event_id_seq TO service_role;

GRANT EXECUTE ON FUNCTION public.upsert_object_current_state(text, jsonb, text, jsonb, timestamptz, text)
TO service_role;
