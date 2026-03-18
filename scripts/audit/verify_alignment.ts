
import { getCanonicalMatchId } from '/Users/k.far.88/Downloads/copy-of-sportsync-ai---live-sports---analytics--9-/supabase/functions/_shared/match-registry.ts';

async function verify() {
    console.log('--- VERIFYING IDENTITY ALIGNMENT ---');
    const nhlRawId = '401803060';
    const nbaRawId = '401705000';

    const nhlCanonical = getCanonicalMatchId(nhlRawId, 'nhl');
    const nbaCanonical = getCanonicalMatchId(nbaRawId, 'nba');

    console.log(`NHL: ${nhlRawId} -> ${nhlCanonical} (Expected: 401803060_nhl)`);
    console.log(`NBA: ${nbaRawId} -> ${nbaCanonical} (Expected: 401705000_nba)`);

    if (nhlCanonical === '401803060_nhl' && nbaCanonical === '401705000_nba') {
        console.log('✅ IDENTITY ALIGNMENT SUCCESSFUL');
    } else {
        console.log('❌ IDENTITY ALIGNMENT FAILED');
    }
}

verify();
