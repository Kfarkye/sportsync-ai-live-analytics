import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import "https://deno.land/x/dotenv/load.ts";

const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const { data, error } = await supabase
    .from('pregame_intel')
    .select('match_id, game_date, is_edge_of_day, logic_authority')
    .eq('is_edge_of_day', true);

if (error) {
    console.error("Error:", error);
} else {
    console.log("Current Edges of the Day:");
    data.forEach(d => {
        console.log(`- Date: ${d.game_date} | Match: ${d.match_id} | Edge: ${d.is_edge_of_day}`);
    });
}
