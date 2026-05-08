"use client";

import React from "react";
import { AlertTriangle, BookOpenCheck, Loader2, RefreshCw } from "lucide-react";
import MontageSectionShell from "./MontageSectionShell";

type Level = { code: string; label: string; cycle: string; displayOrder: number };
type Subject = { id: string; code: string; name: string; shortName: string; isHeavy: boolean };
type DefaultSubjectHour = {
  levelCode: string;
  seriesCode?: string | null;
  subjectId: string;
  weeklyUnits: number;
  splitPattern: string;
  isOptional?: boolean;
  roomTypeRequired?: string | null;
  notes?: string;
};

type CatalogResponse =
  | {
      ok: true;
      levels: Level[];
      subjects: Subject[];
      subjectHours: DefaultSubjectHour[];
      totals: { levels: number; subjects: number; subjectHours: number };
    }
  | { ok: false; error: string; message?: string };

export default function MontageVolumesPage() {
  const [data, setData] = React.useState<Extract<CatalogResponse, { ok: true }> | null>(null);
  const [level, setLevel] = React.useState<string>("");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/montage-emploi-du-temps/volumes", {
        cache: "no-store",
      });
      const json = (await res.json().catch(() => null)) as CatalogResponse | null;

      if (!json) {
        setError("Réponse serveur invalide.");
        return;
      }

      if (!json.ok) {
        setError(json.message || json.error);
        return;
      }

      setData(json);
      setLevel((current) => current || json.levels[0]?.code || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de charger le référentiel.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const subjectsById = React.useMemo(() => {
    return new Map((data?.subjects || []).map((subject) => [subject.id, subject]));
  }, [data?.subjects]);

  const rows = React.useMemo(() => {
    if (!data) return [];
    return data.subjectHours
      .filter((item) => item.levelCode === level)
      .map((item) => ({ ...item, subject: subjectsById.get(item.subjectId) || null }))
      .sort((a, b) => {
        const ao = a.subject?.code || a.subjectId;
        const bo = b.subject?.code || b.subjectId;
        return ao.localeCompare(bo);
      });
  }, [data, level, subjectsById]);

  return (
    <MontageSectionShell
      title="Référentiel & services"
      description="Consulter les volumes horaires prédéfinis du modèle HoraClasse avant génération des services. Les volumes ne sont pas inventés : ils viennent du référentiel HoraClasse."
      badge="Référentiel HoraClasse"
      status="Volumes par défaut"
      note="HoraClasse part d’un référentiel de niveaux, matières, volumes hebdomadaires et découpages. L’admin peut ensuite adapter les services, mais le moteur ne crée pas les volumes au hasard."
      cards={[
        {
          title: "Référentiel par défaut",
          description: "Niveaux, matières et volumes horaires sont déjà préconfigurés dans HoraClasse.",
        },
        {
          title: "Services générés",
          description: "Les volumes deviennent des services : classe, matière, volume, découpage, puis professeur.",
        },
        {
          title: "Découpage moteur",
          description: "Le splitPattern indique au moteur comment placer les blocs : 1, 2, 2+1, 2+2, etc.",
        },
      ]}
    >
      <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-black text-slate-950">Catalogue HoraClasse</h2>
            <p className="mt-1 text-sm text-slate-500">
              Affichage des volumes prédéfinis par niveau/série, exactement dans l’esprit HoraClasse.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Recharger
          </button>
        </div>

        {error && (
          <div className="mt-5 rounded-3xl border border-red-200 bg-red-50 p-5 text-red-950">
            <div className="flex gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <p className="font-black">Erreur</p>
                <p className="text-sm">{error}</p>
              </div>
            </div>
          </div>
        )}

        {loading ? (
          <div className="mt-5 flex items-center gap-3 text-sm font-semibold text-slate-600">
            <Loader2 className="h-5 w-5 animate-spin" />
            Chargement du référentiel HoraClasse...
          </div>
        ) : data ? (
          <>
            <div className="mt-6 flex flex-wrap gap-2">
              {data.levels.map((item) => (
                <button
                  key={item.code}
                  type="button"
                  onClick={() => setLevel(item.code)}
                  className={[
                    "rounded-2xl px-4 py-2 text-sm font-black transition",
                    level === item.code
                      ? "bg-slate-950 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-950",
                  ].join(" ")}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="mt-6 overflow-hidden rounded-3xl border border-slate-200">
              <div className="grid grid-cols-[1.1fr_110px_140px_1.3fr] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-500">
                <div>Matière</div>
                <div>Volume</div>
                <div>Découpage</div>
                <div>Notes</div>
              </div>

              <div className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <div
                    key={`${row.levelCode}-${row.seriesCode || ""}-${row.subjectId}`}
                    className="grid grid-cols-[1.1fr_110px_140px_1.3fr] gap-3 px-4 py-3 text-sm"
                  >
                    <div className="flex items-center gap-2 font-bold text-slate-950">
                      <BookOpenCheck className="h-4 w-4 text-emerald-600" />
                      {row.subject?.name || row.subjectId}
                      {row.isOptional ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black uppercase text-amber-700">
                          optionnel
                        </span>
                      ) : null}
                    </div>
                    <div className="font-black text-slate-950">{row.weeklyUnits}h</div>
                    <div className="font-bold text-slate-700">{row.splitPattern}</div>
                    <div className="text-slate-500">{row.notes || row.roomTypeRequired || "—"}</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </MontageSectionShell>
  );
}
