import { createFileRoute } from "@tanstack/react-router";

import type { Plan } from "@/lib/library.server";

export const Route = createFileRoute("/api/public/paypal/return")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const orderId = url.searchParams.get("token");
        if (!orderId) return Response.redirect(new URL("/pago-cancelado", url), 302);

        try {
          const { captureOrder, getOrder } = await import("@/lib/paypal.server");
          const { fulfillPayment, runJob } = await import("@/lib/fulfillment.server");

          let capture = await captureOrder(orderId).catch(() => null);
          if (!capture) capture = await getOrder(orderId);

          if (capture.status !== "COMPLETED") {
            return Response.redirect(new URL("/pago-cancelado", url), 302);
          }

          const unit = capture.purchase_units?.[0];
          const [telegramIdRaw, planRaw] = (unit?.custom_id ?? "").split(":");
          const telegramId = Number(telegramIdRaw);
          const plan = (planRaw === "download" ? "download" : "view") as Plan;
          if (!telegramId) throw new Error("El pago no trae el usuario de Telegram");

          await fulfillPayment({
            orderId,
            captureId: unit?.payments?.captures?.[0]?.id ?? null,
            telegramId,
            plan,
            raw: capture,
          });

          // Deliver immediately instead of waiting for the queue sweep.
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: jobs } = await supabaseAdmin.rpc("claim_jobs", { _limit: 5 });
          for (const job of jobs ?? []) {
            await runJob(job as never).catch((error) =>
              console.error("Trabajo falló tras el pago", error),
            );
          }

          return Response.redirect(new URL("/pago-listo", url), 302);
        } catch (error) {
          console.error("Fallo al cerrar el pago de PayPal", error);
          return Response.redirect(new URL("/pago-problema", url), 302);
        }
      },
    },
  },
});
