import { ESSENCE } from './essence';

/**
 * Apply ESSENCE design tokens to :root as CSS custom properties.
 * Called once on app mount — single source of truth for the DOM.
 */
export function applyEssenceToRoot(): void {
    const r = document.documentElement;

    // Surfaces
    r.style.setProperty('--bg', ESSENCE.colors.surface.base);
    r.style.setProperty('--surface', ESSENCE.colors.surface.card);
    r.style.setProperty('--surface2', ESSENCE.colors.surface.subtle);
    r.style.setProperty('--border', ESSENCE.colors.border.default);

    // Text
    r.style.setProperty('--text', ESSENCE.colors.text.primary);
    r.style.setProperty('--text2', ESSENCE.colors.text.secondary);
    r.style.setProperty('--text3', ESSENCE.colors.text.tertiary);

    // SSOT semantics
    r.style.setProperty('--accent', ESSENCE.colors.accent.primary);
    r.style.setProperty('--win', ESSENCE.colors.accent.success);
    r.style.setProperty('--loss', ESSENCE.colors.accent.danger);

    // Radius
    r.style.setProperty('--r-sm', ESSENCE.radius.sm);
    r.style.setProperty('--r-md', ESSENCE.radius.md);
    r.style.setProperty('--r-lg', ESSENCE.radius.lg);
    r.style.setProperty('--r-xl', ESSENCE.radius.xl);
    r.style.setProperty('--r-2xl', ESSENCE.radius['2xl']);
}
