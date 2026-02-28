// _shared/gemini.ts
// SOTA Gemini Implementation: Soft-Schema Strategy
// Fixes: NULL Fields, Tool Conflicts, and Search Compliance.
// Verified against @google/genai v1.0+ (Jan 2026 Standards)

declare const Deno: any;

import { GoogleGenAI, Type } from "npm:@google/genai";

// 1. SAFETY: Relax settings so reasoning/search isn't blocked by internal "bad" simulation
const SAFETY_SETTINGS_REASONING = [
    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" }
];

/**
 * executeAnalyticalQuery
 * - Features: Deep Thinking, Python Code Execution, Google Search Grounding
 * - Fix: Implements "Soft-Schema" to allow Search + Thinking + JSON simultaneously
 */
export async function executeAnalyticalQuery(prompt: string | any[], options: any = {}) {
    try {
        const apiKey = Deno.env.get("GEMINI_API_KEY");
        if (!apiKey) throw new Error("Missing GEMINI_API_KEY");

        const ai = new GoogleGenAI({ apiKey });
        const modelName = options.model || 'gemini-3-flash-preview';

        // 2. CONFLICT RESOLUTION: "Soft-Schema" Injection
        // We DO NOT pass options.responseSchema to the API config if we want Deep Thinking/Tools.
        // Instead, we inject it into the system prompt.
        let systemInstruction = options.systemInstruction || "";
        let responseMimeType = "text/plain";

        // Always keep tools enabled (The model needs them to find the data!)
        const tools: any[] = [
            {
                googleSearch: {
                    dynamicRetrievalConfig: {
                        mode: "MODE_DYNAMIC",
                    dynamicThreshold: 0.0 // Force grounding whenever possible
                    }
                }
            },
            { codeExecution: {} }
        ];

        // If user requested structured output:
        if (options.responseSchema) {
            console.log("[Gemini:Config] Converting Strict Schema to Prompt Instruction (Soft Schema).");
            const schemaStr = JSON.stringify(options.responseSchema, null, 2);
            // Inject Schema Instruction - show expected fields, not the schema structure
            const expectedFields = Object.keys(options.responseSchema.properties || {}).join(", ");

            systemInstruction += `\n\n[CRITICAL OUTPUT RULE]
After your research and reasoning, you MUST output the final answer as a VALID JSON object.

Required fields: ${expectedFields}

Example output format:
\`\`\`json
{
  "recommended_pick": "Team Name Spread",
  "headline": "Short Impactful Headline",
  "briefing": "Detailed analysis paragraph...",
  "cards": [{"category": "The Spot", "thesis": "...", "market_implication": "...", "impact": "HIGH", "details": ["..."]}],
  "grading_metadata": {"side": "HOME|AWAY|OVER|UNDER", "type": "SPREAD|TOTAL|MONEYLINE", "selection": "Team Name"},
  "logic_group": "SCHEDULE_SPOT|MARKET_DISLOCATION|KEY_INJURY|MODEL_EDGE|SITUATIONAL",
  "confidence_tier": "HIGH|MEDIUM|LOW",
  "pick_summary": "One sentence summary of the pick..."
}
\`\`\`

Enclose your JSON in \`\`\`json ... \`\`\` blocks. Output ONLY the JSON object after your analysis.`;

            // We set text/plain to ensure the API doesn't disable Tools/Thoughts.
            responseMimeType = "text/plain";
        }

        if (options.fileStoreId) {
            tools.push({ fileSearch: { fileSearchStoreNames: [options.fileStoreId] } });
        }

        const contents = [{
            role: 'user',
            parts: Array.isArray(prompt) ? prompt : [{ text: String(prompt || " ") }]
        }];

        const response = await ai.models.generateContent({
            model: modelName,
            contents,
            config: {
                systemInstruction,
                tools, // Tools are NOW ENABLED even for JSON tasks

                temperature: options.temperature ?? 0.1,
                maxOutputTokens: options.maxOutputTokens ?? 65536, // Allow caller override for latency control

                responseMimeType,
                // responseSchema: undefined, // Explicitly OMITTED to allow Thinking

                safetySettings: options.safetySettings || SAFETY_SETTINGS_REASONING,

                thinkingConfig: {
                    includeThoughts: true,
                    thinkingLevel: options.thinkingLevel || "high"
                }
            },
        });

        // 3. ROBUST EXTRACTION (Separating Thoughts from Data)
        const candidate = response.candidates?.[0];
        const contentParts = candidate?.content?.parts || [];
        const metadata = candidate?.groundingMetadata;

        let rawText = "";
        let thoughts = "";
        let executedCode = "";
        let images: any[] = [];

        for (const part of contentParts) {
            const p = part as any;

            if (p.thought) {
                thoughts += (typeof p.thought === 'string' ? p.thought : p.text) + "\n";
            }
            else if (p.executableCode) {
                executedCode += `\n[Generated Code (${p.executableCode.language})]:\n${p.executableCode.code}\n`;
            }
            else if (p.codeExecutionResult) {
                executedCode += `\n[Output]:\n${p.codeExecutionResult.output}\n`;
            }
            else if (p.inlineData && p.inlineData.mimeType.startsWith('image/')) {
                images.push({ mimeType: p.inlineData.mimeType, data: p.inlineData.data });
            }
            else if (p.text) {
                // Accumulate the final text answer
                rawText += p.text;
            }
        }

        // Fallback for empty text (sometimes happens with deep thought)
        if (!rawText && response.text) rawText = response.text;

        // 4. COMPLIANCE & CITATIONS
        // If Schema is active, we do NOT want citations injected into the JSON string.
        // If no Schema, we apply citations for readability.
        const groundedText = options.responseSchema ? rawText : applyGroundingCitations(rawText, metadata);

        // MANDATORY: You must display this in your UI if present (Google Footer)
        const searchEntryPoint = metadata?.searchEntryPoint?.renderedContent || "";

        const searchQueries = metadata?.webSearchQueries || [];
        const sources = metadata?.groundingChunks?.map((c: any, index: number) => ({
            index: index + 1,
            title: c.web?.title || "Source",
            uri: c.web?.uri
        })) || [];

        // Log grounding summary (useful for monitoring, not verbose)
        if (sources.length > 0) {
            console.log(`[Gemini:Grounding] ${sources.length} sources from ${searchQueries.length} queries`);
        }


        return {
            text: groundedText,
            rawText, // Pass this to safeJsonParse() in your app logic
            thoughts,
            executedCode,
            images,
            searchEntryPoint,
            sources,
            searchQueries,
            responseParts: contentParts,
            usage: response.usageMetadata,
            rawResponse: response
        };

    } catch (error: any) {
        console.error(`[Kernel-Fault] Pipeline Error:`, error.message);
        throw error;
    }
}

