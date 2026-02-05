// supabase/functions/_shared/env.ts

export function mustEnv(key: string): string {
    const v = Deno.env.get(key);
    if (!v) throw new Error(`[ENV:MISSING] ${key}`);
    return v;
}

export function optEnv(key: string, fallback = ""): string {
    return Deno.env.get(key) ?? fallback;
}

export function assertPipelineSecret(req: Request): void {
    const required = Deno.env.get("PIPELINE_SECRET");
    if (!required) return; // secret disabled
    const got = req.headers.get("x-pipeline-secret") ?? "";
    if (got !== required) {
        throw Object.assign(new Error("[AUTH] Invalid pipeline secret."), { status: 401 });
    }
}
