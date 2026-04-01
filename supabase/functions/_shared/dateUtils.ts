/**
 * Validates if the input is a valid Date or can be parsed into one.
 */
export const isValidDate = (d: any): boolean => {
    if (d instanceof Date) return !isNaN(d.getTime());
    if (typeof d === 'string' || typeof d === 'number') {
        const parsed = new Date(d);
        return !isNaN(parsed.getTime());
    }
    return false;
};

/**
 * Safely parses a date input, falling back to "Today" if invalid.
 */
export const safeParseDate = (input: any): Date => {
    if (!input) return new Date();
    const d = new Date(input);
    return !isNaN(d.getTime()) ? d : new Date();
};

/**
 * Formats a Date object to 'YYYY-MM-DD' string based on the user's LOCAL timezone.
 * This prevents off-by-one day errors that happen when using .toISOString() (which is UTC).
 */
export const formatLocalDate = (date: Date): string => {
    const d = safeParseDate(date);
    const offset = d.getTimezoneOffset() * 60000;
    const localDate = new Date(d.getTime() - offset);
    return localDate.toISOString().split('T')[0];
};

/**
 * Formats a Date object for API consumption if needed differently.
 */
export const formatDateForApi = (date: Date): string => {
    return formatLocalDate(date).replace(/-/g, '');
};
