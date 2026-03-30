// ============================================================================
// SSOT Bridge — Analytics pages import from here ONLY.
// All values are forwarded from SportsSync warm-light tokens.
// No hex literals outside of ESSENCE. No per-page palette objects.
//
// SSOT COLOR RULES:
// - UI accent: SPORTSSYNC_TOKENS.color.accent only (links, focus, primary buttons)
// - Outcomes only: SPORTSSYNC_TOKENS.color.positive / negative (win/loss). Push uses text3.
// - Team colors only in logos + tiny markers + charts. Never for tabs/buttons/borders.
// - Do not use emerald/amber/violet/cyan keys directly in UI components.
// ============================================================================

import { SPORTSSYNC_TOKENS } from './design-tokens';

// ── Colors — direct semantic mapping from ESSENCE ────────────────
export const color = {
    bg: SPORTSSYNC_TOKENS.color.bg,
    surface: SPORTSSYNC_TOKENS.color.surface,
    surface2: SPORTSSYNC_TOKENS.color.surface,
    border: SPORTSSYNC_TOKENS.color.border,

    text: SPORTSSYNC_TOKENS.color.textPrimary,
    text2: SPORTSSYNC_TOKENS.color.textSecondary,
    text3: SPORTSSYNC_TOKENS.color.textTertiary,

    // ✅ UI accent — primary, NOT win
    accent: SPORTSSYNC_TOKENS.color.accent,

    // ✅ Outcome semantics
    win: SPORTSSYNC_TOKENS.color.positive,
    loss: SPORTSSYNC_TOKENS.color.negative,
} as const;

// ── Typography ───────────────────────────────────────────────────
export const font = {
    mono: SPORTSSYNC_TOKENS.font.mono,
    sans: SPORTSSYNC_TOKENS.font.body,
    serif: SPORTSSYNC_TOKENS.font.title,
} as const;

// ── Radius + Spacing — forwarded from ESSENCE ────────────────────
export const radius = {
    sm: '4px',
    md: SPORTSSYNC_TOKENS.radius.control,
    lg: SPORTSSYNC_TOKENS.radius.card,
    xl: '12px',
    '2xl': '16px',
} as const;

export const spacing = {
    xs: '4px',
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '24px',
} as const;

// ── Helpers (namespaced to avoid collisions with postgame.ts) ────
export const fmt = {
    odds(n: number | null | undefined): string {
        if (n == null) return '—';
        return n > 0 ? `+${n}` : String(n);
    },
    spread(n: number): string {
        if (n > 0) return `+${n}`;
        if (n === 0) return 'PK';
        return String(n);
    },
} as const;

// Convenience export
export const SSOT = { color, font, radius, spacing, fmt } as const;
