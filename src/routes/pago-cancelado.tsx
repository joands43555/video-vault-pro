import { createFileRoute } from "@tanstack/react-router";
import { XCircle } from "lucide-react";

export const Route = createFileRoute("/pago-cancelado")({
  head: () => ({
    meta: [
      { title: "Pago cancelado · Biblioteca de Ejercicios" },
      { name: "description", content: "El pago se canceló. Puedes intentarlo otra vez en el bot." },
      { property: "og:title", content: "Pago cancelado" },
      { property: "og:description", content: "El pago se canceló. Puedes intentarlo otra vez." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <main className="flex min-h-screen items-center justify-center px-6 text-center">
      <div className="max-w-md">
        <XCircle className="mx-auto size-12 text-muted-foreground" />
        <h1 className="mt-6 text-3xl font-bold uppercase">Pago cancelado</h1>
        <p className="mt-3 text-muted-foreground">
          No se cobró nada. Escribe /start en el bot cuando quieras intentarlo de nuevo.
        </p>
      </div>
    </main>
  ),
});
