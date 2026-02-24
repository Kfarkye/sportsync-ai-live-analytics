const { createClient } = require('@supabase/supabase-js');
const url = 'https://qffzvrnbzabcokqqrwbv.supabase.co';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUzNTc2NjgsImV4cCI6MjA3MDkzMzY2OH0.PCSnC5E7sG7FvasHy_9DdwiN061xW0GzFROLzZ0bTVnc';
const supabase = createClient(url, key);

async function run() {
  const res = await supabase.from('matches').select('id').limit(1);
  console.log(res);
}
run();
