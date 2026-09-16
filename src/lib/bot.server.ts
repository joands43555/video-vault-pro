import { PLANS, type Plan } from "./library.server";
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

const menu = {
  inline_keyboard: [
    [{ text: `👀 ${PLANS.view.label} — $${PLANS.view.price}`, callback_data: "plan_view" }],
    [
      {
        text: `⬇️ ${PLANS.download.label} — $${PLANS.download.price}`,
        callback_data: "plan_download",
      },
    ],
    [{ text: "📚 Ya pagué, abrir mi biblioteca", callback_data: "open_library" }],
  ],
};

const welcome =
  "🏋️ *Biblioteca de Ejercicios*\n\n" +
  "Más de 1700 ejercicios en video, con buscador por músculo y equipo.\n\n" +
  `👀 *${PLANS.view.label} — $${PLANS.view.price}*\n${PLANS.view.description}\n\n` +
  `⬇️ *${PLANS.download.label} — $${PLANS.download.price}*\n${PLANS.download.description}\n\n` +
  "💳 Pago seguro con PayPal. Acceso inmediato al confirmar.";

export async function handleUpdate(update: Update) {
  if (update.message) {
    const chatId = update.message.chat.id;
    const text = (update.message.text ?? "").trim().toLowerCase();
    await rememberUser(update.message.from);

    if (text.startsWith("/start")) {
      await sendMessage(chatId, welcome, menu);
    } else if (text.startsWith("/biblioteca") || text.startsWith("/acceso")) {
      await deliverLibrary(chatId);
    } else if (text.startsWith("/planes")) {
      await sendMessage(chatId, welcome, menu);
    } else if (text.startsWith("/ayuda")) {
      await sendMessage(
        chatId,
        "Comandos:\n/start — ver los planes\n/biblioteca — abrir tu biblioteca\n/planes — precios\n\nSi algo falla, escribe aquí y te respondemos.",
      );
    } else {
      await sendMessage(chatId, "Usa /start para ver los planes o /biblioteca si ya pagaste.");
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

    if (cb.data === "plan_view" || cb.data === "plan_download") {
      const plan: Plan = cb.data === "plan_download" ? "download" : "view";
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
  const plan = await activePlanFor(chatId);
  if (!plan) {
    await sendMessage(
      chatId,
      "Todavía no tienes acceso activo. Elige un plan para entrar 👇",
      menu,
    );
    return;
  }
  const link = await issueAccessLink(chatId);
  await sendMessage(
    chatId,
    `📚 *Tu acceso está activo* (${PLANS[plan].label})\n\n` +
      "Este botón te abre la biblioteca ya conectado. Es personal, de un solo uso y vence en 30 minutos.",
    { inline_keyboard: [[{ text: "📚 Abrir mi biblioteca", url: link }]] },
  );
}
