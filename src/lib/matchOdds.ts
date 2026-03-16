import { formatOddsByMode } from './oddsDisplay';
import type { OddsLensMode } from '@/store/appStore';

export type MatchRowOddLabel = 'SPR' | 'O/U' | 'ML';

export interface MatchRowOddPayload {
    label: MatchRowOddLabel;
    display: string;
    mobileHidden?: boolean;
}

interface MatchRowOddSource {
    label: MatchRowOddLabel;
    value: string | number | null | undefined;
}

export interface BuildMatchRowOddsOptions {
    /** Maximum odds chips shown on very narrow mobile widths. */
    maxMobileChips?: number;
    /** Hide duplicate chips with the same rendered value, regardless of label. */
    dedupeByValue?: boolean;
}

export const isValidOdd = (value: string | number | null | undefined): boolean =>
    value !== null && value !== undefined && value !== '-' && value !== '';

export const resolveMatchRowOddsDisplay = (
    value: string | number | null | undefined,
    label: MatchRowOddLabel,
    mode: OddsLensMode,
): string | null => {
    if (!isValidOdd(value)) return null;

    if (label === 'SPR') {
        const num = Number(value);
        if (Number.isNaN(num)) return String(value);
        if (num === 0) return 'PK';
        return num > 0 && !String(value).startsWith('+') ? `+${num}` : String(value);
    }

    if (label === 'ML') {
        return formatOddsByMode(value, mode, 'moneyline');
    }

    return String(value);
};

export const buildMatchRowOdds = (
    spread: string | number | null | undefined,
    total: string | number | null | undefined,
    homeML: string | number | null | undefined,
    mode: OddsLensMode,
    options: BuildMatchRowOddsOptions = {},
): MatchRowOddPayload[] => {
    const { maxMobileChips = 2, dedupeByValue = true } = options;

    const rawItems: MatchRowOddSource[] = [
        { label: 'SPR', value: spread },
        { label: 'O/U', value: total },
        { label: 'ML', value: homeML },
    ];

    const resolved: MatchRowOddPayload[] = [];
    const seenByLabel = new Set<string>();
    const seenByValue = new Set<string>();

    for (const item of rawItems) {
        const display = resolveMatchRowOddsDisplay(item.value, item.label, mode);
        if (!display) continue;

        const labelKey = `${item.label}:${display}`;
        if (seenByLabel.has(labelKey)) continue;
        seenByLabel.add(labelKey);

        const displayKey = display.toLowerCase();
        if (dedupeByValue && seenByValue.has(displayKey)) continue;
        seenByValue.add(displayKey);

        resolved.push({
            label: item.label,
            display,
        });
    }

    if (resolved.length <= maxMobileChips) return resolved;

    return resolved.map((item, index) => ({
        ...item,
        mobileHidden: index >= maxMobileChips,
    }));
};
