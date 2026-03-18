import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function analyzeWinners() {
    console.log('🏆 Decoding the DNA of Winners...');

    const { data: winners, error } = await supabase
        .from('pregame_intel')
        .select('*')
        .eq('pick_result', 'WIN')
        .not('cards', 'is', null);

    if (error || !winners) return console.error(error);

    const successfulThemes: Record<string, number> = {};
    const keywords: Record<string, number> = {};

    for (const win of winners) {
        let cards: any[] = [];
        try {
            cards = typeof win.cards === 'string' ? JSON.parse(win.cards) : win.cards;
        } catch (e) { continue; }

        // Find the "High Impact" card that drove the thesis
        const drivers = cards.filter((c: any) => c?.impact === 'HIGH' || c?.impact === 'CRITICAL');

        for (const card of drivers) {
            // Track Category
            const cat = card.category || 'Unknown';
            successfulThemes[cat] = (successfulThemes[cat] || 0) + 1;

            // Track Keywords in Thesis (Simple n-gram)
            const thesis = (card.thesis || "").toLowerCase();
            const words = ["fatigue", "rest", "pace", "efficiency", "variance", "public", "sharp", "defense", "offense", "mismatch", "rebound", "momentum", "travel", "back-to-back"];

            for (const w of words) {
                if (thesis.includes(w)) {
                    keywords[w] = (keywords[w] || 0) + 1;
                }
            }
        }
    }

    console.log(`\nAnalyzing ${winners.length} confirmed WINS.\n`);

    console.log('--- Top Winning Categories ---');
    Object.entries(successfulThemes)
        .sort((a, b) => b[1] - a[1])
        .forEach(([k, v]) => console.log(`${k}: ${v} wins`));

    console.log('\n--- Top Winning Concepts (Keywords) ---');
    Object.entries(keywords)
        .sort((a, b) => b[1] - a[1])
        .forEach(([k, v]) => console.log(`${k}: ${v} occurrences`));
}

analyzeWinners();
