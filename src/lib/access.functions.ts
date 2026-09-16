import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const redeemInput = z.object({ token: z.string().min(20).max(200) });

/**
 * Exchanges the one-time link the bot sent on Telegram for a web session.
 * Public on purpose: the secret is the token itself, and it burns on first use.
 */
export const redeemAccessLink = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => redeemInput.parse(input))
  .handler(async ({ data }) => {
    const { hashToken } = await import("./library.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const tokenHash = hashToken(data.token);
    const { data: link } = await supabaseAdmin
      .from("access_links")
      .select("id, telegram_id, user_id, expires_at, used_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (!link) return { ok: false as const, reason: "Este enlace no es válido." };
    if (link.used_at) return { ok: false as const, reason: "Este enlace ya fue usado." };
    if (new Date(link.expires_at) < new Date())
      return { ok: false as const, reason: "Este enlace ya expiró. Pide uno nuevo en el bot." };

    const email = `tg${link.telegram_id}@telegram.local`;
    let userId = link.user_id;

    if (!userId) {
      const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { telegram_id: link.telegram_id },
      });
      if (createError && !/already/i.test(createError.message)) {
        throw new Error(createError.message);
      }
      if (created?.user) {
        userId = created.user.id;
      } else {
        const { data: existing } = await supabaseAdmin
          .from("profiles")
          .select("id")
          .eq("telegram_id", link.telegram_id)
          .maybeSingle();
        userId = existing?.id ?? null;
      }
    }

    if (!userId) return { ok: false as const, reason: "No pudimos preparar tu cuenta." };

    await supabaseAdmin
      .from("profiles")
      .upsert({ id: userId, telegram_id: link.telegram_id }, { onConflict: "id" });

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("blocked")
      .eq("id", userId)
      .maybeSingle();
    if (profile?.blocked) {
      return { ok: false as const, reason: "Esta cuenta está bloqueada." };
    }

    // Attach any payment that arrived before the account existed.
    await supabaseAdmin
      .from("payments")
      .update({ user_id: userId })
      .eq("telegram_id", link.telegram_id)
      .is("user_id", null);

    const { data: pendingGrants } = await supabaseAdmin
      .from("payments")
      .select("id, plan")
      .eq("telegram_id", link.telegram_id)
      .eq("status", "completed");

    for (const payment of pendingGrants ?? []) {
      const { data: already } = await supabaseAdmin
        .from("entitlements")
        .select("id")
        .eq("user_id", userId)
        .eq("plan", payment.plan)
        .eq("status", "active")
        .maybeSingle();
      if (!already) {
        await supabaseAdmin
          .from("entitlements")
          .insert({ user_id: userId, plan: payment.plan, source: "paypal" });
      }
    }

    // Magic-link OTP verified server-side gives us a real session without a password.
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (linkError || !linkData?.properties?.hashed_token) {
      throw new Error(linkError?.message ?? "No se pudo iniciar la sesión.");
    }

    const { data: session, error: verifyError } = await supabaseAdmin.auth.verifyOtp({
      type: "email",
      token_hash: linkData.properties.hashed_token,
    });
    if (verifyError || !session.session) {
      throw new Error(verifyError?.message ?? "No se pudo iniciar la sesión.");
    }

    await supabaseAdmin
      .from("access_links")
      .update({ used_at: new Date().toISOString(), user_id: userId })
      .eq("id", link.id);

    return {
      ok: true as const,
      access_token: session.session.access_token,
      refresh_token: session.session.refresh_token,
    };
  });
