/* ============================================================================
   api/extract-slip.js
   "Obsidian Vision" — Production Bet Slip OCR Endpoint

   Architecture: Vite + Vercel Serverless (Web API Standard)
   Engine: Gemini 3.1 Pro Preview (Vision)

   CRITICAL FIXES:
   ├─ maxDuration=60: Vision takes 8-15s, default Vercel timeout is 10s
   ├─ Server-side UUID injection: LLMs hallucinate fake UUIDs
   ├─ z.coerce in schema: AI returns "-110" as string, not number
   └─ Structured error response: Never white-screen on parse failure
============================================================================ */

import { google } from "@ai-sdk/google";
import { generateObject } from "ai";
import { AIParsedSlipSchema } from "../lib/schemas/betSlipSchema.js";

// 🛑 CRITICAL: Gemini Vision extraction takes 8-15 seconds.
// Default Vercel timeout is 10s. This prevents 504 Gateway errors.
export const maxDuration = 60;

// ═══════════════════════════════════════════════════════════════════════════
// SYSTEM PROMPT — BET SLIP PARSE MODE
// ═══════════════════════════════════════════════════════════════════════════

const SLIP_SYSTEM_PROMPT = `
You are a strict JSON extraction bot for sports betting slips.

TASK: Parse the attached bet slip screenshot and extract each leg.

RULES:
1. Extract EVERY leg visible in the image.
2. For the 'sportsbook' field, identify the app from its UI chrome/branding.
   If unsure, return "Unknown".
3. For 'odds', always return American format (e.g., -110, +150).
   If the image shows decimal odds, convert to American.
4. For 'confidence_score': Rate 90-100 if text is crystal clear.
   Rate 70-89 if slightly blurry but readable. Rate below 70 if guessing.
5. Set 'needs_review' to true if:
   - The image is blurry, cropped, or partially obscured
   - Dark mode UI makes odds hard to distinguish
   - You are uncertain about any value
6. For player props, include the player name in 'entity_name' and the
   stat market (e.g., "Points", "Rebounds") in the market_type as 'player_prop'.
7. If total_stake or total_payout are not visible, return null.
8. NEVER guess at values you cannot see. Mark them for review instead.
`.trim();

// ═══════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════════════════

export async function POST(req) {
    try {
        const body = await req.json();
        const { imageBase64, mimeType } = body;

        if (!imageBase64 || !mimeType) {
            return new Response(
                JSON.stringify({ success: false, error: "Missing imageBase64 or mimeType" }),
                { status: 400, headers: { "Content-Type": "application/json" } }
            );
        }

        // Validate mime type
        const allowedMimes = ["image/png", "image/jpeg", "image/webp", "image/heic"];
        if (!allowedMimes.includes(mimeType)) {
            return new Response(
                JSON.stringify({ success: false, error: `Unsupported image type: ${mimeType}` }),
                { status: 400, headers: { "Content-Type": "application/json" } }
            );
        }

        // Payload size guard (Base64 of a 5MB image ≈ 6.7MB string)
        if (imageBase64.length > 10 * 1024 * 1024) {
            return new Response(
                JSON.stringify({ success: false, error: "Image too large (max 10MB)" }),
                { status: 413, headers: { "Content-Type": "application/json" } }
            );
        }

        const { object: parsedSlip } = await generateObject({
            model: google("gemini-3.1-pro-preview"),
            schema: AIParsedSlipSchema,
            temperature: 0.1, // Keep extraction strictly deterministic
            system: SLIP_SYSTEM_PROMPT,
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: "Extract all bet details from this screenshot." },
                        { type: "image", image: `data:${mimeType};base64,${imageBase64}` }
                    ]
                }
            ],
            abortSignal: AbortSignal.timeout(45000) // 45s hard cap
        });

        // 🛡️ Inject reliable UUIDs server-side (LLMs hallucinate sequential/fake UUIDs)
        const appReadySlip = {
            id: crypto.randomUUID(),
            ...parsedSlip,
            legs: parsedSlip.legs.map(leg => ({
                ...leg,
                id: crypto.randomUUID(),
                live_status: "pending"
            })),
            parsed_at: new Date().toISOString(),
            verified: false
        };

        // Log extraction quality for observability
        const lowConfLegs = appReadySlip.legs.filter(l => l.confidence_score < 85);
        if (lowConfLegs.length > 0) {
            console.warn(
                `[Slip OCR] ${lowConfLegs.length}/${appReadySlip.legs.length} legs below 85% confidence`,
                lowConfLegs.map(l => ({ entity: l.entity_name, conf: l.confidence_score }))
            );
        }

        return new Response(
            JSON.stringify({ success: true, data: appReadySlip }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );

    } catch (error) {
        const message = error?.message || "Unknown extraction error";
        const isTimeout = error?.name === "AbortError" || error?.name === "TimeoutError";

        console.error("[Slip OCR] Extraction failed:", message);

        return new Response(
            JSON.stringify({
                success: false,
                error: isTimeout
                    ? "Extraction timed out. Try a clearer or smaller image."
                    : "Failed to parse bet slip. Please try again.",
                debug: process.env.NODE_ENV === "development" ? message : undefined
            }),
            {
                status: isTimeout ? 504 : 500,
                headers: { "Content-Type": "application/json" }
            }
        );
    }
}
