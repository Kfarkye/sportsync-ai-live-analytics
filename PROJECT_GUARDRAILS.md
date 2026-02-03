# Sharp Edge AI Product Guardrails

## 1. Product Fidelity & UI Integrity
* **MASTER COMPONENT**: The `LiveAnalysisCard.tsx` is the authoritative UI for live match intelligence. 
* **NO SIMPLIFIED FALLBACKS**: Digital "safety nets" or "simplified text modes" (like the old `LiveAIInsight`) are strictly forbidden. If the AI is offline, the UI must show a standardized "Syncing" or "Connection Error" state, NEVER synthetic mathematical baselines or filler text.
* **DATA-DENSE UI**: Always prioritize high-information density (PPM trackers, Odds Grids, Momentum) over plain text blocks.

## 2. Infrastructure Discipline
* **TYPED IMPORTS**: Never use `(window as any)` or global shortcuts for system services. All database and Edge Function calls must use the established typed clients (e.g., `import { supabase } from '../lib/supabase'`).
* **KINETIC RELIABILITY**: Before modifying any data engine (e.g., `gameStateEngine.ts`), run calculations to ensure PPM or clock adjustments aren't creating hallucinations.

## 3. AI Kernel Protocol
* **MODEL STRICTURE**: Use ONLY **Gemini 3** (`gemini-3-pro-preview`) for all analytical and textual processing. NO EXCEPTIONS.
* **MULTIMODAL EXCEPTION**: **Gemini 2.0** (or latest multimodal variant) is permitted ONLY for image/audio generation and vision tasks.
* **FORBIDDEN MODELS**: **Gemini 1.5** (Pro or Flash) is strictly forbidden for this project's core intelligence.
* **ROBUST PARSING**: All JSON parsing must happen in the Edge Function, and the frontend should receive a clean, structured object. If a 429 occurs, report the 429 to the user; do not mask it with fake data.

## 4. Friction-Free Observability
* **TRACE EVERYTHING**: Every AI request must log its start time, request payload summary, and end-to-end latency.
* **STRUCTURED ERRORS**: Never catch an error and return a generic string. Always log the full error object (message, stack, status) to the console before serving a safe fallback UI.
* **AUDIT TRAIL**: Logs must include exactly which API key/source was used and which model version responded.

## 5. Branding & Verbiage
* **STYLE**: Maintain the "Apple TV / DraftKings" aesthetic—high saturation, glassmorphism, and bold typography.
* **TERMINOLOGY**: Use sports-betting specific language ("Market Edge", "Pace Dislocation", "Fair Value") rather than clinical/legal language ("Forensic Audit", "Deterministic Baseline").

## 6. SSOT & Shared Code
* **Canonical SSOT** lives in `packages/shared/src`.
* **App code** must import from `@shared/*` (re-export shims in `src/` are not editable).
* **Supabase `_shared`** is generated via `npm run sync:shared` — never edit directly.
* Run `npm run verify:ssot` before merge to ensure sync + build + parity.
* Root shims (`types.ts`, `constants.ts`, `lib/essence.ts`) exist only for legacy imports.
