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
