-- Migration: Add baseline column to team_blowout_priors
-- Created at: 2025-12-23

alter table public.team_blowout_priors
add column if not exists baseline jsonb;
