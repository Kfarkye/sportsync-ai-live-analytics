-- ============================================================================
-- SUPABASE DATABASE AUDIT SCRIPT
-- ============================================================================
-- Run this script in your Supabase SQL Editor to get a complete overview 
-- of your database schema, triggers, functions, jobs, and security policies.
-- ============================================================================

-- 1. TABLES & COLUMNS (Schema Overview)
SELECT 
    t.table_name,
    t.table_type,
    COUNT(c.column_name) as column_count
FROM information_schema.tables t
LEFT JOIN information_schema.columns c ON t.table_name = c.table_name AND t.table_schema = c.table_schema
WHERE t.table_schema = 'public'
GROUP BY t.table_name, t.table_type
ORDER BY t.table_name;

-- 2. DETAILED COLUMN DEFINITIONS
SELECT 
    table_name, 
    column_name, 
    data_type, 
    is_nullable, 
    column_default
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;

-- 3. FUNCTIONS & STORED PROCEDURES
SELECT 
    routine_name, 
    data_type as return_type,
    is_deterministic as immutable
FROM information_schema.routines
WHERE routine_schema = 'public'
AND routine_type = 'FUNCTION'
ORDER BY routine_name;

-- 4. ACTIVE TRIGGERS
SELECT 
    event_object_table as table_name,
    trigger_name,
    event_manipulation as event,
    action_timing as timing
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY event_object_table;

-- 5. ROW LEVEL SECURITY (RLS) POLICIES
SELECT 
    tablename, 
    policyname, 
    cmd as action, 
    permissive
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename;

-- 6. CRON JOBS (PG_CRON)
-- Note: This requires the pg_cron extension to be enabled.
-- If this query fails, it means pg_cron is not enabled or you lack permissions.
SELECT 
    jobid, 
    schedule, 
    command, 
    nodename, 
    nodeport, 
    database, 
    username, 
    active 
FROM cron.job;

-- 7. AUDIT SAMPLE DATA (First row of key tables)
-- Uncomment specific tables to check sample data
-- SELECT * FROM public.matches LIMIT 1;
-- SELECT * FROM public.match_news LIMIT 1;
-- SELECT * FROM public.users LIMIT 1;
