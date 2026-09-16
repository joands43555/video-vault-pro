import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/pago-listo")({
  head: () => ({
    meta: [
      { title: "Pago confirmado · Biblioteca de Ejercicios" },
      { name: "description", content: "Tu pago se confirmó. Revisa Telegram para entrar." },
      { property: "og:title", content: "Pago confirmado" },
      { property: "og:description", content: "Tu pago se confirmó. Revisa Telegram para entrar." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <main className="flex min-h-screen items-center justify-center px-6 text-center">
      <div className="max-w-md">
        <CheckCircle2 className="mx-auto size-12 text-primary" />
        <h1 className="mt-6 text-3xl font-bold uppercase">Pago confirmado</h1>
        <p className="mt-3 text-muted-foreground">
          Vuelve al chat del bot en Telegram: ahí te dejamos el botón para abrir tu biblioteca.
        </p>
      </div>
    </main>
  ),
});
