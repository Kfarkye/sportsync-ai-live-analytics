
// LLM Adapter - Unified interface for Gemini and GPT-5.2


// ============================================
// UNIFIED LLM INTERFACE
// ============================================
export interface LLMRequest {
    model: string;
    systemPrompt: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
    stream: boolean;
    reasoningLevel?: 'none' | 'low' | 'medium' | 'high' | 'xhigh';
    verbosity?: 'low' | 'medium' | 'high';
    jsonSchema?: object;
    enableGrounding?: boolean;
}

export interface LLMChunk {
    type: 'text' | 'thought' | 'grounding' | 'done' | 'error';
    content?: string;
    metadata?: any;
}

// ============================================
// GEMINI ADAPTER
// ============================================
export function toGeminiRequest(req: LLMRequest): object {
    const thinkingBudget = {
        'none': 0, 'low': 1024, 'medium': 4096, 'high': 16384, 'xhigh': 32768
    }[req.reasoningLevel || 'medium'];

    return {
        systemInstruction: { parts: [{ text: req.systemPrompt }] },
        contents: req.messages.map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
        })),
        generationConfig: {
            thinkingConfig: { thinkingBudget }, // Only works in v1alpha/beta
            ...(req.jsonSchema && {
                responseMimeType: "application/json",
                responseSchema: req.jsonSchema
            })
        },
        tools: req.enableGrounding ? [{ googleSearch: {} }] : undefined
    };
}

export function parseGeminiChunk(chunk: any): LLMChunk | null {
    try {
        if (chunk.candidates?.[0]?.content?.parts?.[0]?.text) {
            return { type: 'text', content: chunk.candidates[0].content.parts[0].text };
        }
        // Grounding Metadata
        if (chunk.candidates?.[0]?.groundingMetadata) {
            return { type: 'grounding', metadata: chunk.candidates[0].groundingMetadata };
        }
        // Thought trace (if supported by model version)
        // Note: Gemini streams thoughts differently depending on API version, keeping generic for now
    } catch (e) {
        // ignore parse errors
    }
    return null;
}


// ============================================
// GPT-5.2 ADAPTER
// ============================================
export function toGPT52Request(req: LLMRequest): object {
    return {
        model: req.model,
        stream: req.stream,
        input: [
            { role: "system", content: req.systemPrompt },
            ...req.messages.map(m => ({ role: m.role, content: m.content }))
        ],
        reasoning: { effort: req.reasoningLevel || "medium" },
        text: {
            verbosity: req.verbosity || "low",
            ...(req.jsonSchema && {
                format: {
                    type: "json_schema", // Structured Outputs
                    name: "betting_analysis", // Required by OpenAI
                    schema: req.jsonSchema,
                    strict: true
                }
            })
        },
        // GPT-5.2 web search tool definition
        tools: req.enableGrounding ? [
            {
                type: "function",
                function: {
                    name: "web_search",
                    description: "Search the web for live odds and news"
                }
            }
        ] : undefined
    };
}

export function parseGPT52Chunk(raw: string): LLMChunk | null {
    if (raw === '[DONE]') return { type: 'done' };

    try {
        const chunk = JSON.parse(raw);

        // Handle refusal
        if (chunk.output?.[0]?.content?.[0]?.type === 'refusal') {
            const refusal = chunk.output[0].content[0].refusal;
            return { type: 'error', content: refusal };
        }

        // Handle text delta
        const delta = chunk.output?.[0]?.content?.[0]?.text; // Responses API uses output[].content[].text for deltas too
        if (delta) return { type: 'text', content: delta };

        // Handle thought/reasoning
        // Note: OpenAI Responses API streams thoughts as content type "thought" or "reasoning_content"
        // Adjust based on specific API behavior observed
        const type = chunk.output?.[0]?.content?.[0]?.type;
        if (type === 'reasoning_content' || type === 'thought') {
            return { type: 'thought', content: chunk.output[0].content[0].text };
        }

    } catch (e) {
        // ignore
    }

    return null;
}
