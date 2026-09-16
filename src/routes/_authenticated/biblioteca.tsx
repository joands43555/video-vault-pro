import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Download, Loader2, Lock, Search } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  getDownloadUrl,
  getMyAccess,
  getPlaybackUrl,
  listExercises,
  listFilters,
  type ExerciseCard,
} from "@/lib/library.functions";

export const Route = createFileRoute("/_authenticated/biblioteca")({
  head: () => ({
    meta: [
      { title: "Mi biblioteca de ejercicios" },
      {
        name: "description",
        content: "Busca entre más de 1700 ejercicios en video por músculo, equipo y dificultad.",
      },
      { property: "og:title", content: "Mi biblioteca de ejercicios" },
      {
        property: "og:description",
        content: "Busca entre más de 1700 ejercicios en video por músculo y equipo.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Biblioteca,
});

const ALL = "__all__";

function Biblioteca() {
  const fetchList = useServerFn(listExercises);
  const fetchFilters = useServerFn(listFilters);
  const fetchAccess = useServerFn(getMyAccess);
  const fetchPlayback = useServerFn(getPlaybackUrl);
  const fetchDownload = useServerFn(getDownloadUrl);

  const [search, setSearch] = useState("");
  const [muscle, setMuscle] = useState(ALL);
  const [equipment, setEquipment] = useState(ALL);
  const [page, setPage] = useState(0);
  const [active, setActive] = useState<{ url: string; title: string } | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const access = useQuery({ queryKey: ["access"], queryFn: () => fetchAccess({}) });
  const filters = useQuery({ queryKey: ["filters"], queryFn: () => fetchFilters({}) });
  const list = useQuery({
    queryKey: ["exercises", search, muscle, equipment, page],
    queryFn: () =>
      fetchList({
        data: {
          page,
          ...(search ? { search } : {}),
          ...(muscle !== ALL ? { muscle } : {}),
          ...(equipment !== ALL ? { equipment } : {}),
        },
      }),
  });

  async function play(item: ExerciseCard) {
    setLoadingId(item.id);
    try {
      const result = await fetchPlayback({ data: { id: item.id } });
      setActive({ url: result.url, title: result.title });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo abrir el ejercicio");
    } finally {
      setLoadingId(null);
    }
  }

  async function download(item: ExerciseCard) {
    try {
      const result = await fetchDownload({ data: { id: item.id } });
      window.location.href = result.url;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo descargar");
    }
  }

  const total = list.data?.total ?? 0;
  const pageSize = list.data?.pageSize ?? 48;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <main className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-6 py-4">
          <h1 className="mr-auto text-xl font-bold uppercase">Mi biblioteca</h1>
          <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
            {access.data?.canDownload ? "Plan ver + descargar" : "Plan ver en línea"}
          </span>
        </div>
        <div className="mx-auto flex max-w-6xl flex-wrap gap-3 px-6 pb-4">
          <div className="relative min-w-56 flex-1">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Buscar ejercicio…"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(0);
              }}
            />
          </div>
          <Select
            value={muscle}
            onValueChange={(value) => {
              setMuscle(value);
              setPage(0);
            }}
          >
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Músculo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos los músculos</SelectItem>
              {(filters.data?.muscles ?? []).map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={equipment}
            onValueChange={(value) => {
              setEquipment(value);
              setPage(0);
            }}
          >
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Equipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todo el equipo</SelectItem>
              {(filters.data?.equipment ?? []).map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-8">
        {list.isLoading ? (
          <div className="flex justify-center py-24">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        ) : total === 0 ? (
          <p className="py-24 text-center text-sm text-muted-foreground">
            Todavía no hay ejercicios cargados con esos filtros.
          </p>
        ) : (
          <>
            <p className="mb-4 text-sm text-muted-foreground">{total} ejercicios</p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {(list.data?.items ?? []).map((item) => (
                <article
                  key={item.id}
                  className="flex flex-col rounded-xl border border-border bg-card p-5"
                >
                  <h2 className="text-base font-semibold">{item.title}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {[item.muscle_group, item.equipment, item.difficulty]
                      .filter(Boolean)
                      .join(" · ") || "Sin clasificar"}
                  </p>
                  <div className="mt-4 flex gap-2">
                    <Button size="sm" className="flex-1" onClick={() => play(item)}>
                      {loadingId === item.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        "Ver"
                      )}
                    </Button>
                    {access.data?.canDownload ? (
                      <Button size="sm" variant="outline" onClick={() => download(item)}>
                        <Download className="size-4" />
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          toast.info("La descarga está disponible en el plan de $10.")
                        }
                      >
                        <Lock className="size-4" />
                      </Button>
                    )}
                  </div>
                </article>
              ))}
            </div>

            {pages > 1 && (
              <div className="mt-10 flex items-center justify-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 0}
                  onClick={() => setPage((value) => value - 1)}
                >
                  Anterior
                </Button>
                <span className="text-sm text-muted-foreground">
                  {page + 1} / {pages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page + 1 >= pages}
                  onClick={() => setPage((value) => value + 1)}
                >
                  Siguiente
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      <Dialog open={active !== null} onOpenChange={(open) => !open && setActive(null)}>
        <DialogContent className="max-w-2xl">
          <DialogTitle>{active?.title}</DialogTitle>
          {active && (
            <div
              className="no-select relative overflow-hidden rounded-lg bg-secondary"
              onContextMenu={(event) => event.preventDefault()}
            >
              <img
                src={active.url}
                alt={active.title}
                className="pointer-events-none mx-auto w-full"
                draggable={false}
              />
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs font-semibold tracking-widest text-foreground/25 uppercase">
                {access.data?.watermark}
              </span>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}
