import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function analyzeRegime() {
    console.log('🕵️‍♂️ Analyzing Performance by Regime (High Impact Drivers)...');

    const { data: picks, error } = await supabase
        .from('pregame_intel')
        .select('pick_result, cards')
        .in('pick_result', ['WIN', 'LOSS'])
        .not('cards', 'is', null);

    if (error || !picks) {
        console.error('Error fetching picks:', error);
        return;
    }

    const stats: Record<string, { wins: 0, losses: 0, total: 0 }> = {};

    for (const pick of picks) {
        let cards: any[] = [];
        try {
            cards = typeof pick.cards === 'string' ? JSON.parse(pick.cards) : pick.cards;
        } catch (e) {
            continue;
        }

        if (!Array.isArray(cards)) continue;

        // Find High Impact cards
        const highImpactCards = cards.filter((c: any) => c.impact === 'HIGH' || c.impact === 'CRITICAL');

        // If no high impact, check Medium
        const drivers = highImpactCards.length > 0
            ? highImpactCards
            : cards.filter((c: any) => c.impact === 'MEDIUM');

        // Attribute Win/Loss to each driving regime
        const seenCategories = new Set<string>();

        for (const card of drivers) {
            const category = card.category || 'Unknown';
            if (seenCategories.has(category)) continue;
            seenCategories.add(category);

            if (!stats[category]) stats[category] = { wins: 0, losses: 0, total: 0 };

            stats[category].total++;
            if (pick.pick_result === 'WIN') stats[category].wins++;
            else stats[category].losses++;
        }
    }

    console.log('\n🧠 **Regime Performance (Win %)**\n');

    const sortedRegimes = Object.entries(stats)
        .sort((a, b) => b[1].total - a[1].total); // Sort by volume

    for (const [regime, data] of sortedRegimes) {
        const rate = (data.wins / data.total) * 100;
        console.log(`- **${regime}**: ${data.wins}-${data.losses} (${rate.toFixed(1)}%) [Vol: ${data.total}]`);
    }
}

analyzeRegime();
