import { createClient } from "@supabase/supabase-js";
import * as fs from 'fs';

let supabaseUrl = "";
let supabaseKey = "";

if (fs.existsSync('.env')) {
    const envContent = fs.readFileSync('.env', 'utf8');
    envContent.split('\n').forEach(line => {
        const parts = line.split('=');
        if (parts.length >= 2) {
            let key = parts[0].trim().replace(/^export\s+/, '');
            let val = parts.slice(1).join('=').trim().replace(/['"]/g, '');
            if (key === 'SUPABASE_URL' || key === 'VITE_SUPABASE_URL') supabaseUrl = val;
            if (key === 'SUPABASE_SERVICE_ROLE_KEY') supabaseKey = val;
        }
    });
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function findMatch() {
    console.log("Searching for Bulls vs Jazz...");
    const { data: matches, error } = await supabase
        .from('matches')
        .select('id, home_team, away_team, start_time')
        .or('home_team.ilike.%Bulls%,away_team.ilike.%Bulls%')
        .or('home_team.ilike.%Jazz%,away_team.ilike.%Jazz%')
        .gte('start_time', '2026-01-01T00:00:00Z')
        .order('start_time', { ascending: false })
        .limit(10);

    if (error) {
        console.error("Error fetching matches:", error);
        return;
    }

    const target = matches?.find(m => 
        (m.home_team.includes('Bulls') && m.away_team.includes('Jazz')) ||
        (m.home_team.includes('Jazz') && m.away_team.includes('Bulls'))
    );

    if (target) {
        console.log("MATCH_FOUND:", JSON.stringify(target));
    } else {
        console.log("MATCH_NOT_FOUND");
        console.log("Potential matches:", JSON.stringify(matches, null, 2));
    }
}

findMatch();
