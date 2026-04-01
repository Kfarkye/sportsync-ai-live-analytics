// Fix: Add Deno global declaration for TypeScript compatibility
declare const Deno: any;

import { createClient } from 'jsr:@supabase/supabase-js@2'

console.log('History Janitor starting...')

Deno.serve(async (req) => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // IDs to nuke: 18576 (and any others for this match > T+5m)
    // We will redo the logic: Find match 401810385_nba
    const matchId = '401810385_nba'

    // 1. Get Match
    const { data: match } = await supabase.from('matches').select('start_time').eq('id', matchId).single()
    if (!match) return new Response('Match not found', { status: 404 })

    const startTime = new Date(match.start_time).getTime()
    const threshold = new Date(startTime + 5 * 60 * 1000).toISOString()

    // 2. Update
    const { data, error, count } = await supabase
      .from('market_history')
      .update({ is_live: true })
      .eq('match_id', matchId)
      .eq('is_live', false)
      .gt('ts', threshold)
      .select()

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 })
    }

    return new Response(
      JSON.stringify({
        message: 'Cleanup successful',
        fixed_count: count,
        fixed_rows: data
      }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }
})
