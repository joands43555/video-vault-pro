import { createFileRoute } from "@tanstack/react-router";

/**
 * Queue runner. Called on a schedule; retries failed Telegram deliveries and
 * respects Telegram's send rate by processing a bounded batch per call.
 */
export const Route = createFileRoute("/api/public/jobs/run")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["JOBS_SECRET"];
        const provided = request.headers.get("x-jobs-secret") ?? "";
        if (!secret || provided.length !== secret.length || provided !== secret) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runJob } = await import("@/lib/fulfillment.server");

        const { data: jobs, error } = await supabaseAdmin.rpc("claim_jobs", { _limit: 25 });
        if (error) return Response.json({ error: error.message }, { status: 500 });

        let done = 0;
        let failed = 0;
        for (const job of jobs ?? []) {
          try {
            await runJob(job as never);
            done += 1;
          } catch (jobError) {
            failed += 1;
            const attempts = (job as { attempts: number }).attempts;
            const message = jobError instanceof Error ? jobError.message : String(jobError);
            await supabaseAdmin
              .from("jobs")
              .update({
                status: attempts >= 5 ? "failed" : "pending",
                run_at: new Date(Date.now() + attempts * 60_000).toISOString(),
                last_error: message.slice(0, 500),
                updated_at: new Date().toISOString(),
              })
              .eq("id", (job as { id: string }).id);
          }
          // Stay well under Telegram's ~30 messages/second limit.
          await new Promise((resolve) => setTimeout(resolve, 40));
        }

        return Response.json({ ok: true, done, failed });
      },
    },
  },
});
