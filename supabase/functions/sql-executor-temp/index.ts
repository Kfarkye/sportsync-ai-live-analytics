import * as postgres from "https://deno.land/x/postgres@v0.19.3/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve(async (req) => {
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

    try {
        const { sql } = await req.json();
        if (!sql) return new Response("Missing sql payload", { status: 400 });

        const dbUrl = Deno.env.get("SUPABASE_DB_URL");
        if (!dbUrl) throw new Error("Missing SUPABASE_DB_URL");

        // Connect to Postgres inside the edge function
        const pool = new postgres.Pool(dbUrl, 3, true);
        const connection = await pool.connect();

        try {
            const result = await connection.queryObject(sql);
            return new Response(JSON.stringify({ success: true, result: result.rows }), {
                headers: { "Content-Type": "application/json" }
            });
        } finally {
            connection.release();
        }
    } catch (err: any) {
        return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500 });
    }
});
