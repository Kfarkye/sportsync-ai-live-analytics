
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    });
}

Deno.serve(async () => {
    try {
        // 1. SELECT JOB (Priority: Running > Queued)
        const { data: runningJobs, error: runErr } = await supabase
            .from("intel_jobs")
            .select("id")
            .eq("status", "running")
            .order("updated_at", { ascending: true })
            .limit(1);

        if (runErr) return json({ error: runErr.message }, 500);

        let jobId = runningJobs?.[0]?.id as string | undefined;

        if (!jobId) {
            const { data: queuedJobs, error: qErr } = await supabase
                .from("intel_jobs")
                .select("id")
                .eq("status", "queued")
                .order("created_at", { ascending: true })
                .limit(1);

            if (qErr) return json({ error: qErr.message }, 500);
            jobId = queuedJobs?.[0]?.id;
        }

        if (!jobId) return json({ ok: true, note: "no_jobs" });

        // 2. DISPATCH WORKER (Internal Call)
        const workerUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/pregame-intel-worker`;
        console.log(`Dispatching Job ${jobId} to Worker: ${workerUrl}`);

        const resp = await fetch(workerUrl, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            },
            body: JSON.stringify({ job_id: jobId }),
        });

        const out = await resp.json().catch(() => ({}));
        return json({ ok: resp.ok, job_id: jobId, worker: out }, resp.ok ? 200 : 500);
    } catch (e) {
        return json({ error: String(e) }, 500);
    }
});
