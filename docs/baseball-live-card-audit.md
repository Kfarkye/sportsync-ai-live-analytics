# BaseballLiveCard Component — Pre-Implementation Audit

## 1. CRITICAL: TypeScript violation — file is plain JSX, not TSX

The entire codebase is TypeScript (`.tsx` files, `tsconfig.json`, TypeScript ESLint). This component uses JSDoc typedefs instead of actual TypeScript interfaces. All other components in `src/components/` are `.tsx` files with proper type annotations. This needs to be written as a `.tsx` file with real types.

## 2. CRITICAL: Ignores the project's design system entirely

The project has a mature design system (`ESSENCE` in `src/lib/essence.ts`) with established tokens for colors, typography tiers, card geometry, borders, shadows, and motion. This component defines its own parallel token system (`T`, `FONT`, `S`) that conflicts:

| Concern | Project (ESSENCE) | This component |
|---|---|---|
| Background | `#09090b` | `#0A0A0A` |
| Card surface | `#0A0A0B` | `#111111` |
| Border | `rgba(255,255,255,0.06)` | `rgba(255,255,255,0.06)` (same) |
| Text primary | `#FAFAFA` | `#FFFFFF` |
| Accent green | `#34D399` | `#22C55E` |
| Accent amber | `#FBBF24` | `#F59E0B` |
| Font sans | `Inter, system-ui...` | `-apple-system, BlinkMac...` |
| Font mono | `JetBrains Mono, SF Mono` | `SF Mono, JetBrains Mono` (reversed) |

**Decision needed:** Rewrite to use `ESSENCE` tokens and Tailwind classes (like every other component), or accept a second parallel design language?

## 3. CRITICAL: Ignores Tailwind CSS — uses 100% inline styles

Every other component in the codebase uses Tailwind CSS (via `cn()` utility + `tailwind.config.js`). This component uses zero Tailwind classes and ~500 lines of inline `style={{}}` objects. This creates:
- No dark mode/responsive breakpoint support
- No Tailwind class deduplication via `tailwind-merge` (already a dependency)
- Inconsistent DX for anyone maintaining it alongside the rest of the codebase

## 4. CRITICAL: Duplicates existing shared components

The codebase already has these reusable primitives that this component re-implements from scratch:
- `StatusChip` (`src/components/ui/StatusChip.tsx`) — this component builds its own `StatusBadge`
- `EmptyState` (`src/components/ui/EmptyState.tsx`) — this component builds its own `EmptyState`
- `Card` (`src/components/ui/Card.tsx`) — this component builds its own `S.sectionCard`
- `SectionHeader` / `SectionTitle` — this component inlines its own section headers

## 5. CRITICAL: Hardcoded mock data with team-specific values baked into UI

The component hardcodes:
- `"LAD"` / `"LAA"` abbreviations directly in the scoreboard JSX (not from data)
- `T.dodgerBlue` / `T.angelRed` colors in the scoreboard (should come from `game.away.color` / `game.home.color`)
- `"Spring Training"` context label hardcoded
- `"Sat, Feb 21 - 12:10 PM"` hardcoded in the ODDS tab
- `"LAD -130"` and `"O/U 9.5"` hardcoded in the context bar
- `"Angels"` hardcoded in DueUp call

This makes the component non-reusable for any other matchup without rewriting the render.

## 6. SIGNIFICANT: No data fetching architecture

The project uses `@tanstack/react-query` for data fetching. This component uses a raw `setTimeout` to simulate data loading with no:
- React Query integration
- Real API endpoint
- Polling/WebSocket strategy for live data
- Cache invalidation strategy

**Decision needed:** What API/data source will feed this? How does it integrate with the existing `@tanstack/react-query` setup?

## 7. SIGNIFICANT: No Framer Motion — breaks animation patterns

The codebase uses `framer-motion` for all animations. The `Card` component wraps `motion.div`. This component uses:
- Raw CSS `transition` properties
- SVG `<animate>` elements
- Manual pulse via `setInterval` + state toggle

This should use Framer Motion for consistency and for features like `AnimatePresence` for tab transitions.

## 8. SIGNIFICANT: No integration with existing type system

The project has rich shared types in `src/types/index.ts`:
- `Match`, `MatchStatus`, `Situation` (with `balls`, `strikes`, `outs`, `onFirst`, `onSecond`, `onThird`)
- `MatchOdds`, `WeatherInfo`, `MatchEvent`, `MatchContext`
- `Sport.BASEBALL` enum value

The component defines its own parallel `GamePayload` type (via JSDoc) that doesn't align with these existing contracts. It should consume the shared `Match` interface.

## 9. MODERATE: Unused props and dead parameters

- `StrikeZone` accepts `isLast` prop but never uses it
- `BSO` component's inner `Row` has `ariaLabel` which shadows the outer aria-label
- `useMemo` and `useCallback` are imported but never used
- `Diamond` component's `pts.home` is rendered but home plate runner state is never tracked

## 10. MODERATE: Accessibility gaps

- The `shimmer` animation is injected via a `<style>` tag inside the component render — this gets duplicated on every render path (loading, error, ready states all inject it)
- No `prefers-reduced-motion` media query for any animations
- The back button (`"Go back"`) has no `onClick` handler — it's a dead button
- Tab panel has `role="tabpanel"` but no `aria-labelledby` connecting it to the active tab
- SVG strike zone has colored dots with no text alternative distinguishing pitch types for colorblind users

## 11. MODERATE: Inning ordinal suffix logic is incomplete

```js
game.inning === 1 ? "ST" : game.inning === 2 ? "ND" : game.inning === 3 ? "RD" : "TH"
```

This is duplicated in 3 places. It also fails for 11th ("11ST"), 12th ("12ND"), 13th ("13RD"), 21st ("21ST") etc. — standard ordinal rules require checking the tens digit.

## 12. MINOR: `var` declarations instead of `const`/`let`

The component uses `var` extensively (`var MOCK = ...`, `var shimmerKeyframes = ...`, inside `Diamond`, `StrikeZone`, etc.), which is non-standard for modern React/ES6+ codebases and inconsistent with the rest of the project.

## 13. MINOR: Emoji literals in source code

The `EdgePanel` and ODDS tab use emoji characters directly. These may render inconsistently across platforms. The codebase uses `lucide-react` (already a dependency) for icons.

---

## Decisions Needed Before Implementation

1. **Rewrite to TypeScript + Tailwind?** (Required to match codebase conventions)
2. **Adopt ESSENCE design tokens?** (Or maintain a separate visual language for baseball cards?)
3. **Use existing shared components** (`StatusChip`, `EmptyState`, `Card`) or keep standalone?
4. **What data source / API?** How does this connect to the existing `Match` type and React Query layer?
5. **How does this integrate with routing?** Is this a standalone page, a modal, or embedded in the existing `MatchDetails` / `GameDetail` flow?
6. **Team colors and identity** — should come from data, not hardcoded. What's the plan for the team color/logo system?
