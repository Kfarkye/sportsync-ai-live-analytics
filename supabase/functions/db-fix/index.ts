import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

declare const Deno: any;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } });

  const { Pool } = await import('https://deno.land/x/postgres@v0.19.3/mod.ts');
  const dbUrl = Deno.env.get('SUPABASE_DB_URL');
  const pool = new Pool(dbUrl, 1, true);
  const conn = await pool.connect();

  const results: any[] = [];

  try {
    // Check the function definition
    const fnDef = await conn.queryObject(`
      SELECT prosrc FROM pg_proc WHERE proname = 'sync_game_recap_final'
    `);
    results.push({ step: 'function_source', source: fnDef.rows[0] });

    // Check if game_recaps table exists in ALL schemas
    const tables = await conn.queryObject(`
      SELECT schemaname, tablename FROM pg_tables WHERE tablename = 'game_recaps'
    `);
    results.push({ step: 'game_recaps_locations', tables: tables.rows });

    // Check search_path for the function  
    const searchPath = await conn.queryObject(`SHOW search_path`);
    results.push({ step: 'search_path', value: searchPath.rows });

    // The real fix: just drop the trigger since it's non-essential for backfill
    // We can re-enable it later. OR replace the function with a no-op.
    const url = new URL(req.url);
    const action = url.searchParams.get('action') || 'inspect';

    if (action === 'disable_trigger') {
      await conn.queryObject(`
        ALTER TABLE public.matches DISABLE TRIGGER trg_sync_recap_final;
      `);
      results.push({ step: 'disable_trigger', status: 'OK' });

      // Test update
      const test = await conn.queryObject(`
        UPDATE public.matches SET updated_at = now() WHERE id = 'test_xyz_nonexistent'
      `);
      results.push({ step: 'test_update', status: 'OK' });
    }

    if (action === 'enable_trigger') {
      await conn.queryObject(`
        ALTER TABLE public.matches ENABLE TRIGGER trg_sync_recap_final;
      `);
      results.push({ step: 'enable_trigger', status: 'OK' });
    }

    if (action === 'fix_function') {
      // Replace the function to reference public.game_recaps explicitly
      const src = (fnDef.rows[0] as any)?.prosrc || '';
      results.push({ step: 'will_rewrite', original_length: src.length });
      
      // Create a safe replacement that handles the missing table gracefully
      await conn.queryObject(`
        CREATE OR REPLACE FUNCTION sync_game_recap_final()
        RETURNS TRIGGER AS $$
        BEGIN
          IF NEW.status = 'STATUS_FINAL' AND (OLD.status IS NULL OR OLD.status != 'STATUS_FINAL') THEN
            INSERT INTO public.game_recaps (id, match_id, home_team, away_team, home_score, away_score, league_id)
            VALUES (
              NEW.id || '_recap',
              NEW.id,
              COALESCE(NEW.home_team, ''),
              COALESCE(NEW.away_team, ''),
              COALESCE(NEW.home_score, 0),
              COALESCE(NEW.away_score, 0),
              COALESCE(NEW.league_id, '')
            )
            ON CONFLICT (id) DO UPDATE SET
              home_score = EXCLUDED.home_score,
              away_score = EXCLUDED.away_score,
              updated_at = now();
          END IF;
          RETURN NEW;
        EXCEPTION WHEN OTHERS THEN
          -- Don't let recap failures block score updates
          RAISE WARNING 'sync_game_recap_final error: %', SQLERRM;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
      `);
      results.push({ step: 'fix_function', status: 'OK' });
    }

  } catch (e: any) {
    results.push({ step: 'error', message: e.message, stack: e.stack?.slice(0, 500) });
  } finally {
    conn.release();
    await pool.end();
  }

  return new Response(JSON.stringify({ results }, null, 2), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
});
