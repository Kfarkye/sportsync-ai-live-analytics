
// functions/_shared/retry.ts
export async function withRetry<T>(
    fn: () => Promise<T>,
    opts?: {
        maxAttempts?: number;
        baseDelayMs?: number;
        maxDelayMs?: number;
        timeoutBudgetMs?: number; // stop retrying if we exceed this
        isRetryable?: (e: unknown) => boolean;
    },
): Promise<T> {
    const maxAttempts = opts?.maxAttempts ?? 3;
    const baseDelayMs = opts?.baseDelayMs ?? 400;
    const maxDelayMs = opts?.maxDelayMs ?? 8000;
    const timeoutBudgetMs = opts?.timeoutBudgetMs ?? 9000;
    const isRetryable = opts?.isRetryable ?? ((e) => String(e).includes("503") || String(e).includes("UNAVAILABLE") || String(e).includes("User rate limit exceeded"));

    const start = Date.now();
    let attempt = 0;
    let lastErr: unknown;

    while (attempt < maxAttempts) {
        attempt++;
        try {
            return await fn();
        } catch (e) {
            lastErr = e;
            const elapsed = Date.now() - start;
            if (!isRetryable(e) || elapsed > timeoutBudgetMs || attempt >= maxAttempts) break;

            const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
            const jitter = Math.floor(Math.random() * 250);
            const delay = exp + jitter;
            console.warn(`Retry attempt ${attempt} after error: ${e}. Waiting ${delay}ms...`);
            await new Promise((r) => setTimeout(r, delay));
        }
    }

    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
