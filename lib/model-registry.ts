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
