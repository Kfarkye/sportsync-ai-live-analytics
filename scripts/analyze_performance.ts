import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function analyzePerformance() {
    console.log('📊 Analyzing Performance Metadata...');

    const { data: picks, error } = await supabase
        .from('pregame_intel')
        .select('pick_result, grading_metadata, sport')
        .in('pick_result', ['WIN', 'LOSS']);

    if (error || !picks) {
        console.error('Error fetching picks:', error);
        return;
    }

    const stats = {
        overall: { wins: 0, losses: 0 },
        byType: {} as Record<string, { wins: 0, losses: 0 }>,
        bySide: {} as Record<string, { wins: 0, losses: 0 }>,
        bySport: {} as Record<string, { wins: 0, losses: 0 }>,
        totals: { over: { wins: 0, losses: 0 }, under: { wins: 0, losses: 0 } },
        spreads: { home: { wins: 0, losses: 0 }, away: { wins: 0, losses: 0 } }
    };

    for (const pick of picks) {
        const result = pick.pick_result;
        const meta = pick.grading_metadata;
        const sport = pick.sport || 'unknown';

        if (!meta) continue;

        // Overall
        if (result === 'WIN') stats.overall.wins++;
        else stats.overall.losses++;

        // By Sport
        if (!stats.bySport[sport]) stats.bySport[sport] = { wins: 0, losses: 0 };
        if (result === 'WIN') stats.bySport[sport].wins++;
        else stats.bySport[sport].losses++;

        // By Type
        const type = meta.type || 'UNKNOWN';
        if (!stats.byType[type]) stats.byType[type] = { wins: 0, losses: 0 };
        if (result === 'WIN') stats.byType[type].wins++;
        else stats.byType[type].losses++;

        // By Side (General)
        const side = meta.side || 'UNKNOWN';
        if (!stats.bySide[side]) stats.bySide[side] = { wins: 0, losses: 0 };
        if (result === 'WIN') stats.bySide[side].wins++;
        else stats.bySide[side].losses++;

        // Deep Dive
        if (type === 'TOTAL') {
            const k = side === 'OVER' ? 'over' : 'under';
            if (stats.totals[k]) {
                if (result === 'WIN') stats.totals[k].wins++;
                else stats.totals[k].losses++;
            }
        } else if (type === 'SPREAD') {
            const k = side === 'HOME' ? 'home' : 'away';
            if (stats.spreads[k]) {
                if (result === 'WIN') stats.spreads[k].wins++;
                else stats.spreads[k].losses++;
            }
        }
    }

    console.log('\n🏆 **Performance Report**\n');

    const printStat = (label: string, w: number, l: number) => {
        const total = w + l;
        if (total === 0) return;
        const rate = ((w / total) * 100).toFixed(1);
        console.log(`- **${label}**: ${w}-${l} (${rate}%)`);
    };

    console.log('--- By Bet Type ---');
    Object.entries(stats.byType).forEach(([type, s]) => printStat(type, s.wins, s.losses));

    console.log('\n--- By Specific Strategy ---');
    printStat('Over', stats.totals.over.wins, stats.totals.over.losses);
    printStat('Under', stats.totals.under.wins, stats.totals.under.losses);
    printStat('Home Spread', stats.spreads.home.wins, stats.spreads.home.losses);
    printStat('Away Spread', stats.spreads.away.wins, stats.spreads.away.losses);

    console.log('\n--- By Sport ---');
    Object.entries(stats.bySport).sort((a, b) => (b[1].wins + b[1].losses) - (a[1].wins + a[1].losses)).forEach(([sport, s]) => printStat(sport, s.wins, s.losses));
}

analyzePerformance();
