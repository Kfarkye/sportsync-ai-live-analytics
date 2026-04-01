
import { GoogleGenAI } from "@google/genai";

const API_KEY = process.env.VITE_GEMINI_API_KEY || "";
if (!API_KEY) {
    console.error("❌ ERROR: VITE_GEMINI_API_KEY is not set in the environment.");
    process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: API_KEY });

async function verifyDeepThinking() {
    console.log("🚀 Testing Gemini 3.0 Pro Deep Thinking Configuration...");

    try {
        const response = await ai.models.generateContent({
            model: "gemini-3-pro-preview",
            contents: "Tell me a short joke about sports betting, but explain the internal reasoning behind why it's a good joke for a betting audience.",
            config: {
                generationConfig: {
                    temperature: 0.1,
                },
                thinkingConfig: {
                    includeThoughts: true,
                    thinkingLevel: "high"
                }
            } as any
        });

        const candidate = response.candidates?.[0];
        let thoughtFound = false;

        console.log("\n--- THOUGHT TRACE ---");
        if (candidate?.content?.parts) {
            for (const part of candidate.content.parts) {
                if ((part as any).thought) {
                    console.log(`[THOUGHT]: ${(part as any).text}`);
                    thoughtFound = true;
                }
            }
        }

        if (thoughtFound) {
            console.log("\n✅ SUCCESS: Deep Thinking engaged and captured.");
        } else {
            console.error("\n❌ FAILURE: No thought trace found. Checks candidate parts carefully.");
            console.log("Candidate Parts:", JSON.stringify(candidate?.content?.parts, null, 2));
        }

        console.log("\n--- MODEL RESPONSE ---");
        console.log(response.text);

    } catch (error: any) {
        console.error("❌ API ERROR:", error.message);
    }
}

verifyDeepThinking();
