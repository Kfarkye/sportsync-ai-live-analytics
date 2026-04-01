# Premium UI Master Prompt (Category-Agnostic, Restrained)

Use this prompt when the task requires a premium, category-neutral interface that should not inherit sports, finance, SaaS, crypto, or agency visual cliches.

## Master Prompt

You are designing a premium consumer-facing interface.

Goal:
Create a page that feels human-directed, restrained, and brand-specific rather than AI-generated.

Core design principles:
- Premium through spacing, typography, and hierarchy, not decorative effects
- Clear 5-second readability
- Minimal surface noise
- Strong visual discipline
- Every element must earn its place

Visual system:
- Monochrome or near-monochrome base with 1 restrained accent color
- Maximum 3 type voices total:
  - Sans for interface, body, and navigation
  - Serif for one editorial or high-emphasis heading role only
  - Mono for controls, labels, pills, or compact metadata only
- No gradients unless explicitly justified by the brand
- No more than 1 visual trick per screen
- Avoid generic startup or AI-generated styling patterns

Glass material guidance:
- Allow subtle glass on a maximum of 2 component types
- Glass is a supporting material, not the main identity
- Use low-opacity translucent fills
- Use light background blur only
- Use a very thin border or hairline edge
- Keep shadowing restrained
- Preserve high text contrast at all times
- Do not use oversized glow, frosted neon, or layered rainbow effects
- Good glass use cases:
  - segmented controls
  - floating utility bars
  - modal shells
  - filter trays
- Bad glass use cases:
  - entire page sections
  - long reading surfaces
  - every card on the page
  - primary content blocks

Hierarchy:
- Define 1 clear focal path above the fold
- The eye should know exactly where to start and where to go next
- Only 1 dominant visual moment per screen
- Supporting text should be brief and role-specific
- Remove any element that competes with the main action

Spacing system:
- Use a strict spacing scale only: 8, 16, 24, 40, 64
- Outer padding must be consistent by breakpoint
- Use identical gaps for repeated elements
- Create visual calm through whitespace, not filler components
- Do not allow adjacent sections to invent inconsistent spacing

Component behavior:
- Inputs should feel architectural and restrained
- Prefer divider-based or minimally framed inputs over heavy SaaS-style boxes
- Buttons should feel custom and intentional, not default library buttons
- One primary CTA should carry the strongest contrast on the page
- Interactive elements should feel unified in border radius, padding, and label style

Copy behavior:
- Use sparse, specific language
- No filler marketing copy
- No generic "streamline / optimize / unlock" language
- Labels and helper text should be functional, not decorative

Negative constraints:
- Do not use generic AI landing page aesthetics
- Do not use gradient blobs
- Do not use glass everywhere
- Do not use oversized border radii on every component
- Do not use multiple accent colors
- Do not use decorative icon clutter
- Do not use feature-card overload
- Do not use overexplained headings or subheadings
- Do not rely on trend-chasing dribbble aesthetics

Execution process:
Pass 1: establish layout, hierarchy, and focal path
Pass 2: assign typography roles
Pass 3: apply spacing discipline and alignment cleanup
Pass 4: add restrained material treatment, including subtle glass if justified
Pass 5: remove anything non-essential

Self-audit before final output:
- Is there only 1 accent color?
- Are typography roles clearly assigned and limited?
- Is the focal path obvious in 5 seconds?
- Is glass used sparingly and functionally?
- Would the design still feel premium in grayscale?
- Is any element present only because it looks trendy?
If any answer fails, revise before returning the final result.

Return:
- Production-ready implementation
- Clean component structure
- No placeholder flourish that weakens clarity

## Compact Master Line

Build a category-agnostic premium interface with a monochrome base, one restrained accent, strict spacing cadence, role-based typography, and optional subtle glass on no more than two utility surfaces. The result should feel human-directed, quiet, and brand-specific rather than trend-driven or AI-generated.
