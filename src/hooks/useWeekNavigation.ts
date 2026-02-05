import { useMemo } from 'react';
import { Sport } from '@/types';
import { WeekOption } from '@/types/matchList';

/**
 * NFL 2025-26 Season
 * Week 1: Sept 4, 2025
 */

const NFL_WEEK_1_START = new Date('2025-09-04T00:00:00').getTime();
const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

const ensureDate = (input: Date | string | number): Date => {
    if (input instanceof Date && !isNaN(input.getTime())) {
        return input;
    }
    const parsed = new Date(input);
    if (!isNaN(parsed.getTime())) {
        return parsed;
    }
    // Fallback to today
    return new Date();
};

const getCurrentNFLWeek = (date: Date): number => {
    const timestamp = date.getTime();
    const diff = timestamp - NFL_WEEK_1_START;
    const weeks = Math.floor(diff / MS_PER_WEEK);

    // Week 1 = weeks 0, Week 2 = weeks 1, etc.
    let week = weeks + 1;

    // Clamp to valid range
    return Math.max(1, Math.min(22, week));
};

const getNFLWeekDate = (weekNum: number): Date => {
    const d = new Date(NFL_WEEK_1_START);
    d.setDate(d.getDate() + (weekNum - 1) * 7);
    return d;
};

const getWeekLabel = (weekNum: number): string => {
    if (weekNum <= 18) return `Week ${weekNum}`;
    if (weekNum === 19) return 'Wild Card';
    if (weekNum === 20) return 'Divisional';
    if (weekNum === 21) return 'Conf. Champ';
    if (weekNum === 22) return 'Super Bowl';
    return `Week ${weekNum}`;
};

export const useWeekNavigation = (selectedDate: Date | string, sport: Sport) => {
    return useMemo(() => {
        const safeDate = ensureDate(selectedDate);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const options: WeekOption[] = [];
        const isFootball = sport === Sport.NFL || sport === Sport.COLLEGE_FOOTBALL;

        if (isFootball) {
            const currentWeek = getCurrentNFLWeek(safeDate);

            // Generate 5 options centered on current week
            for (let i = -2; i <= 2; i++) {
                const weekNum = currentWeek + i;
                if (weekNum < 1 || weekNum > 22) continue;

                const weekDate = getNFLWeekDate(weekNum);

                options.push({
                    label: getWeekLabel(weekNum),
                    value: weekDate.toISOString(),
                    isCurrent: i === 0,
                });
            }
        } else {
            // Daily navigation - Extend to +/- 7 days for professional coverage
            for (let i = -7; i <= 7; i++) {
                const d = new Date(safeDate);
                d.setDate(d.getDate() + i);

                const isToday = d.toDateString() === today.toDateString();

                let label: string;
                if (isToday) {
                    label = 'Today';
                } else if (i === 0) {
                    label = d.toLocaleDateString('en-US', { weekday: 'long' });
                } else {
                    label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
                }

                options.push({
                    label,
                    value: d.toISOString(),
                    isCurrent: i === 0,
                });
            }
        }

        return options;
    }, [selectedDate, sport]);
};