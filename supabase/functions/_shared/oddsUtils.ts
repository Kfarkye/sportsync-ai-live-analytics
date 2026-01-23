
// =============================================================================
// SHARED ODDS UTILS (Deno-Compatible)
// =============================================================================

export const getOddsValue = (v: any, type?: 'spread' | 'price' | 'total'): number | null => {
    if (v === undefined || v === null || v === '') return null;

    if (typeof v === 'number') {
        if (isNaN(v)) return null;
        if (type === 'spread' && Math.abs(v) >= 100) return null;
        return v;
    }

    const s = String(v).toUpperCase().trim();
    if (s === 'PK' || s === 'PICK' || s === 'EV' || s === 'EVEN') return 0;
    if (s === '-' || s === 'N/A' || s === 'NL') return null;

    const parts = s.split(/\s+/);
    let target = s;

    if (parts.length > 1) {
        const linePart = parts.find(p => p.match(/[-+]?\d/));
        if (linePart) target = linePart;
    }

    const clean = target
        .replace(/^(O|U|OVER|UNDER)\s*/i, '')
        .split('(')[0]
        .replace(/[^\d.-]/g, '');

    const match = clean.match(/([-+]?\d+(\.\d+)?)/);
    if (!match) return null;

    const num = parseFloat(match[1]);
    if (isNaN(num)) return null;

    if (type === 'spread' && Math.abs(num) >= 100) return null;

    return num;
};
