# Obsidian Weissach: Anti-Vibe-Coding UI Standards

Based on the principles of "de-vibe-coding", all UI generation and modification in the SportSync application must adhere to the following strict Art Direction protocols to avoid the "AI Starter Pack" aesthetic.

## 1. Negative Prompting & Banned Elements
- **BANNED COLORS:** NO electric purple, generic cyan, or default Tailwind blues. NEVER use standard soft-smudged gradients.
- **BANNED SHAPES:** NO generic 8px or 16px border radii (e.g., standard `rounded-lg`). Use either absolute brutalist `rounded-none` (0px) OR extreme pill-shaped `rounded-full` (9999px) where appropriate, or our strict custom radii defined in `tailwind.config.ts`.
- **BANNED ICONS:** NO emojis (✨🚀🔥) in UI text, tooltips, or code comments. 
- **BANNED COPY:** No enthusiastic AI marketing speak ("Unleash your potential", "Dive in"). Copy must be brutal, data-driven, and journalistic.

## 2. Typography & Iconography 
- **FONTS:** NO `Inter`, `Roboto`, or default system sans-serif. We use `Playfair Display` or `Outfit` for display/headers, and `Space Grotesk` or `DM Sans` for data/body.
- **ICONS:** Avoid default Lucide where a bespoke alternative (Phosphor, Radix) can provide a sharper, thinner, more technical look.

## 3. Structural & Visual Anchoring
- **LAYOUT:** Do not invent arbitrary paddings. Rely strongly on CSS Grid with 1px precise borders (e.g., `border-b-[1px] border-white/5`).
- **EMPTY STATES:** Never use the text "No data found." Empty states must provide contextual intelligence (e.g., "Market lines locked. Awaiting tip-off.").

## 4. Human Polish & Micro-interactions
- **TACTILE FEEL:** Every interactive element must have a deliberate hover state and transition, but keep it highly subtle (e.g., `transition-all duration-300 hover:border-white/20`). Use Framer Motion for structural layout shifts, not just opacity fades.
- **GLASSMORPHISM:** When using glass effects, use extreme values (e.g., our Liquid Glass 2.0 standard: 24px blur, 180% saturation) with a hard 1px inner stroke, rather than default `backdrop-blur-md`.

## 5. Implementation Workflow
- We do not rely on "make it beautiful" generic prompts.
- We build the brutalist, functional wireframe first.
- We iteratively apply exact padding (`px-6 py-4`), typography scales (`text-[11px] uppercase tracking-[0.15em]`), and specific color tokens (`bg-[#0A0A0A]`).
