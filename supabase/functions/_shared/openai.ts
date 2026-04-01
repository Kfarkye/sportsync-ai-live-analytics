// OpenAI GPT-5.2 API Wrapper
declare const Deno: any;

import { LLMRequest, parseGPT52Chunk, toGPT52Request, LLMChunk } from './llm-adapter.ts';

const OPENAI_API_URL = "https://api.openai.com/v1/responses";

export async function* executeGPT52StreamingQuery(
    req: LLMRequest
): AsyncGenerator<{ type: 'text' | 'thought' | 'done' | 'error' | 'grounding'; content?: string; metadata?: any }> {


    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) throw new Error("OPENAI_API_KEY not set");

    const payload = toGPT52Request(req);

    const response = await fetch(OPENAI_API_URL, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenAI API Error ${response.status}: ${errText}`);
    }

    if (!response.body) throw new Error("No response body from OpenAI");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n').filter(l => l.trim() !== '');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6); // remove 'data: ' prefix
                    const parsed = parseGPT52Chunk(data);

                    if (parsed) {
                        if (parsed.type === 'done') return;
                        // yield the chunk
                        yield parsed;
                    }
                }
            }
        }
    } finally {
        reader.releaseLock();
    }
}
