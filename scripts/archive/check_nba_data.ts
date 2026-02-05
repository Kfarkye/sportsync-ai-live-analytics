
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    Deno.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkData() {
    console.log("Checking nba_games...");
    const { data: games, error: gamesError } = await supabase
        .from("nba_games")
        .select("*")
        .limit(5);

    if (gamesError) {
        console.error("Error fetching games:", gamesError);
    } else {
        console.log(`Found ${games?.length} games.`);
        console.table(games);
    }

    console.log("\nChecking nba_snapshots...");
    const { data: snapshots, error: snapError } = await supabase
        .from("nba_snapshots")
        .select("*")
        .limit(5)
        .order("ts", { ascending: false });

    if (snapError) {
        console.error("Error fetching snapshots:", snapError);
    } else {
        console.log(`Found ${snapshots?.length} snapshots.`);
        console.table(snapshots);
    }
}

checkData();
