# ESSENCE v11.0 — Token Consolidation Migration Guide

## What Changed

### Files Modified
- **`src/lib/essence.ts`** — Consolidated from v10 → v11. Now the sole design token authority.
- **`packages/shared/src/lib/essence.ts`** — Synced copy.

### Files to Delete (Dead Code)
```bash
# These have ZERO imports anywhere in the codebase
rm src/styles/design-tokens.ts    # 0 imports — all useful values absorbed into ESSENCE
rm src/ui/density.ts              # 0 imports — all useful values absorbed into ESSENCE.tw.*
```

### Bugs Fixed
These properties were accessed in components but **never existed** in the original ESSENCE, causing silent `undefined` runtime errors:

| Property | Used In | Fix |
|---|---|---|
| `ESSENCE.colors.accent.mintEdge` | `Card.tsx` | Added — `rgba(54, 232, 150, 0.08)` |
| `ESSENCE.colors.accent.mint` | `ChatWidget.tsx` | Added — alias of `emerald` |
| `ESSENCE.colors.accent.mintDim` | `ChatWidget.tsx` | Added — alias of `emeraldMuted` |
| `ESSENCE.colors.accent.gold` | `ChatWidget.tsx` | Added — alias of `amber` |
| `ESSENCE.colors.accent.goldDim` | `ChatWidget.tsx` | Added — alias of `amberMuted` |
| `ESSENCE.shadows.obsidian` | `ChatWidget.tsx`, `GameCard.tsx`, `MatchCard.tsx` | Added — deep card shadow |

### New Sections Added
| Section | Purpose | Absorbed From |
|---|---|---|
| `ESSENCE.scale.*` | Named type scale (12 sizes) | Rationalized from 25 arbitrary `text-[Npx]` values |
| `ESSENCE.tracking.*` | Named letter-spacing (7 values) | Rationalized from 18 arbitrary `tracking-[Nem]` values |
| `ESSENCE.spacing.*` | 4px-grid spacing primitives | `design-tokens.ts` → `SPACING` |
| `ESSENCE.colors.overlay.*` | Background overlay opacities (4 tiers) | Rationalized from 10 arbitrary `bg-white/[N]` values |
| `ESSENCE.tw.*` | Pre-composed Tailwind utility classes | `design-tokens.ts` → `TW` + `density.ts` → `DENSE` |
| Type exports | `EssenceSurface`, `EssenceScale`, etc. | New |

---

## Adoption Guide

### Surface Colors
```diff
- bg-[#111113]          →  bg-[${ESSENCE.colors.surface.elevated}]
- bg-[#0C0C0E]          →  ESSENCE.card.bg  (or bg-[#0A0A0B])
- bg-[#1A1A1A]          →  bg-[${ESSENCE.colors.surface.subtle}]
- bg-[#080808]           →  bg-[${ESSENCE.colors.surface.base}]
```

### Font Sizes
```diff
- text-[10px]           →  ESSENCE.scale.caption
- text-[9px]            →  ESSENCE.scale.label
- text-[11px]           →  ESSENCE.scale.footnote
- text-[13px]           →  ESSENCE.scale.bodySm
- text-[15px]           →  ESSENCE.scale.bodyLg
```

### Borders
```diff
- border-white/[0.03]   →  ESSENCE.tw.border.ghost
- border-white/[0.04]   →  ESSENCE.tw.border.subtle
- border-white/[0.05]   →  ESSENCE.tw.border.subtle   (collapsed)
- border-white/[0.06]   →  ESSENCE.tw.border.default
- border-white/[0.08]   →  ESSENCE.tw.border.default   (collapsed)
- border-white/[0.10]   →  ESSENCE.tw.border.strong
- border-white/[0.12]   →  ESSENCE.tw.border.strong
```

### Background Overlays
```diff
- bg-white/[0.01]       →  ESSENCE.tw.surface.ghost
- bg-white/[0.02]       →  ESSENCE.tw.surface.subtle
- bg-white/[0.03]       →  ESSENCE.tw.surface.subtle   (collapsed)
- bg-white/[0.04]       →  ESSENCE.tw.surface.muted
- bg-white/[0.06]       →  ESSENCE.tw.surface.emphasis
- bg-white/[0.08]       →  ESSENCE.tw.surface.emphasis  (collapsed)
```

### Section Headers
```diff
- text-[11px] font-bold text-zinc-500 uppercase tracking-[0.2em]
+ ESSENCE.tw.sectionLabel

- text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em]
+ ESSENCE.tw.cardHeaderLabel
```

---

## Enforcement Rules

1. **No raw hex in `.tsx` files** — Use `ESSENCE.colors.surface.*` or `ESSENCE.card.bg`
2. **No arbitrary `text-[Npx]`** — Use `ESSENCE.scale.*` or `ESSENCE.tier.*`
3. **No arbitrary `border-white/[N]`** — Use `ESSENCE.tw.border.*`
4. **No arbitrary `bg-white/[N]`** — Use `ESSENCE.tw.surface.*`
5. **New value needed?** Add it to `ESSENCE` first, then use it.

These can be enforced via ESLint `no-restricted-syntax` rules in a follow-up PR.
