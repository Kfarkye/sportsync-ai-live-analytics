import { executeMultimodalQuery } from "../_shared/gemini.ts";

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-client-info, apikey",
    "Content-Type": "application/json",
};

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

    try {
        const { task, payload } = await req.json();

        if (task === 'audio_briefing') {
            const response = await executeMultimodalQuery(
                `Professional, sharp betting brief: ${payload.text}`,
                {
                    model: "gemini-3-flash-preview",
                    responseModalities: ["AUDIO"],
                    speechConfig: {
                        voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
                    },
                }
            );

            const base64Audio = (response as any).candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
            return new Response(JSON.stringify({ audio: base64Audio }), { headers: CORS_HEADERS });
        }

        if (task === 'scouting_map') {
            const response = await executeMultimodalQuery(
                `A tactical sports scouting diagram for ${payload.away} vs ${payload.home}. Blueprint aesthetic, dark mode, neon accents, cinematic depth.`,
                {
                    model: 'gemini-3-flash-preview',
                    imageConfig: { aspectRatio: "16:9" }
                }
            );

            const part = (response as any).candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
            return new Response(JSON.stringify({ image: part?.inlineData?.data }), { headers: CORS_HEADERS });
        }

        return new Response(JSON.stringify({ error: "Unknown task" }), { status: 400, headers: CORS_HEADERS });

    } catch (error: any) {
        console.error("[Multimodal-Edge] Error:", error);
        // Fail gracefully for images - return 200 with null image to prevent frontend 500
        return new Response(JSON.stringify({ error: error.message, image: null }), { status: 200, headers: CORS_HEADERS });
    }
});
