-- Migration: Add simulation_data to pregame_intel
-- Date: January 8, 2026

ALTER TABLE public.pregame_intel 
ADD COLUMN IF NOT EXISTS simulation_data JSONB;

-- Verify
SELECT 'simulation_data column added' as result;