/**
 * safeJsonParse - "JSON Sniper"
 * Robustly extracts JSON even if surrounded by thoughts or markdown.
 */
export function safeJsonParse(text: string): any {
    if (!text) return null;
    try {
        // 1. Try "Sniper" extraction for markdown blocks
        const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (jsonMatch && jsonMatch[1]) {
            return JSON.parse(jsonMatch[1].trim());
        }

        // 2. Try Brute Force (Find outermost braces)
        // Gemini 3 sometimes writes: "Here is the JSON: { ... }"
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start !== -1 && end !== -1 && end > start) {
            return JSON.parse(text.substring(start, end + 1));
        }

        // 3. Try Direct Parse
        return JSON.parse(text);
    } catch (e) {
        console.warn(`[SafeJson] Failed to parse JSON. Input length: ${text.length}`);
    }
    return null;
}

function applyGroundingCitations(text: string, metadata: any): string {
    if (!metadata?.groundingSupports || !metadata?.groundingChunks) return text;
    const supports = metadata.groundingSupports;
    const chunks = metadata.groundingChunks;
    let groundedText = text;

    // Sort descending to prevent index shifting
    const sortedSupports = [...supports].sort((a: any, b: any) => (b.segment?.endIndex || 0) - (a.segment?.endIndex || 0));

    for (const support of sortedSupports) {
        const endIndex = support.segment?.endIndex;
        if (endIndex === undefined || !support.groundingChunkIndices?.length) continue;
        const citationLinks = support.groundingChunkIndices
            .map((idx: number) => {
                const chunk = chunks[idx];
                return chunk?.web?.uri ? `[${idx + 1}](${chunk.web.uri})` : null;
            })
            .filter(Boolean);
        if (citationLinks.length > 0) {
            // Insert [1](url), [2](url)
            const citationString = citationLinks.join(", ");
            groundedText = groundedText.slice(0, endIndex) + " " + citationString + groundedText.slice(endIndex);
        }
    }
    return groundedText;
}

