
import { GoogleGenAI } from "@google/genai";

const API_KEY = process.env.VITE_GEMINI_API_KEY || "";
if (!API_KEY) {
    console.error("❌ ERROR: VITE_GEMINI_API_KEY is not set in the environment.");
    process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: API_KEY });

async function verifyOddsGrounding() {
    console.log("🚀 Testing High-Fidelity Odds Grounding (Juice & ML)...");

    // 1. Mock Data (PSG @ Lille case)
    const p = {
        home_team: "Paris Saint-Germain",
        away_team: "Lille",
        current_spread: -1.5,
        current_total: 2.5,
        current_odds: {
            home_ml: "-150",
            away_ml: "+130",
            spread_best: { home: { price: -125 } }, // HEAVY JUICE on PSG
            total_best: { over: { price: -115 } }
        }
    };

    const spread_juice = "-125";
    const total_juice = "-115";
    const home_ml = "-150";
    const away_ml = "+130";

    const systemInstruction = `You are a senior sports analyst. Output clean intel.
    
    === GROUND TRUTH ===
    Pick: ${p.home_team} ${p.current_spread} (Price: ${spread_juice})
    Moneyline: ${p.home_team} ${home_ml} | ${p.away_team} ${away_ml}
    Total: ${p.current_total} (Over Price: ${total_juice})
    
    === THINKING PROCESS ===
    Observe the JUICE (Price) to assess market conviction. If juice is heavy (e.g., -125 or -130), explain what that means for the betting liability.
    `;

    const prompt = `Perform a tactical audit of ${p.away_team} @ ${p.home_team}. Specifically mention the price (-125) and what it implies about sharp move.`;

    try {
        const response = await ai.models.generateContent({
            model: "gemini-3-pro-preview",
            contents: prompt,
            config: {
                systemInstruction,
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
        console.log("\n--- THOUGHT TRACE ---");
        if (candidate?.content?.parts) {
            for (const part of candidate.content.parts) {
                if ((part as any).thought) {
                    console.log(`[THOUGHT]: ${(part as any).text || (part as any).thought}`);
                }
            }
        }

        console.log("\n--- MODEL RESPONSE ---");
        console.log(response.text);

        if (response.text.includes("-125") || (candidate?.content as any)?.parts.some((p: any) => p.text?.includes("-125") || p.thought?.includes("-125"))) {
            console.log("\n✅ SUCCESS: Juice (-125) was correctly grounded in the analysis.");
        } else {
            console.warn("\n⚠️ WARNING: Juice was not explicitly mentioned. Check logs.");
        }

    } catch (error: any) {
        console.error("❌ API ERROR:", error.message);
    }
}

verifyOddsGrounding();
