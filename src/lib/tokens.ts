// ═══════════════════════════════════════════════════════════════
// SSOT Bridge — all values derived from ESSENCE v12 (Editorial Light)
// Analytics pages import from here; this file imports from ESSENCE only.
// ═══════════════════════════════════════════════════════════════

import { ESSENCE } from './essence';

// ── Colors — mapped 1:1 from ESSENCE ────────────────────────────
export const color = {
    bg: ESSENCE.colors.surface.base,     // #F8FAFC (slate-50)
    surface: ESSENCE.colors.surface.card,     // #FFFFFF
    surface2: ESSENCE.colors.surface.subtle,   // #F1F5F9 (slate-100)
    border: ESSENCE.colors.border.default,   // #E2E8F0 (slate-200)

    text: ESSENCE.colors.text.primary,        // #0F172A (slate-900)
    text2: ESSENCE.colors.text.secondary,      // #64748B (slate-500)
    text3: ESSENCE.colors.text.tertiary,       // #94A3B8 (slate-400)

    accent: ESSENCE.colors.accent.emerald,     // #10B981

    win: ESSENCE.colors.accent.emerald,       // #10B981
    loss: ESSENCE.colors.accent.rose,          // #F43F5E
} as const;

// ── Typography — same families ESSENCE enforces ─────────────────
export const font = {
    mono: `'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`,
    sans: `'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif`,
    serif: `'Newsreader', Georgia, 'Times New Roman', serif`,
} as const;

// ── Radius — forwarded from ESSENCE ─────────────────────────────
export const radius = ESSENCE.radius;

// ── Spacing ─────────────────────────────────────────────────────
export const spacing = ESSENCE.spacing;

// ── Helpers ─────────────────────────────────────────────────────
export function fmtOdds(n: number | null | undefined): string {
    if (n == null) return '—';
    return n > 0 ? `+${n}` : String(n);
}

export function fmtSpread(n: number): string {
    if (n > 0) return `+${n}`;
    if (n === 0) return 'PK';
    return String(n);
}
