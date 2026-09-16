const TELEGRAM_API = "https://api.telegram.org";

function botToken(): string {
  const token = process.env["BOT_TOKEN"];
  if (!token) throw new Error("BOT_TOKEN no está configurado");
  return token;
}

export async function telegram<T = unknown>(
  method: string,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`${TELEGRAM_API}/bot${botToken()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) {
    console.error(`Telegram ${method} falló [${response.status}]: ${text}`);
    throw new Error(`Telegram ${method} falló [${response.status}]: ${text}`);
  }
  const parsed = JSON.parse(text) as { ok: boolean; result?: T; description?: string };
  if (!parsed.ok) {
    console.error(`Telegram ${method} respondió ok=false: ${parsed.description}`);
    throw new Error(parsed.description ?? `Telegram ${method} respondió ok=false`);
  }
  return parsed.result as T;
}

export type InlineKeyboard = { inline_keyboard: Array<Array<Record<string, unknown>>> };

export function sendMessage(
  chatId: number,
  text: string,
  replyMarkup?: InlineKeyboard,
  extra: Record<string, unknown> = {},
) {
  return telegram("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "Markdown",
    disable_web_page_preview: true,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    ...extra,
  });
}

export function answerCallbackQuery(id: string, text?: string) {
  return telegram("answerCallbackQuery", { callback_query_id: id, ...(text ? { text } : {}) });
}

export function editMessageText(
  chatId: number,
  messageId: number,
  text: string,
  replyMarkup?: InlineKeyboard,
) {
  return telegram("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "Markdown",
    disable_web_page_preview: true,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

/**
 * Secret Telegram echoes back on every webhook call (X-Telegram-Bot-Api-Secret-Token),
 * set once when you register the webhook with setWebhook's secret_token param.
 * Any random string works — generate one and set it as TELEGRAM_WEBHOOK_SECRET.
 */
export async function webhookSecret(): Promise<string> {
  const secret = process.env["TELEGRAM_WEBHOOK_SECRET"];
  if (!secret) throw new Error("TELEGRAM_WEBHOOK_SECRET no está configurado");
  return secret;
}
