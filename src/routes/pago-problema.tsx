import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/pago-problema")({
  head: () => ({
    meta: [
      { title: "Revisaremos tu pago · Biblioteca de Ejercicios" },
      {
        name: "description",
        content: "Hubo un problema al cerrar el pago. Lo revisamos y te avisamos en Telegram.",
      },
      { property: "og:title", content: "Revisaremos tu pago" },
      {
        property: "og:description",
        content: "Hubo un problema al cerrar el pago. Te avisamos en Telegram.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <main className="flex min-h-screen items-center justify-center px-6 text-center">
      <div className="max-w-md">
        <AlertTriangle className="mx-auto size-12 text-accent" />
        <h1 className="mt-6 text-3xl font-bold uppercase">Estamos revisando tu pago</h1>
        <p className="mt-3 text-muted-foreground">
          Si PayPal te cobró, tu acceso se activa solo en unos minutos y el bot te escribe. Si no
          llega, responde en el chat del bot.
        </p>
      </div>
    </main>
  ),
});
