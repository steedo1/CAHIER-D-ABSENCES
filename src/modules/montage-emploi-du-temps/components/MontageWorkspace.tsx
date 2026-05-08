"use client";

import React from "react";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Database,
  FileSpreadsheet,
  GraduationCap,
  Loader2,
  RefreshCw,
  School,
  Users,
} from "lucide-react";
import type { MontageBootstrapResponse } from "../types";

function StatCard({
  label,
  value,
  icon: Icon,
  tone = "slate",
}: {
  label: string;
  value: number | string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  tone?: "slate" | "sky" | "emerald" | "amber" | "violet";
}) {
  const toneClasses: Record<typeof tone, string> = {
    slate: "border-slate-200 bg-white text-slate-900",
    sky: "border-sky-100 bg-sky-50 text-sky-950",
    emerald: "border-emerald-100 bg-emerald-50 text-emerald-950",
    amber: "border-amber-100 bg-amber-50 text-amber-950",
    violet: "border-violet-100 bg-violet-50 text-violet-950",
  };

  return (
    <div className={`rounded-3xl border p-5 shadow-sm ${toneClasses[tone]}`}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium opacity-70">{label}</p>
          <p className="mt-2 text-3xl font-black tracking-tight">{value}</p>
        </div>
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/70 shadow-sm ring-1 ring-black/5">
          <Icon className="h-6 w-6" />
        </div>
      </div>
    </div>
  );
}

export default function MontageWorkspace() {
  const [data, setData] = React.useState<MontageBootstrapResponse | null>(null);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    setLoading(true);

    try {
      const res = await fetch("/api/admin/montage-emploi-du-temps/bootstrap", {
        cache: "no-store",
      });

      const json = (await res.json().catch(() => null)) as MontageBootstrapResponse | null;

      if (!json) {
        setData({
          ok: false,
          error: "invalid_response",
          message: "Réponse serveur invalide.",
        });
        return;
      }

      setData(json);
    } catch (error) {
      setData({
        ok: false,
        error: "network_error",
        message:
          error instanceof Error
            ? error.message
            : "Impossible de charger les données.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const isReady = data?.ok === true;

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-7xl space-y-6">
        <div className="overflow-hidden rounded-[32px] border border-slate-200 bg-slate-950 shadow-xl">
          <div className="relative p-6 sm:p-8">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.22),transparent_34%),radial-gradient(circle_at_bottom_left,rgba(16,185,129,0.18),transparent_32%)]" />

            <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-sky-100">
                  <CalendarDays className="h-4 w-4" />
                  Module intelligent
                </div>

                <h1 className="mt-5 text-3xl font-black tracking-tight text-white sm:text-4xl">
                  Montage emploi du temps
                </h1>

                <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
                  Préparation du nouveau module de montage intelligent connecté aux données
                  de Mon Cahier : classes, enseignants, matières, affectations et créneaux.
                </p>
              </div>

              <button
                type="button"
                onClick={() => void load()}
                disabled={loading}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-bold text-slate-950 shadow-lg transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Recharger les données
              </button>
            </div>
          </div>
        </div>

        {loading && (
          <div className="flex items-center gap-3 rounded-3xl border border-slate-200 bg-white p-5 text-sm font-semibold text-slate-700 shadow-sm">
            <Loader2 className="h-5 w-5 animate-spin" />
            Chargement des données de l’établissement...
          </div>
        )}

        {!loading && data && !data.ok && (
          <div className="rounded-3xl border border-red-200 bg-red-50 p-5 text-red-950 shadow-sm">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <p className="font-black">Impossible de charger le module.</p>
                <p className="mt-1 text-sm">{data.message || data.error}</p>
              </div>
            </div>
          </div>
        )}

        {isReady && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <StatCard
                label="Classes"
                value={data.classes.length}
                icon={School}
                tone="sky"
              />
              <StatCard
                label="Matières"
                value={data.subjects.length}
                icon={GraduationCap}
                tone="violet"
              />
              <StatCard
                label="Enseignants"
                value={data.teachers.length}
                icon={Users}
                tone="emerald"
              />
              <StatCard
                label="Créneaux"
                value={data.periods.length}
                icon={CalendarDays}
                tone="amber"
              />
              <StatCard
                label="Affectations"
                value={data.affectations.length}
                icon={Database}
                tone="slate"
              />
            </div>

            <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
                    <CheckCircle2 className="h-6 w-6" />
                  </div>
                  <div>
                    <h2 className="text-lg font-black">
                      Données Mon Cahier détectées
                    </h2>
                    <p className="text-sm text-slate-500">
                      Le module lit les données existantes sans modifier les appels,
                      les absences ou les notes.
                    </p>
                  </div>
                </div>

                <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200">
                  <div className="grid grid-cols-3 bg-slate-50 px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-500">
                    <div>Enseignant</div>
                    <div>Matière</div>
                    <div>Classe</div>
                  </div>

                  <div className="max-h-[360px] divide-y divide-slate-100 overflow-auto">
                    {data.affectations.slice(0, 80).map((item, index) => (
                      <div
                        key={`${item.teacher_id}-${item.subject_id}-${item.class_id}-${index}`}
                        className="grid grid-cols-3 gap-3 px-4 py-3 text-sm"
                      >
                        <div className="truncate font-semibold text-slate-900">
                          {item.teacher_name}
                        </div>
                        <div className="truncate text-slate-600">
                          {item.subject_label}
                        </div>
                        <div className="truncate font-semibold text-slate-700">
                          {item.class_label}
                        </div>
                      </div>
                    ))}

                    {data.affectations.length === 0 && (
                      <div className="px-4 py-8 text-center text-sm text-slate-500">
                        Aucune affectation active détectée pour le moment.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-50 text-sky-700 ring-1 ring-sky-100">
                    <FileSpreadsheet className="h-6 w-6" />
                  </div>
                  <div>
                    <h2 className="text-lg font-black">Prochaine étape</h2>
                    <p className="text-sm text-slate-500">
                      Brancher le moteur de montage puis publier uniquement après
                      validation administrative.
                    </p>
                  </div>
                </div>

                <div className="mt-6 space-y-3 text-sm">
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="font-bold text-slate-900">1. Bootstrap</p>
                    <p className="mt-1 text-slate-600">
                      Chargement des classes, enseignants, matières, créneaux et
                      affectations.
                    </p>
                  </div>

                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="font-bold text-slate-900">2. Génération</p>
                    <p className="mt-1 text-slate-600">
                      Le moteur sera intégré dans un module isolé, sans toucher aux
                      tables sensibles.
                    </p>
                  </div>

                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="font-bold text-slate-900">3. Publication</p>
                    <p className="mt-1 text-slate-600">
                      Le résultat validé alimentera ensuite les emplois du temps
                      officiels de Mon Cahier.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
