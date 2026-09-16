import { PLANS, type Plan, appUrl } from "./library.server";

function base(): string {
  return process.env["PAYPAL_MODE"] === "sandbox"
    ? "https://api-m.sandbox.paypal.com"
    : "https://api-m.paypal.com";
}

async function accessToken(): Promise<string> {
  const id = process.env["PAYPAL_CLIENT_ID"];
  const secret = process.env["PAYPAL_SECRET"];
  if (!id || !secret) throw new Error("Faltan las credenciales de PayPal");

  const response = await fetch(`${base()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`PayPal auth falló [${response.status}]: ${text}`);
  return (JSON.parse(text) as { access_token: string }).access_token;
}

async function paypal<T>(path: string, init: RequestInit & { idempotencyKey?: string } = {}) {
  const token = await accessToken();
  const response = await fetch(`${base()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.idempotencyKey ? { "PayPal-Request-Id": init.idempotencyKey } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  if (!response.ok) {
    console.error(`PayPal ${path} falló [${response.status}]: ${text}`);
    throw new Error(`PayPal ${path} falló [${response.status}]: ${text}`);
  }
  return JSON.parse(text || "{}") as T;
}

type OrderResponse = { id: string; links: Array<{ rel: string; href: string }> };

/** Creates an order and returns the PayPal approval URL. */
export async function createOrder(telegramId: number, plan: Plan) {
  const details = PLANS[plan];
  const order = await paypal<OrderResponse>("/v2/checkout/orders", {
    method: "POST",
    idempotencyKey: `${telegramId}-${plan}-${Date.now()}`,
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          custom_id: `${telegramId}:${plan}`,
          description: `Biblioteca de ejercicios — ${details.label}`,
          amount: { currency_code: "USD", value: details.price },
        },
      ],
      application_context: {
        brand_name: "Biblioteca de Ejercicios",
        user_action: "PAY_NOW",
        return_url: `${appUrl()}/api/public/paypal/return`,
        cancel_url: `${appUrl()}/pago-cancelado`,
      },
    }),
  });

  const approval = order.links.find((l) => l.rel === "payer-action" || l.rel === "approve");
  if (!approval) throw new Error("PayPal no devolvió el enlace de pago");
  return { orderId: order.id, approvalUrl: approval.href };
}

type CaptureResponse = {
  id: string;
  status: string;
  purchase_units?: Array<{
    custom_id?: string;
    payments?: { captures?: Array<{ id: string; status: string }> };
  }>;
};

export async function captureOrder(orderId: string) {
  return paypal<CaptureResponse>(`/v2/checkout/orders/${orderId}/capture`, {
    method: "POST",
    idempotencyKey: `capture-${orderId}`,
    body: "{}",
  });
}

export async function getOrder(orderId: string) {
  return paypal<CaptureResponse>(`/v2/checkout/orders/${orderId}`, { method: "GET" });
}

/** Verifies a PayPal webhook signature server-side before trusting the payload. */
export async function verifyWebhook(headers: Headers, rawBody: string): Promise<boolean> {
  const webhookId = process.env["PAYPAL_WEBHOOK_ID"];
  if (!webhookId) return false;
  const result = await paypal<{ verification_status: string }>(
    "/v1/notifications/verify-webhook-signature",
    {
      method: "POST",
      body: JSON.stringify({
        webhook_id: webhookId,
        transmission_id: headers.get("paypal-transmission-id"),
        transmission_time: headers.get("paypal-transmission-time"),
        transmission_sig: headers.get("paypal-transmission-sig"),
        cert_url: headers.get("paypal-cert-url"),
        auth_algo: headers.get("paypal-auth-algo"),
        webhook_event: JSON.parse(rawBody),
      }),
    },
  );
  return result.verification_status === "SUCCESS";
}
