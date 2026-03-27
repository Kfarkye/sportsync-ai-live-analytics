
-- Migration: Consolidate duplicate permissive RLS policies
-- When a table has multiple permissive policies for the same role+action,
-- Postgres must evaluate ALL of them (OR'd). Removing duplicates is pure perf.

-- app_config: keep "Allow public read access" (anon,authenticated), drop "Public read access for app_config" (public)
DROP POLICY IF EXISTS "Public read access for app_config" ON public.app_config;

-- canonical_games: keep "Public read canonical_games" (anon,authenticated), drop "Public Read Access" (public)
DROP POLICY IF EXISTS "Public Read Access" ON public.canonical_games;

-- chat_knowledge_base: keep "ckb_public_read", drop "Public Read Knowledge" (both public)
DROP POLICY IF EXISTS "Public Read Knowledge" ON public.chat_knowledge_base;

-- coaches: keep "Public read coaches", drop "Coaches are publicly readable" (both identical)
DROP POLICY IF EXISTS "Coaches are publicly readable" ON public.coaches;

-- entity_mappings: keep "Public read entity_mappings" (anon,authenticated), drop "Public Read Access" (public)
DROP POLICY IF EXISTS "Public Read Access" ON public.entity_mappings;

-- game_events: keep "public_read_live" (true), drop "public_read_final" (subset filter, redundant when public_read_live=true)
DROP POLICY IF EXISTS "public_read_final" ON public.game_events;

-- live_forecast_snapshots: keep "Allow public read", drop "Allow public read-only access to forecast snapshots"
DROP POLICY IF EXISTS "Allow public read-only access to forecast snapshots" ON public.live_forecast_snapshots;
-- Also consolidate duplicate service_role ALL policies
DROP POLICY IF EXISTS "service_role_full" ON public.live_forecast_snapshots;

-- live_game_state: keep "Public read live_game_state" (anon,authenticated), drop "Public read access for live_game_state" (public)
DROP POLICY IF EXISTS "Public read access for live_game_state" ON public.live_game_state;

-- live_scores: keep "live_scores_public_read", drop "live_scores_read_public"
DROP POLICY IF EXISTS "live_scores_read_public" ON public.live_scores;

-- nba_team_priors: keep "Public read nba_team_priors" (anon,authenticated), drop "Allow read access to nba_team_priors" (public)
DROP POLICY IF EXISTS "Allow read access to nba_team_priors" ON public.nba_team_priors;

-- player_prop_bets: keep "Public read player_prop_bets", drop "Public Read Access for Player Props"
DROP POLICY IF EXISTS "Public Read Access for Player Props" ON public.player_prop_bets;

-- pregame_intel: keep "Public read pregame_intel", drop "pregame_intel_public_read" and "Public Analytics Access"
DROP POLICY IF EXISTS "pregame_intel_public_read" ON public.pregame_intel;
DROP POLICY IF EXISTS "Public Analytics Access" ON public.pregame_intel;
-- Also consolidate 4 duplicate service_role ALL policies down to 1
DROP POLICY IF EXISTS "pregame_intel_service_write" ON public.pregame_intel;
DROP POLICY IF EXISTS "service_role_all" ON public.pregame_intel;
DROP POLICY IF EXISTS "service_role_unrestricted" ON public.pregame_intel;

-- sharp_movements: keep "Public read sharp_movements" (anon,authenticated), drop "Enable read access for all users" (public)
DROP POLICY IF EXISTS "Enable read access for all users" ON public.sharp_movements;
;