export async function* executeStreamingAnalyticalQuery(prompt: string | any[], options: any = {}) {
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) throw new Error("Missing GEMINI_API_KEY");
    const ai = new GoogleGenAI({ apiKey });
    const modelName = options.model || 'gemini-3-flash-preview';

    // Apply Soft-Schema Logic to Streaming as well
    let systemInstruction = options.systemInstruction || "";
    let responseMimeType = "text/plain";

    if (options.responseSchema) {
        const schemaString = JSON.stringify(options.responseSchema, null, 2);
        systemInstruction += `\n\n[OUTPUT REQUIREMENT]\nOutput VALID JSON matching this schema:\n${schemaString}\n\nEnclose in \`\`\`json ... \`\`\``;
        // We stick to text/plain to keep the thinking stream flowing
        responseMimeType = "text/plain";
    }

    const contents = [...(options.history || []), { role: 'user', parts: Array.isArray(prompt) ? prompt : [{ text: String(prompt || " ") }] }];

    const response = await ai.models.generateContentStream({
        model: modelName,
        contents,
        config: {
            systemInstruction,
            tools: options.tools || [{
                googleSearch: {
                    dynamicRetrievalConfig: {
                        mode: "MODE_DYNAMIC",
                        dynamicThreshold: 0.3 // Aggressive grounding
                    }
                }
            }, { codeExecution: {} }],
            temperature: options.temperature ?? 0.1,
            maxOutputTokens: 65536,
            safetySettings: options.safetySettings || SAFETY_SETTINGS_REASONING,
            thinkingConfig: { includeThoughts: true, thinkingLevel: "high" },
            responseMimeType
        },
    });

    try {
        for await (const chunk of response) {
            if (chunk.usageMetadata) yield { type: 'usage', usage: chunk.usageMetadata };
            if (chunk.candidates?.[0]?.groundingMetadata) yield { type: 'grounding', metadata: chunk.candidates[0].groundingMetadata };
            const parts = chunk.candidates?.[0]?.content?.parts || [];
            for (const part of parts) {
                const p = part as any;
                if (p.thought) yield { type: 'thought', content: (typeof p.thought === 'string' ? p.thought : p.text) };
                else if (p.executableCode) yield { type: 'code_start', language: p.executableCode.language, code: p.executableCode.code };
                else if (p.codeExecutionResult) yield { type: 'code_result', output: p.codeExecutionResult.output };
                else if (p.functionCall) yield { type: 'function_call', name: p.functionCall.name, args: p.functionCall.args };
                else if (p.text) yield { type: 'text', content: p.text };
            }
        }
    } catch (streamError: any) {
        const errorMessage = streamError?.message || String(streamError);
        console.error(`[Gemini:StreamError] ${errorMessage}`);

        // Check for retryable errors that should trigger failover
        const isOverloaded = errorMessage.includes('503') ||
            errorMessage.includes('UNAVAILABLE') ||
            errorMessage.includes('overloaded');

        if (isOverloaded) {
            // RE-THROW so the router can catch and failover to another model
            throw new Error(`[Gemini:503] Model overloaded mid-stream: ${errorMessage}`);
        }

        // For other errors, yield error chunk (non-fatal)
        yield { type: 'error', content: errorMessage };
    }
}

export async function executeMultimodalQuery(prompt: string | any[], options: any = {}) {
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) throw new Error("Missing GEMINI_API_KEY");
    const ai = new GoogleGenAI({ apiKey });
    return await ai.models.generateContent({
        model: options.model || 'gemini-3-flash-preview',
        contents: [{ role: 'user', parts: Array.isArray(prompt) ? prompt : [{ text: String(prompt || " ") }] }],
        config: {
            temperature: options.temperature,
            responseModalities: options.responseModalities,
            speechConfig: options.speechConfig,
            imageConfig: options.imageConfig,
            tools: []
        }
    });
}

export async function executeEmbeddingQuery(text: string): Promise<number[]> {
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) throw new Error("Missing GEMINI_API_KEY");
    const ai = new GoogleGenAI({ apiKey });
    const result = await ai.models.embedContent({
        model: 'text-embedding-004',
        contents: [{ parts: [{ text }] }]
    });
    return result.embeddings?.[0]?.values || [];
}

/**
 * executeDeepResearch
 * - Uses the "Deep Research" Agent (Interactions API)
 * - Best for: High-fidelity data extraction that requires multiple steps
 * - Note: This is an ASYNCHRONOUS agentic workflow.
 */
export async function executeDeepResearch(input: string, options: any = {}) {
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) throw new Error("Missing GEMINI_API_KEY");
    const ai = new GoogleGenAI({ apiKey });

    // Deep Research is only available via the Interactions API
    const interaction = await ai.interactions.create({
        input,
        agent: options.agent || 'deep-research-pro-preview-12-2025',
        background: options.background !== false, // Default to true (as docs recommend)
        tools: options.tools || []
    });

    return interaction;
}

export { Type };
