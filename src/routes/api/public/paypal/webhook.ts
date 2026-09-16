import { createFileRoute } from "@tanstack/react-router";

import type { Plan } from "@/lib/library.server";

/**
 * Authoritative confirmation path: works even if the buyer closes the browser
 * before returning from PayPal.
 */
export const Route = createFileRoute("/api/public/paypal/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        const { verifyWebhook } = await import("@/lib/paypal.server");

        const valid = await verifyWebhook(request.headers, raw).catch((error) => {
          console.error("Verificación del webhook de PayPal falló", error);
          return false;
        });
        if (!valid) return new Response("Invalid signature", { status: 401 });

        const event = JSON.parse(raw) as {
          event_type?: string;
          resource?: {
            id?: string;
            custom_id?: string;
            supplementary_data?: { related_ids?: { order_id?: string } };
          };
        };

        if (
          event.event_type !== "PAYMENT.CAPTURE.COMPLETED" &&
          event.event_type !== "CHECKOUT.ORDER.APPROVED"
        ) {
          return Response.json({ ok: true, ignored: event.event_type });
        }

        const orderId =
          event.resource?.supplementary_data?.related_ids?.order_id ?? event.resource?.id;
        const [telegramIdRaw, planRaw] = (event.resource?.custom_id ?? "").split(":");
        const telegramId = Number(telegramIdRaw);
        if (!orderId || !telegramId) {
          return Response.json({ ok: true, ignored: "sin datos del comprador" });
        }

        const { fulfillPayment } = await import("@/lib/fulfillment.server");
        await fulfillPayment({
          orderId,
          captureId: event.resource?.id ?? null,
          telegramId,
          plan: (planRaw === "download" ? "download" : "view") as Plan,
          raw: event,
        });

        return Response.json({ ok: true });
      },
    },
  },
});
