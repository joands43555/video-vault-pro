import { createHash, randomBytes } from "node:crypto";

export const MEDIA_BUCKET = "exercise-media";

export type Plan = "view" | "download";

/** Free trial length, in hours. */
export const TRIAL_HOURS = 2;

export const PLANS: Record<Plan, { price: string; label: string; description: string }> = {
  view: {
    price: "0.00",
    label: `Prueba gratis (${TRIAL_HOURS} horas)`,
    description: "Ves toda la biblioteca en línea durante 2 horas. Sin descargas.",
  },
  download: {
    price: "10.00",
    label: "Acceso completo",
    description: "Pago único: acceso permanente en línea y descarga de todos los archivos.",
  },
};

export const FULL_ACCESS_PRICE = PLANS.download.price;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function appUrl(): string {
  return (process.env["PUBLIC_APP_URL"] ?? "").replace(/\/$/, "");
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Highest active plan for a user, or null when they have no access. */
export async function getActivePlan(userId: string): Promise<Plan | null> {
  const db = await admin();
  const { data, error } = await db.rpc("current_plan", { _user_id: userId });
  if (error) throw error;
  return (data as Plan | null) ?? null;
}

/** Short-lived signed URL for streaming a private media file. */
export async function signStreamUrl(path: string, seconds = 120): Promise<string> {
  const db = await admin();
  const { data, error } = await db.storage.from(MEDIA_BUCKET).createSignedUrl(path, seconds);
  if (error || !data) throw error ?? new Error("No se pudo firmar el archivo");
  return data.signedUrl;
}

/** Short-lived signed URL that forces a download (plan 'download' only). */
export async function signDownloadUrl(path: string, filename: string, seconds = 120) {
  const db = await admin();
  const { data, error } = await db.storage
    .from(MEDIA_BUCKET)
    .createSignedUrl(path, seconds, { download: filename });
  if (error || !data) throw error ?? new Error("No se pudo firmar la descarga");
  return data.signedUrl;
}

/** Audit trail: who watched or downloaded what. */
export async function logAccess(row: {
  user_id: string;
  exercise_id?: string | null;
  action: string;
  ip?: string | null;
  user_agent?: string | null;
}) {
  const db = await admin();
  await db.from("access_events").insert(row);
}

/**
 * Simple per-user rate limit based on the audit trail. Stops one account
 * being shared across many people or scraped in bulk.
 */
export async function assertWithinRateLimit(userId: string, action: string, maxPerHour: number) {
  const db = await admin();
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error } = await db
    .from("access_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("action", action)
    .gte("created_at", since);
  if (error) throw error;
  if ((count ?? 0) >= maxPerHour) {
    throw new Error("Límite de uso alcanzado. Intenta de nuevo en un rato.");
  }
}

export async function enqueueJob(kind: string, payload: Record<string, unknown>) {
  const db = await admin();
  await db.from("jobs").insert({ kind, payload });
}

/* ----------------------------- Free trial ------------------------------ */

export type Trial = { telegram_id: number; expires_at: string; user_id: string | null };

/** Starts the 2-hour trial the first time a Telegram user runs /start. */
export async function startTrial(telegramId: number): Promise<Trial> {
  const db = await admin();
  const { data: existing } = await db
    .from("trials")
    .select("telegram_id, expires_at, user_id")
    .eq("telegram_id", telegramId)
    .maybeSingle();
  if (existing) return existing as Trial;

  const expires = new Date(Date.now() + TRIAL_HOURS * 60 * 60 * 1000).toISOString();
  const { data, error } = await db
    .from("trials")
    .insert({ telegram_id: telegramId, expires_at: expires })
    .select("telegram_id, expires_at, user_id")
    .single();
  if (error) throw new Error(error.message);
  return data as Trial;
}

/**
 * Mirrors the trial into an entitlement so every access check goes through
 * current_plan(). Paid users are left alone.
 */
export async function syncTrialEntitlement(userId: string, telegramId: number) {
  const db = await admin();
  await db.from("trials").update({ user_id: userId }).eq("telegram_id", telegramId);

  const { data: paid } = await db
    .from("entitlements")
    .select("id")
    .eq("user_id", userId)
    .eq("plan", "download")
    .eq("status", "active")
    .maybeSingle();
  if (paid) return;

  const { data: trial } = await db
    .from("trials")
    .select("expires_at")
    .eq("telegram_id", telegramId)
    .maybeSingle();
  if (!trial) return;

  const { data: already } = await db
    .from("entitlements")
    .select("id")
    .eq("user_id", userId)
    .eq("plan", "view")
    .eq("source", "trial")
    .maybeSingle();

  if (already) {
    await db.from("entitlements").update({ expires_at: trial.expires_at }).eq("id", already.id);
  } else {
    await db.from("entitlements").insert({
      user_id: userId,
      plan: "view",
      source: "trial",
      expires_at: trial.expires_at,
    });
  }
}

export type AccessState = {
  plan: Plan | null;
  canView: boolean;
  canDownload: boolean;
  needsPayment: boolean;
  trialEndsAt: string | null;
};

/** Single source of truth for what a signed-in user may do right now. */
export async function getAccessState(userId: string): Promise<AccessState> {
  const db = await admin();
  const plan = await getActivePlan(userId);

  const { data: trial } = await db
    .from("trials")
    .select("expires_at")
    .eq("user_id", userId)
    .maybeSingle();

  return {
    plan,
    canView: plan !== null,
    canDownload: plan === "download",
    needsPayment: plan !== "download",
    trialEndsAt: plan === "download" ? null : (trial?.expires_at ?? null),
  };
}

/* --------------------------- Single session ---------------------------- */

/** Registers the device that just signed in; older sessions stop working. */
export async function claimSession(userId: string): Promise<string> {
  const db = await admin();
  const sessionId = newToken();
  await db
    .from("profiles")
    .update({ active_session_id: sessionId, active_session_at: new Date().toISOString() })
    .eq("id", userId);
  return sessionId;
}

/** Throws when the caller's device is no longer the active one. */
export async function assertActiveSession(userId: string, sessionId?: string | null) {
  const db = await admin();
  const { data } = await db
    .from("profiles")
    .select("active_session_id")
    .eq("id", userId)
    .maybeSingle();
  const active = data?.active_session_id ?? null;
  if (!active) return;
  if (sessionId !== active) {
    throw new Error("Tu cuenta se abrió en otro dispositivo. Pide un enlace nuevo en el bot.");
  }
}
