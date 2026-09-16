import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/telegram/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { webhookSecret } = await import("@/lib/telegram.server");
        const expected = await webhookSecret();
        const provided = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
        if (!expected || provided.length !== expected.length || provided !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }

        const update = (await request.json()) as { update_id?: number };
        if (typeof update.update_id !== "number") {
          return Response.json({ ok: true, ignored: true });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Unique update_id makes Telegram's retries harmless.
        const { error: insertError } = await supabaseAdmin
          .from("telegram_updates")
          .insert({ update_id: update.update_id, payload: update as never });
        if (insertError) {
          return Response.json({ ok: true, duplicate: true });
        }

        try {
          const { handleUpdate } = await import("@/lib/bot.server");
          await handleUpdate(update as never);
          await supabaseAdmin
            .from("telegram_updates")
            .update({ processed_at: new Date().toISOString() })
            .eq("update_id", update.update_id);
        } catch (error) {
          console.error("Fallo procesando el update de Telegram", error);
          // Retry through the queue instead of making Telegram resend.
          await supabaseAdmin
            .from("jobs")
            .insert({ kind: "process_update", payload: update as never });
        }

        // Always 200: Telegram disables webhooks that keep failing.
        return Response.json({ ok: true });
      },
    },
  },
});
