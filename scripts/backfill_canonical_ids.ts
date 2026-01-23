
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { generateDeterministicId } from '../supabase/functions/_shared/match-registry.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    Deno.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

async function main() {
    console.log("Starting Backfill: Canonical Identity Layer (Snap-in)")

    // Fetch all future or recently active matches
    // We filter vaguely to avoid grabbing thousands of old games purely for efficiency
    // Ideally we'd do all open games.
    const now = new Date()
    const lookback = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString() // -24h

    const { data: matches, error } = await supabase
        .from('matches')
        .select('*')
        .or(`status.eq.STATUS_SCHEDULED,status.eq.STATUS_IN_PROGRESS,status.eq.STATUS_HALFTIME`)
        .gt('start_time', lookback)

    if (error) {
        console.error("Error fetching matches:", error)
        return
    }

    console.log(`Found ${matches.length} matches to backfill...`)

    for (const match of matches) {
        try {
            // Generate ID
            const canonicalId = generateDeterministicId(
                match.home_team,
                match.away_team,
                match.start_time,
                match.league_id
            )

            // 1. Register Canonical Game
            const { error: kgError } = await supabase.from('canonical_games').upsert({
                id: canonicalId,
                league_id: match.league_id,
                sport: match.sport || 'unknown',
                home_team_name: match.home_team,
                away_team_name: match.away_team,
                commence_time: match.start_time,
                status: match.status
            })

            if (kgError) {
                console.error(`[KG Error] ${canonicalId}:`, kgError)
                continue
            }

            // 2. Register Entity Mapping (ESPN/Provider)
            const { error: mapError } = await supabase.from('entity_mappings').upsert({
                canonical_id: canonicalId,
                provider: 'ESPN', // Assuming existing matches are ESPN sourced
                external_id: match.id,
                discovery_method: 'backfill'
            }, { onConflict: 'provider,external_id' })

            if (mapError) {
                console.error(`[Map Error] ${match.id} -> ${canonicalId}:`, mapError)
            }

            // 3. Update Match Record (Snap-in)
            const { error: updateError } = await supabase
                .from('matches')
                .update({ canonical_id: canonicalId })
                .eq('id', match.id)

            if (updateError) {
                console.error(`[Update Error] ${match.id}:`, updateError)
            } else {
                console.log(`[Success] Snapped-in ${match.home_team} vs ${match.away_team} -> ${canonicalId}`)
            }

        } catch (e) {
            console.error(`[Exception] Processing ${match.id}:`, e)
        }
    }

    console.log("Backfill Complete.")
}

main()
