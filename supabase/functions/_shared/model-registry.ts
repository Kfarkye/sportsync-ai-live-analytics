
export interface ModelConfig {
    id: string;
    displayName: string;
    apiProvider: 'google' | 'openai' | 'anthropic';
    strengths: string[];
    systemPromptOverride?: string;
    priority: number;
    isActive: boolean;
    timeout: number; // ms
    // Capabilities
    reasoningEffort?: 'none' | 'low' | 'medium' | 'high' | 'xhigh';
    verbosity?: 'low' | 'medium' | 'high';
}

export type FallbackReason =
    | 'quota_exceeded'
    | 'rate_limited'
    | 'primary_timeout'
    | 'primary_error';

export interface PickProvenance {
    model_id: string;
    is_fallback: boolean;
    fallback_reason: FallbackReason | null;
    primary_model: string | null;
    extraction_version: string;
}

export const PRIMARY_CHAT_MODEL = 'gemini-3-flash-preview';
export const PRIMARY_WORKER_MODEL = 'gemini-3-flash-preview';

export const MODEL_REGISTRY: ModelConfig[] = [
    {
        id: 'gemini-3-flash-preview',
        displayName: 'Gemini 3 Flash',
        apiProvider: 'google',
        strengths: ['Speed', 'Grounding Search', 'Long Context', 'Multimodal'],
        priority: 1, // PRIMARY - Fastest, cheapest
        isActive: true,
        timeout: 45000
    },
    {
        id: 'gemini-3-flash-preview',
        displayName: 'Gemini 3 Pro',
        apiProvider: 'google',
        strengths: ['Deep Reasoning', 'Complex Analysis', 'Accuracy'],
        priority: 2,
        isActive: false, // DEPRECATED per user request
        timeout: 55000
    },
    {
        id: 'gpt-5.2',
        displayName: 'GPT-5.2 (The Calculator)',
        apiProvider: 'openai',
        strengths: ['Structured Outputs', 'Mathematical Precision', 'Rule Following'],
        reasoningEffort: 'medium',
        verbosity: 'low',
        systemPromptOverride: `
You are "The Calculator" - a quantitative betting analyst.
CORE PRINCIPLES:
1.  **Triple Confluence**: Only recommend a play if Math (EV), Market (Sharp Money), and Matchup (Schematic) align.
2.  **Expected Value First**: Explicitly calculate implied probability vs. your assessed probability.
3.  **Risk Aversion**: Default to "PASS" if the edge is < 3%.
4.  **Structured Output**: You MUST return your analysis in the strict JSON format provided. No markdown, no conversational filler.
      `,
        priority: 3, // TERTIARY - Last resort / cross-provider failover
        isActive: true,
        timeout: 58000
    }

];

export const getActiveModel = (): ModelConfig => {
    // Return highest priority active model (lowest number = highest priority)
    return MODEL_REGISTRY.filter(m => m.isActive).sort((a, b) => a.priority - b.priority)[0];
};

export const getFallbackModel = (failedModelId: string): ModelConfig | null => {
    // Find next best model
    return MODEL_REGISTRY
        .filter(m => m.isActive && m.id !== failedModelId)
        .sort((a, b) => a.priority - b.priority)[0] || null;
};
