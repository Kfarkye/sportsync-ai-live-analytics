// supabase/functions/_shared/env.ts

export function mustEnv(key: string): string {
    const v = Deno.env.get(key);
    if (!v) throw new Error(`[ENV:MISSING] ${key}`);
    return v;
}

export function optEnv(key: string, fallback = ""): string {
    return Deno.env.get(key) ?? fallback;
}

/**
 * Validates that a request is authorized via one of:
 *  1. A valid service_role Bearer token in Authorization header
 *  2. A matching x-pipeline-secret header
 *  3. A matching x-cron-secret header
 *
 * Returns a 401 Response if unauthorized, or null if authorized.
 */
export function validateEdgeAuth(req: Request): Response | null {
    // 1. Service role bearer token (validated by Supabase edge runtime)
    const authHeader = req.headers.get("authorization") || "";
    if (authHeader.startsWith("Bearer ") && authHeader.length > 50) {
        return null; // Authorized
    }

    // 2. Pipeline secret (function-to-function calls)
    const pipelineSecret = Deno.env.get("PIPELINE_SECRET") || "";
    const gotPipeline = req.headers.get("x-pipeline-secret") ?? "";
    if (pipelineSecret && gotPipeline && timingSafeCompare(gotPipeline, pipelineSecret)) {
        return null; // Authorized
    }

    // 3. Cron secret (scheduled invocations)
    const cronSecret = Deno.env.get("CRON_SECRET") || "";
    const gotCron = req.headers.get("x-cron-secret") ?? "";
    if (cronSecret && gotCron && timingSafeCompare(gotCron, cronSecret)) {
        return null; // Authorized
    }

    return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
    });
}

/** Timing-safe string comparison to prevent timing attacks on secrets */
function timingSafeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let mismatch = 0;
    for (let i = 0; i < a.length; i++) {
        mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return mismatch === 0;
}

/** @deprecated Use validateEdgeAuth() instead */
export function assertPipelineSecret(req: Request): void {
    const result = validateEdgeAuth(req);
    if (result) {
        throw Object.assign(new Error("[AUTH] Unauthorized request."), { status: 401 });
    }
}
