import { PLANS, TRIAL_HOURS, type Plan, startTrial } from "./library.server";
import { issueAccessLink } from "./fulfillment.server";
import { answerCallbackQuery, editMessageText, sendMessage } from "./telegram.server";

type Update = {
  update_id: number;
  message?: {
    chat: { id: number };
    from?: { id: number; username?: string; first_name?: string };
    text?: string;
  };
  callback_query?: {
    id: string;
    data?: string;
    from?: { id: number; username?: string; first_name?: string };
    message?: { chat: { id: number }; message_id: number };
  };
};

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function rememberUser(from?: { id: number; username?: string; first_name?: string }) {
  if (!from) return;
  const db = await admin();
  const { data: profile } = await db
    .from("profiles")
    .select("id")
    .eq("telegram_id", from.id)
    .maybeSingle();
  if (profile?.id) {
    await db
      .from("profiles")
      .update({
        telegram_username: from.username ?? null,
        display_name: from.first_name ?? null,
      })
      .eq("id", profile.id);
  }
}

async function activePlanFor(telegramId: number): Promise<Plan | null> {
  const db = await admin();
  const { data: profile } = await db
    .from("profiles")
    .select("id")
    .eq("telegram_id", telegramId)
    .maybeSingle();
  if (profile?.id) {
    const { data } = await db.rpc("current_plan", { _user_id: profile.id });
    if (data) return data as Plan;
  }
  const { data: payment } = await db
    .from("payments")
    .select("plan")
    .eq("telegram_id", telegramId)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .maybeSingle();
  return (payment?.plan as Plan | undefined) ?? null;
}

/** True once the user has a paid plan OR an unexpired trial — even before they've
 * ever logged into the web app (trials are keyed by telegram_id, not user_id yet). */
async function hasAccess(telegramId: number): Promise<boolean> {
  const plan = await activePlanFor(telegramId);
  if (plan) return true;
  const db = await admin();
  const { data: trial } = await db
    .from("trials")
    .select("expires_at")
    .eq("telegram_id", telegramId)
    .maybeSingle();
  return !!trial && new Date(trial.expires_at) > new Date();
}

const upsellMenu = {
  inline_keyboard: [
    [
      {
        text: `⭐ ${PLANS.download.label} — $${PLANS.download.price}`,
        callback_data: "plan_download",
      },
    ],
  ],
};

const upsellText =
  `⭐ *${PLANS.download.label} — $${PLANS.download.price}*\n${PLANS.download.description}\n\n` +
  "💳 Pago seguro con PayPal. Acceso inmediato al confirmar.";

export async function handleUpdate(update: Update) {
  if (update.message) {
    const chatId = update.message.chat.id;
    const text = (update.message.text ?? "").trim().toLowerCase();
    await rememberUser(update.message.from);

    if (text.startsWith("/start")) {
      await startTrial(chatId);
      await deliverLibrary(chatId);
    } else if (text.startsWith("/biblioteca") || text.startsWith("/acceso")) {
      await deliverLibrary(chatId);
    } else if (text.startsWith("/planes")) {
      await sendMessage(chatId, upsellText, upsellMenu);
    } else if (text.startsWith("/ayuda")) {
      await sendMessage(
        chatId,
        "Comandos:\n/start — activa tu prueba gratis y abre la biblioteca\n/biblioteca — vuelve a abrir tu biblioteca\n/planes — acceso completo con descarga\n\nSi algo falla, escribe aquí y te respondemos.",
      );
    } else {
      await sendMessage(chatId, "Usa /start para entrar a la biblioteca.");
    }
    return;
  }

  if (update.callback_query) {
    const cb = update.callback_query;
    const chatId = cb.message?.chat.id ?? cb.from?.id;
    if (!chatId) return;
    await rememberUser(cb.from);
    await answerCallbackQuery(cb.id).catch(() => undefined);

    if (cb.data === "open_library") {
      await deliverLibrary(chatId);
      return;
    }

    if (cb.data === "plan_download") {
      const plan: Plan = "download";
      try {
        const { createOrder } = await import("./paypal.server");
        const { approvalUrl } = await createOrder(chatId, plan);
        const text =
          `💳 *${PLANS[plan].label} — $${PLANS[plan].price}*\n\n` +
          `${PLANS[plan].description}\n\n` +
          `[👉 Pagar con PayPal](${approvalUrl})\n\n` +
          "Al confirmar el pago recibes aquí mismo el botón para abrir tu biblioteca.";
        if (cb.message) {
          await editMessageText(chatId, cb.message.message_id, text);
        } else {
          await sendMessage(chatId, text);
        }
      } catch (error) {
        console.error("No se pudo crear la orden de PayPal", error);
        await sendMessage(
          chatId,
          "❌ No pudimos abrir el pago en este momento. Intenta de nuevo en un minuto.",
        );
      }
    }
  }
}

async function deliverLibrary(chatId: number) {
  const ok = await hasAccess(chatId);
  if (!ok) {
    await sendMessage(chatId, "Usa /start para activar tu prueba gratis.");
    return;
  }
  const link = await issueAccessLink(chatId);
  const plan = await activePlanFor(chatId);
  const status = plan === "download"
    ? "✅ Tienes acceso completo (ver y descargar)."
    : `🎁 Prueba gratis activa (${TRIAL_HOURS} horas desde tu primer /start), solo ver.`;
  await sendMessage(
    chatId,
    `📚 *Tu biblioteca está lista*\n\n${status}\n\n` +
      "Este botón te abre la biblioteca ya conectado. Es personal, de un solo uso y vence en 30 minutos.",
    {
      inline_keyboard: [
        [{ text: "📚 Abrir mi biblioteca", url: link }],
        ...(plan === "download" ? [] : [upsellMenu.inline_keyboard[0]]),
      ],
    },
  );
}
