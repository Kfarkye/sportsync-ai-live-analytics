-- Reload schema to resolve PostgREST cache issues
NOTIFY pgrst, 'reload schema';
