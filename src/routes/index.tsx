import { createFileRoute, Link } from "@tanstack/react-router";
import { Dumbbell, Download, Eye, Search, ShieldCheck, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Biblioteca de Ejercicios · 1700+ videos guiados" },
      {
        name: "description",
        content:
          "Más de 1700 ejercicios en video con buscador por músculo y equipo. Acceso desde $2 por Telegram.",
      },
      { property: "og:title", content: "Biblioteca de Ejercicios · 1700+ videos guiados" },
      {
        property: "og:description",
        content:
          "Más de 1700 ejercicios en video con buscador por músculo y equipo. Acceso desde $2.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

const plans = [
  {
    icon: Eye,
    name: "Ver en línea",
    price: "2",
    perks: [
      "Los 1700+ ejercicios completos",
      "Buscador por músculo, equipo y dificultad",
      "Reproducción en cualquier dispositivo",
    ],
  },
  {
    icon: Download,
    name: "Ver y descargar",
    price: "10",
    featured: true,
    perks: [
      "Todo lo del plan de $2",
      "Descarga de los archivos originales",
      "Úsalos en tus rutinas y programas",
    ],
  },
];

const features = [
  { icon: Search, title: "Encuentra en segundos", text: "Filtra por músculo, equipo y nivel." },
  { icon: Zap, title: "Acceso inmediato", text: "El bot te abre la biblioteca al confirmar el pago." },
  { icon: ShieldCheck, title: "Acceso personal", text: "Tu entrada es única y sólo tuya." },
];

function Landing() {
  return (
    <main className="min-h-screen">
      <section className="surface-grid border-b border-border">
        <div className="mx-auto max-w-5xl px-6 py-24 text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5 text-xs font-semibold tracking-widest uppercase text-muted-foreground">
            <Dumbbell className="size-3.5" /> 1700+ ejercicios
          </span>
          <h1 className="mt-8 text-5xl leading-[0.95] font-bold uppercase sm:text-7xl">
            La biblioteca de <span className="text-gradient-accent">ejercicios</span> más completa
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
            Cada movimiento en video, organizado por músculo y equipo. Entra por Telegram, paga una
            vez y ábrela cuando quieras.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Button size="lg" asChild>
              <a href="https://t.me" target="_blank" rel="noreferrer">
                Empezar en el bot
              </a>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link to="/biblioteca">Ya pagué, entrar</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 py-20">
        <div className="grid gap-6 sm:grid-cols-3">
          {features.map((feature) => (
            <div key={feature.title} className="rounded-xl border border-border bg-card p-6">
              <feature.icon className="size-6 text-primary" />
              <h3 className="mt-4 text-lg font-semibold">{feature.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{feature.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-6 pb-24">
        <h2 className="text-center text-3xl font-bold uppercase">Elige tu acceso</h2>
        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={
                plan.featured
                  ? "rounded-2xl border border-primary/40 bg-card p-8 shadow-glow"
                  : "rounded-2xl border border-border bg-card p-8"
              }
            >
              <plan.icon className="size-7 text-primary" />
              <h3 className="mt-4 text-2xl font-bold uppercase">{plan.name}</h3>
              <p className="mt-2 text-4xl font-bold">
                ${plan.price}
                <span className="text-base font-normal text-muted-foreground"> pago único</span>
              </p>
              <ul className="mt-6 space-y-2 text-sm text-muted-foreground">
                {plan.perks.map((perk) => (
                  <li key={perk}>• {perk}</li>
                ))}
              </ul>
              <Button
                className="mt-8 w-full"
                variant={plan.featured ? "default" : "outline"}
                asChild
              >
                <a href="https://t.me" target="_blank" rel="noreferrer">
                  Pagar en el bot
                </a>
              </Button>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
