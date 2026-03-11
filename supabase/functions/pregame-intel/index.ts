// functions/pregame-intel/index.ts (Refactored ARCHITECT PROXY)
declare const Deno: any;

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { validateEdgeAuth } from "../_shared/env.ts";

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-client-info, apikey, x-client-timeout, x-trace-id, x-pipeline-secret, x-cron-secret",
    "Content-Type": "application/json",
};

function buildInternalEdgeHeaders() {
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const headers: Record<string, string> = {};

    if (serviceRoleKey) {
        headers["Authorization"] = `Bearer ${serviceRoleKey}`;
        headers["apikey"] = serviceRoleKey;
    }

    const pipelineSecret = Deno.env.get("PIPELINE_SECRET") ?? "";
    const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
    if (pipelineSecret) headers["x-pipeline-secret"] = pipelineSecret;
    if (cronSecret) headers["x-cron-secret"] = cronSecret;

    return headers;
}

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

    const authError = validateEdgeAuth(req);
    if (authError) return authError;

    const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    try {
        const body = await req.json();
        console.log(`[PROXY] Forwarding Request to Worker...`);

        const workerUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/pregame-intel-worker`;
        const resp = await supabase.functions.invoke("pregame-intel-worker", {
            body,
            headers: buildInternalEdgeHeaders()
        });

        if (resp.error) throw resp.error;

        return new Response(JSON.stringify(resp.data), {
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
        });

    } catch (err: any) {
        console.error("[Proxy-Fail]", err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS_HEADERS });
    }
});
