import { PLANS, type Plan, appUrl, hashToken, newToken } from "./library.server";
import { sendMessage } from "./telegram.server";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** One-time web login link for a Telegram user, valid for 30 minutes. */
export async function issueAccessLink(telegramId: number): Promise<string> {
  const db = await admin();
  const token = newToken();
  const { error } = await db.from("access_links").insert({
    token_hash: hashToken(token),
    telegram_id: telegramId,
    expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  });
  if (error) throw new Error(error.message);
  return `${appUrl()}/acceso?token=${token}`;
}

/**
 * Idempotent: records the payment, grants the entitlement, and queues the
 * Telegram delivery. Safe to call from both the return URL and the webhook.
 */
export async function fulfillPayment(input: {
  orderId: string;
  captureId?: string | null;
  telegramId: number;
  plan: Plan;
  raw?: unknown;
}) {
  const db = await admin();

  const { data: existing } = await db
    .from("payments")
    .select("id, status")
    .eq("provider", "paypal")
    .eq("provider_order_id", input.orderId)
    .maybeSingle();

  if (existing?.status === "completed") {
    return { alreadyDone: true as const };
  }

  const payload = {
    provider: "paypal",
    provider_order_id: input.orderId,
    provider_capture_id: input.captureId ?? null,
    telegram_id: input.telegramId,
    plan: input.plan,
    amount: PLANS[input.plan].price,
    currency: "USD",
    status: "completed",
    raw: (input.raw ?? null) as never,
    updated_at: new Date().toISOString(),
  };

  const { error } = await db
    .from("payments")
    .upsert(payload, { onConflict: "provider,provider_order_id" });
  if (error) throw new Error(error.message);

  // If the account already exists, grant right away.
  const { data: profile } = await db
    .from("profiles")
    .select("id")
    .eq("telegram_id", input.telegramId)
    .maybeSingle();

  if (profile?.id) {
    await db
      .from("payments")
      .update({ user_id: profile.id })
      .eq("provider_order_id", input.orderId);
    const { data: already } = await db
      .from("entitlements")
      .select("id")
      .eq("user_id", profile.id)
      .eq("plan", input.plan)
      .eq("status", "active")
      .maybeSingle();
    if (!already) {
      await db
        .from("entitlements")
        .insert({ user_id: profile.id, plan: input.plan, source: "paypal" });
    }
  }

  await db.from("jobs").insert({
    kind: "deliver_access",
    payload: { telegram_id: input.telegramId, plan: input.plan },
  });

  return { alreadyDone: false as const };
}

/** Runs one queued job. Called by the queue runner route. */
export async function runJob(job: { id: string; kind: string; payload: Record<string, unknown> }) {
  const db = await admin();

  if (job.kind === "deliver_access") {
    const telegramId = Number(job.payload["telegram_id"]);
    const plan = job.payload["plan"] as Plan;
    const link = await issueAccessLink(telegramId);
    const extra =
      plan === "download"
        ? "• Puedes ver y **descargar** todos los archivos.\n"
        : "• Puedes **ver en línea** toda la biblioteca.\n";
    await sendMessage(
      telegramId,
      `🎉 *¡Pago confirmado!*\n\nPlan: *${PLANS[plan].label}*\n${extra}\n` +
        `Abre tu biblioteca con este botón. El enlace es personal y vence en 30 minutos; ` +
        `si expira pide otro con /biblioteca.`,
      { inline_keyboard: [[{ text: "📚 Abrir mi biblioteca", url: link }]] },
    );
  } else if (job.kind === "send_message") {
    await sendMessage(
      Number(job.payload["chat_id"]),
      String(job.payload["text"]),
      job.payload["reply_markup"] as never,
    );
  } else if (job.kind === "process_update") {
    const { handleUpdate } = await import("./bot.server");
    await handleUpdate(job.payload as never);
  } else {
    throw new Error(`Tipo de trabajo desconocido: ${job.kind}`);
  }

  await db
    .from("jobs")
    .update({ status: "done", updated_at: new Date().toISOString() })
    .eq("id", job.id);
}
