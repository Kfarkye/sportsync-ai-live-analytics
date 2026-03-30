/**
 * SportsSync Design Tokens (Consumer Warm-Light SSOT)
 * ---------------------------------------------------------------------------
 * Scope:
 * - SportsSync consumer-facing surfaces (`sportsync-evidence.web.app`)
 * - Shared color/typography/radius semantics for shell + static public pages
 *
 * Non-scope:
 * - TheDrip product family may keep a separate token contract.
 */

export const SPORTSSYNC_TOKENS = {
  color: {
    bg: '#FAFAF8',
    surface: '#FFFFFF',
    border: '#E8E7E3',
    textPrimary: '#1A1A18',
    textSecondary: '#6B6B63',
    textTertiary: '#9B9B91',
    accent: '#C85A3A',
    positive: '#2D8F5C',
    negative: '#C85A3A',
  },
  font: {
    title: "'Source Serif 4', Georgia, 'Times New Roman', serif",
    body: "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  },
  radius: {
    card: '8px',
    control: '6px',
  },
} as const;

/**
 * Runtime application helper:
 * applies canonical SportsSync tokens to :root CSS variables.
 */
export function applySportsSyncTokensToRoot(): void {
  const r = document.documentElement;
  const { color, font, radius } = SPORTSSYNC_TOKENS;

  r.style.setProperty('--ss-bg', color.bg);
  r.style.setProperty('--ss-surface', color.surface);
  r.style.setProperty('--ss-border', color.border);
  r.style.setProperty('--ss-text-primary', color.textPrimary);
  r.style.setProperty('--ss-text-secondary', color.textSecondary);
  r.style.setProperty('--ss-text-tertiary', color.textTertiary);
  r.style.setProperty('--ss-accent', color.accent);
  r.style.setProperty('--ss-positive', color.positive);
  r.style.setProperty('--ss-negative', color.negative);
  r.style.setProperty('--ss-font-title', font.title);
  r.style.setProperty('--ss-font-body', font.body);
  r.style.setProperty('--ss-font-mono', font.mono);
  r.style.setProperty('--ss-radius-card', radius.card);
  r.style.setProperty('--ss-radius-control', radius.control);

  // Backward-compat semantic aliases
  r.style.setProperty('--bg', color.bg);
  r.style.setProperty('--surface', color.surface);
  r.style.setProperty('--border', color.border);
  r.style.setProperty('--text', color.textPrimary);
  r.style.setProperty('--text2', color.textSecondary);
  r.style.setProperty('--text3', color.textTertiary);
  r.style.setProperty('--accent', color.accent);
  r.style.setProperty('--win', color.positive);
  r.style.setProperty('--loss', color.negative);
}

