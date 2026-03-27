-- Fix search_path on refresh_nba_master_views for security hardening
-- Mirrors the pattern from 20260320061734_fix_function_search_path_batch5.sql

ALTER FUNCTION public.refresh_nba_master_views() SET search_path = '';
