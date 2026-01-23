// supabase/functions/debug-gemini-config/index.ts
import { executeAnalyticalQuery } from "../_shared/gemini.ts";

async function runDiagnostic() {
    console.log("🚀 Starting Gemini Deep Thinking Diagnostic...");

    const prompt = "Explain the Riemann Hypothesis in a way that includes a deep internal reasoning process about the mathematical implications.";

    try {
        const result = await executeAnalyticalQuery(prompt, {
            thinkingLevel: "high"
        });

        console.log("\n--- REASONING TRACE ---");
        if (result.thoughts) {
            console.log(result.thoughts);
            console.log("\n✅ SUCCESS: Internal thought trace captured.");
        } else {
            console.warn("\n⚠️ WARNING: No thought trace found. Check if 'includeThoughts: true' is supported for this model.");
        }

        console.log("\n--- FINAL OUTPUT ---");
        console.log(result.text);

    } catch (error: any) {
        console.error("\n❌ DIAGNOSTIC FAILED:", error.message);
    }
}

// Run if this is the main entry point (or just call it for the sake of diagnostic)
runDiagnostic();
