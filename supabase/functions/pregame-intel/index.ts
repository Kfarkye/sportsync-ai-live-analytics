// functions/pregame-intel/index.ts (Refactored ARCHITECT PROXY)
declare const Deno: any;

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, validateEdgeAuth } from "../_shared/env.ts";

Deno.serve(async (req: Request) => {
    const corsHeaders = getCorsHeaders(req);

    if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    const authError = validateEdgeAuth(req);
    if (authError) return authError;

    const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    try {
        const body = await req.json();
        console.log(`[PROXY] Forwarding Request to Worker...`);

        const resp = await supabase.functions.invoke("pregame-intel-worker", {
            body,
            headers: {
                Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            }
        });

        if (resp.error) throw resp.error;

        return new Response(JSON.stringify(resp.data), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
        });

    } catch (err: any) {
        console.error("[Proxy-Fail]", err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
});
