import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const url = 'https://qffzvrnbzabcokqqrwbv.supabase.co';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUzNTc2NjgsImV4cCI6MjA3MDkzMzY2OH0.PCSnC5E7sG7FvasHy_9DdwiN061xW0GzFROLzZ0bTVnc';
const supabase = createClient(url, key);

async function check() {
  console.log("Checking DB for Washington Wizards odds...");
  const { data: mData } = await supabase.from('matches')
    .select('id, start_time, home_team, away_team, current_odds, closing_odds')
    .eq('league_id', 'nba')
    .or('home_team.ilike.%washington%,away_team.ilike.%washington%')
    .order('start_time', { ascending: false })
    .limit(3);
  console.log("Matches:", JSON.stringify(mData, null, 2));

  const { data: clData } = await supabase.from('closing_lines')
    .select('*')
    .order('captured_at', { ascending: false })
    .limit(10);
  console.log("Closing Lines (recent):", clData && clData.length);
}

check();
