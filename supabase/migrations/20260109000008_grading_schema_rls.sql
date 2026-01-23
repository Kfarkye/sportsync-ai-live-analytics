
-- TEMPORARY: Allow anon/authenticated to write to sharp_movements for local backfill
-- (Since local .env lacks service_role_key)

CREATE POLICY "Enable write access for all users" ON public.sharp_movements
    FOR ALL USING (true) WITH CHECK (true);
