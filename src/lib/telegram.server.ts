const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";

function keys() {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const connectionKey = process.env["TELEGRAM_API_KEY"];
  if (!lovableKey) throw new Error("LOVABLE_API_KEY no está configurada");
  if (!connectionKey) throw new Error("TELEGRAM_API_KEY no está configurada");
  return { lovableKey, connectionKey };
}

export async function telegram<T = unknown>(
  method: string,
  body: Record<string, unknown>,
): Promise<T> {
  const { lovableKey, connectionKey } = keys();
  const response = await fetch(`${GATEWAY_URL}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": connectionKey,
      "Content-Type": "application/json",
    },
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

/** Derives the webhook secret from the connection key so both sides agree. */
export async function webhookSecret(): Promise<string> {
  const connectionKey = process.env["TELEGRAM_API_KEY"] ?? "";
  const bytes = new TextEncoder().encode(`telegram-webhook:${connectionKey}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Buffer.from(digest).toString("base64url");
}
