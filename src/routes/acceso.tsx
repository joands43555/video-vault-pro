import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { z } from "zod";

import { redeemAccessLink } from "@/lib/access.functions";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/acceso")({
  ssr: false,
  validateSearch: z.object({ token: z.string().optional() }),
  head: () => ({
    meta: [
      { title: "Abriendo tu biblioteca · Ejercicios" },
      { name: "description", content: "Validando tu acceso personal a la biblioteca." },
      { property: "og:title", content: "Abriendo tu biblioteca" },
      { property: "og:description", content: "Validando tu acceso personal a la biblioteca." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Acceso,
});

function Acceso() {
  const { token } = Route.useSearch();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!token) {
        setError("Falta el enlace de acceso. Pide uno nuevo en el bot con /biblioteca.");
        return;
      }
      try {
        const result = await redeemAccessLink({ data: { token } });
        if (cancelled) return;
        if (!result.ok) {
          setError(result.reason);
          return;
        }
        await supabase.auth.setSession({
          access_token: result.access_token,
          refresh_token: result.refresh_token,
        });
        navigate({ to: "/biblioteca", replace: true });
      } catch {
        if (!cancelled) setError("No pudimos abrir tu sesión. Pide un enlace nuevo en el bot.");
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [token, navigate]);

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-sm text-center">
        {error ? (
          <>
            <h1 className="text-2xl font-bold">No pudimos abrir tu biblioteca</h1>
            <p className="mt-3 text-sm text-muted-foreground">{error}</p>
          </>
        ) : (
          <>
            <Loader2 className="mx-auto size-8 animate-spin text-primary" />
            <p className="mt-4 text-sm text-muted-foreground">Validando tu acceso…</p>
          </>
        )}
      </div>
    </main>
  );
}
