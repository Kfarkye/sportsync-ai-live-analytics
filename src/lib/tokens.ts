// ============================================================================
// SSOT Bridge — Analytics pages import from here ONLY.
// All values are forwarded from ESSENCE (the single design source of truth).
// No hex literals outside of ESSENCE. No per-page palette objects.
//
// SSOT COLOR RULES:
// - UI accent: ESSENCE.colors.accent.primary only (links, focus, primary buttons)
// - Outcomes only: ESSENCE.colors.accent.success / danger (win/loss). Push uses text3.
// - Team colors only in logos + tiny markers + charts. Never for tabs/buttons/borders.
// - Do not use emerald/amber/violet/cyan keys directly in UI components.
// ============================================================================

import { ESSENCE } from './essence';

// ── Colors — direct semantic mapping from ESSENCE ────────────────
export const color = {
    bg: ESSENCE.colors.surface.base,
    surface: ESSENCE.colors.surface.card,
    surface2: ESSENCE.colors.surface.subtle,
    border: ESSENCE.colors.border.default,

    text: ESSENCE.colors.text.primary,
    text2: ESSENCE.colors.text.secondary,
    text3: ESSENCE.colors.text.tertiary,

    // ✅ UI accent — primary, NOT win
    accent: ESSENCE.colors.accent.primary,

    // ✅ Outcome semantics
    win: ESSENCE.colors.accent.success,
    loss: ESSENCE.colors.accent.danger,
} as const;

// ── Typography ───────────────────────────────────────────────────
export const font = {
    mono: `'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`,
    sans: `'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif`,
    serif: `'Newsreader', Georgia, 'Times New Roman', serif`,
} as const;

// ── Radius + Spacing — forwarded from ESSENCE ────────────────────
export const radius = ESSENCE.radius;
export const spacing = ESSENCE.spacing;

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
