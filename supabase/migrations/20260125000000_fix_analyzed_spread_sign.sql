
-- 20260125000000_fix_analyzed_spread_sign.sql
-- ELITE DATA FIX: Standardize analyzed_spread to always be HOME SPREAD.
-- Previously, AWAY picks stored the AWAY spread. This migration inverts them back to HOME spread.

UPDATE pregame_intel
SET 
  analyzed_spread = -analyzed_spread,
  pick_result = 'PENDING',
  graded_at = NULL,
  grading_note = 'Data Fix v1: Inverted Spread'
WHERE 
  (grading_metadata->>'side' = 'AWAY') 
  AND (grading_metadata->>'type' = 'SPREAD')
  AND (analyzed_spread IS NOT NULL)
  AND created_at >= '2026-01-24 00:00:00'; -- Target specific window of interest
