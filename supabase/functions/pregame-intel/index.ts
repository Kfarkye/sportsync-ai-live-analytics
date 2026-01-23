// functions/pregame-intel/index.ts (Refactored ARCHITECT PROXY)
declare const Deno: any;

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-client-info, apikey, x-client-timeout, x-trace-id",
    "Content-Type": "application/json",
};

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

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
            headers: {
                Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            }
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