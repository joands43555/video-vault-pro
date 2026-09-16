import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const listInput = z.object({
  search: z.string().max(80).optional(),
  muscle: z.string().max(60).optional(),
  equipment: z.string().max(60).optional(),
  routineId: z.string().uuid().optional(),
  page: z.number().int().min(0).max(200).default(0),
});

export type ExerciseCard = {
  id: string;
  slug: string;
  title: string;
  muscle_group: string | null;
  equipment: string | null;
  difficulty: string | null;
};

/** Signed-in catalogue read. RLS keeps it to published rows. */
export const listExercises = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => listInput.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const pageSize = 48;
    const from = data.page * pageSize;

    let ids: string[] | null = null;
    if (data.routineId) {
      const { data: items, error } = await context.supabase
        .from("routine_exercises")
        .select("exercise_id")
        .eq("routine_id", data.routineId)
        .order("position");
      if (error) throw new Error(error.message);
      ids = (items ?? []).map((row) => row.exercise_id);
      if (ids.length === 0) {
        return { items: [] as ExerciseCard[], total: 0, page: data.page, pageSize };
      }
    }

    let query = context.supabase
      .from("exercises")
      .select("id, slug, title, muscle_group, equipment, difficulty", { count: "exact" })
      .order("title")
      .range(from, from + pageSize - 1);

    if (ids) query = query.in("id", ids);
    if (data.search) query = query.ilike("title", `%${data.search}%`);
    if (data.muscle) query = query.eq("muscle_group", data.muscle);
    if (data.equipment) query = query.eq("equipment", data.equipment);

    const { data: rows, count, error } = await query;
    if (error) throw new Error(error.message);

    return {
      items: (rows ?? []) as ExerciseCard[],
      total: count ?? 0,
      page: data.page,
      pageSize,
    };
  });

/** Distinct filter values so 1700+ items stay navigable. */
export const listFilters = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("exercises")
      .select("muscle_group, equipment")
      .limit(5000);
    if (error) throw new Error(error.message);
    const muscles = new Set<string>();
    const equipment = new Set<string>();
    for (const row of data ?? []) {
      if (row.muscle_group) muscles.add(row.muscle_group);
      if (row.equipment) equipment.add(row.equipment);
    }
    return {
      muscles: [...muscles].sort(),
      equipment: [...equipment].sort(),
    };
  });

/** Ready-made combined routines, e.g. "Pecho y tríceps". */
export const listRoutines = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("routines")
      .select("id, slug, title, description, muscle_focus, level")
      .eq("is_published", true)
      .order("position")
      .order("title");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/** What the signed-in user is allowed to do. */
export const getMyAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getAccessState, FULL_ACCESS_PRICE } = await import("./library.server");
    const state = await getAccessState(context.userId);
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("telegram_username, display_name, telegram_id, blocked")
      .eq("id", context.userId)
      .maybeSingle();
    return {
      ...state,
      price: FULL_ACCESS_PRICE,
      blocked: profile?.blocked ?? false,
      label: profile?.display_name ?? profile?.telegram_username ?? "Miembro",
      watermark: `${profile?.telegram_username ?? profile?.telegram_id ?? "usuario"} · ${context.userId.slice(0, 8)}`,
    };
  });

const idInput = z.object({
  id: z.string().uuid(),
  sessionId: z.string().max(200).optional(),
});

/** Short-lived streaming URL. Never returns a permanent file URL. */
export const getPlaybackUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => idInput.parse(input))
  .handler(async ({ data, context }) => {
    const lib = await import("./library.server");
    const state = await lib.getAccessState(context.userId);
    if (!state.canView) {
      throw new Error(
        `Tu prueba gratis terminó. Desbloquea el acceso permanente por $${lib.FULL_ACCESS_PRICE}.`,
      );
    }

    await lib.assertActiveSession(context.userId, data.sessionId ?? null);
    await lib.assertWithinRateLimit(context.userId, "stream", 400);

    const { data: row, error } = await context.supabase
      .from("exercises")
      .select("id, title, storage_path")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Ejercicio no encontrado.");

    const url = await lib.signStreamUrl(row.storage_path, 120);
    await lib.logAccess({
      user_id: context.userId,
      exercise_id: row.id,
      action: "stream",
      ip: getRequestHeader("x-forwarded-for") ?? null,
      user_agent: getRequestHeader("user-agent") ?? null,
    });
    return { url, title: row.title, expiresInSeconds: 120 };
  });

/** Download URL, gated server-side on the paid access. */
export const getDownloadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => idInput.parse(input))
  .handler(async ({ data, context }) => {
    const lib = await import("./library.server");
    const state = await lib.getAccessState(context.userId);
    if (!state.canDownload) {
      throw new Error(
        `La descarga se activa con el acceso completo de $${lib.FULL_ACCESS_PRICE}.`,
      );
    }

    await lib.assertActiveSession(context.userId, data.sessionId ?? null);
    await lib.assertWithinRateLimit(context.userId, "download", 120);

    const { data: row, error } = await context.supabase
      .from("exercises")
      .select("id, slug, title, storage_path")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Ejercicio no encontrado.");

    const ext = row.storage_path.split(".").pop() ?? "gif";
    const url = await lib.signDownloadUrl(row.storage_path, `${row.slug}.${ext}`, 120);
    await lib.logAccess({
      user_id: context.userId,
      exercise_id: row.id,
      action: "download",
      ip: getRequestHeader("x-forwarded-for") ?? null,
      user_agent: getRequestHeader("user-agent") ?? null,
    });
    return { url };
  });
