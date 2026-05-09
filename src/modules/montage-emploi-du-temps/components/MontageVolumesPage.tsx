"use client";

import React from "react";
import {
  AlertTriangle,
  BookOpenCheck,
  CheckCircle2,
  DatabaseZap,
  Loader2,
  RefreshCw,
  Save,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import MontageSectionShell from "./MontageSectionShell";

type Level = { code: string; label: string; cycle: string; displayOrder: number };
type CatalogSubject = { id: string; code: string; name: string; shortName: string; isHeavy: boolean };

type ServiceAssignment = {
  class_id: string;
  class_label: string;
  level_code: string;
  series_code: string | null;
  teacher_id: string;
  teacher_name: string;
  subject_id: string;
  subject_label: string;
  subject_code: string | null;
  catalog_subject_id: string;
  catalog_subject_label: string;
  weekly_units: number | null;
  split_pattern: string | null;
  room_type_required: string | null;
  source: "default_catalog" | "override" | "manual_missing_catalog";
  is_ready: boolean;
  missing_reason: string | null;
};

type CatalogCoverageSubject = {
  catalog_subject_id: string;
  code: string;
  name: string;
  short_name: string;
  exists_in_mon_cahier: boolean;
  institution_subject_id: string | null;
  institution_subject_label: string | null;
  institution_subject_code: string | null;
};

type VolumesTotals = {
  services: number;
  ready: number;
  missing: number;
  customized: number;
  mon_cahier_subjects: number;
  catalog_subjects: number;
  catalog_subjects_missing_in_mon_cahier: number;
};

type VolumesResponse =
  | {
      ok: true;
      source: string;
      message: string;
      levels: Level[];
      catalog_subjects: CatalogSubject[];
      service_assignments: ServiceAssignment[];
      catalog_coverage: CatalogCoverageSubject[];
      missing_catalog_subjects: CatalogCoverageSubject[];
      totals: VolumesTotals;
      warnings: string[];
    }
  | { ok: false; error: string; message?: string };

type EditState = {
  key: string;
  weekly_units: string;
  split_pattern: string;
  room_type_required: string;
};

function serviceKey(row: ServiceAssignment) {
  return `${row.class_id}:${row.subject_id}:${row.teacher_id}`;
}

function formatHours(value: number | null) {
  if (value === null || value === undefined) return "À compléter";
  if (Number.isInteger(value)) return `${value}h`;
  return `${String(value).replace(".", ",")}h`;
}

function sourceLabel(source: ServiceAssignment["source"]) {
  if (source === "override") return "Personnalisé Mon Cahier";
  if (source === "default_catalog") return "Référentiel HoraClasse";
  return "Manuel requis";
}

function sourceClass(source: ServiceAssignment["source"]) {
  if (source === "override") return "bg-indigo-50 text-indigo-700 border-indigo-100";
  if (source === "default_catalog") return "bg-emerald-50 text-emerald-700 border-emerald-100";
  return "bg-amber-50 text-amber-700 border-amber-100";
}

export default function MontageVolumesPage() {
  const [data, setData] = React.useState<Extract<VolumesResponse, { ok: true }> | null>(null);
  const [classFilter, setClassFilter] = React.useState("all");
  const [statusFilter, setStatusFilter] = React.useState<"all" | "ready" | "missing" | "override">("all");
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [edit, setEdit] = React.useState<EditState | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/montage-emploi-du-temps/volumes", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as VolumesResponse | null;

      if (!json) {
        setError("Réponse serveur invalide.");
        return;
      }

      if (json.ok !== true) {
        setError(json.message || json.error);
        return;
      }

      setData(json);
      setClassFilter((current) => current || "all");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de charger les volumes.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const classes = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const row of data?.service_assignments || []) {
      map.set(row.class_id, row.class_label);
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1], "fr"));
  }, [data?.service_assignments]);

  const rows = React.useMemo(() => {
    let next = [...(data?.service_assignments || [])];

    if (classFilter !== "all") {
      next = next.filter((row) => row.class_id === classFilter);
    }

    if (statusFilter === "ready") next = next.filter((row) => row.is_ready);
    if (statusFilter === "missing") next = next.filter((row) => !row.is_ready);
    if (statusFilter === "override") next = next.filter((row) => row.source === "override");

    return next.sort((a, b) => {
      const classDelta = a.class_label.localeCompare(b.class_label, "fr");
      if (classDelta !== 0) return classDelta;
      return a.subject_label.localeCompare(b.subject_label, "fr");
    });
  }, [classFilter, data?.service_assignments, statusFilter]);

  function beginEdit(row: ServiceAssignment) {
    setEdit({
      key: serviceKey(row),
      weekly_units: row.weekly_units ? String(row.weekly_units).replace(".", ",") : "",
      split_pattern: row.split_pattern || "",
      room_type_required: row.room_type_required || "",
    });
  }

  async function postAction(payload: Record<string, unknown>) {
    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const res = await fetch("/api/admin/montage-emploi-du-temps/volumes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; message?: string; error?: string } | null;

      if (!json?.ok) {
        throw new Error(json?.message || json?.error || "Action impossible.");
      }

      setNotice(json.message || "Action effectuée.");
      setEdit(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit(row: ServiceAssignment) {
    if (!edit) return;
    await postAction({
      action: "save_override",
      class_id: row.class_id,
      subject_id: row.subject_id,
      teacher_id: row.teacher_id,
      weekly_units: edit.weekly_units,
      split_pattern: edit.split_pattern,
      room_type_required: edit.room_type_required || null,
    });
  }

  async function deleteOverride(row: ServiceAssignment) {
    await postAction({
      action: "delete_override",
      class_id: row.class_id,
      subject_id: row.subject_id,
      teacher_id: row.teacher_id,
    });
  }

  async function syncMissingSubjects() {
    if (!data?.missing_catalog_subjects.length) return;
    const ok = window.confirm(
      "Ajouter dans Mon Cahier les matières HoraClasse manquantes ? Les matières existantes ne seront ni renommées ni supprimées.",
    );
    if (!ok) return;
    await postAction({ action: "sync_missing_subjects" });
  }

  const totals = data?.totals;

  return (
    <MontageSectionShell
      title="Référentiel & services"
      description="Mon Cahier garde ses matières officielles. HoraClasse reconnaît ces matières, complète les volumes horaires et signale uniquement ce qui doit être renseigné."
      badge="Mon Cahier + HoraClasse"
      status="Source officielle : Mon Cahier"
      note="Aucune deuxième vérité : classes, matières, enseignants et affectations viennent de Mon Cahier. Le référentiel HoraClasse sert seulement à enrichir les volumes, découpages et règles métier."
      cards={[
        {
          title: "Matières officielles",
          description: "Les matières créées par l’admin dans Mon Cahier restent prioritaires.",
        },
        {
          title: "Reconnaissance silencieuse",
          description: "Mathématiques, PC, SVT, FR, HG, ANG, EPS, EDHC, Philo, LV2, Arts, Musique, TICE sont reconnus automatiquement.",
        },
        {
          title: "Volumes maîtrisés",
          description: "Un volume personnalisé Mon Cahier écrase le volume par défaut HoraClasse pour le service concerné.",
        },
      ]}
    >
      <div className="space-y-5">
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-xl font-black text-slate-950">Services réels de Mon Cahier</h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
                Cette page ne montre plus un catalogue isolé. Elle vérifie les vrais couples classe–matière–enseignant de Mon Cahier et leur applique la logique HoraClasse.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void syncMissingSubjects()}
                disabled={saving || loading || !data?.missing_catalog_subjects.length}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <DatabaseZap className="h-4 w-4" />}
                Compléter les matières
              </button>

              <button
                type="button"
                onClick={() => void load()}
                disabled={loading || saving}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Recharger
              </button>
            </div>
          </div>

          {totals ? (
            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <div className="rounded-3xl bg-slate-50 p-4">
                <p className="text-xs font-black uppercase tracking-wide text-slate-400">Services</p>
                <p className="mt-1 text-2xl font-black text-slate-950">{totals.services}</p>
              </div>
              <div className="rounded-3xl bg-emerald-50 p-4">
                <p className="text-xs font-black uppercase tracking-wide text-emerald-600">Prêts</p>
                <p className="mt-1 text-2xl font-black text-emerald-800">{totals.ready}</p>
              </div>
              <div className="rounded-3xl bg-amber-50 p-4">
                <p className="text-xs font-black uppercase tracking-wide text-amber-600">À compléter</p>
                <p className="mt-1 text-2xl font-black text-amber-800">{totals.missing}</p>
              </div>
              <div className="rounded-3xl bg-indigo-50 p-4">
                <p className="text-xs font-black uppercase tracking-wide text-indigo-600">Personnalisés</p>
                <p className="mt-1 text-2xl font-black text-indigo-800">{totals.customized}</p>
              </div>
              <div className="rounded-3xl bg-rose-50 p-4">
                <p className="text-xs font-black uppercase tracking-wide text-rose-600">Matières manquantes</p>
                <p className="mt-1 text-2xl font-black text-rose-800">{totals.catalog_subjects_missing_in_mon_cahier}</p>
              </div>
            </div>
          ) : null}

          {notice && (
            <div className="mt-5 rounded-3xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800">
              <div className="flex gap-3">
                <CheckCircle2 className="h-5 w-5 shrink-0" />
                <p>{notice}</p>
              </div>
            </div>
          )}

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

          {data?.warnings?.length ? (
            <div className="mt-5 rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-black">Points à vérifier</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {data.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="h-5 w-5 text-slate-500" />
              <h3 className="font-black text-slate-950">Filtrer les services</h3>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <select
                value={classFilter}
                onChange={(event) => setClassFilter(event.target.value)}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:border-slate-400"
              >
                <option value="all">Toutes les classes</option>
                {classes.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>

              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:border-slate-400"
              >
                <option value="all">Tous les statuts</option>
                <option value="ready">Services prêts</option>
                <option value="missing">À compléter</option>
                <option value="override">Personnalisés</option>
              </select>
            </div>
          </div>

          {loading ? (
            <div className="mt-6 flex items-center gap-3 rounded-3xl bg-slate-50 p-5 text-sm font-semibold text-slate-600">
              <Loader2 className="h-5 w-5 animate-spin" />
              Chargement des services Mon Cahier enrichis par HoraClasse...
            </div>
          ) : rows.length === 0 ? (
            <div className="mt-6 rounded-3xl bg-slate-50 p-5 text-sm font-semibold text-slate-500">
              Aucun service ne correspond au filtre actuel.
            </div>
          ) : (
            <div className="mt-6 overflow-hidden rounded-3xl border border-slate-200">
              <div className="hidden grid-cols-[1fr_1fr_1.1fr_120px_140px_170px_150px] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-500 xl:grid">
                <div>Classe</div>
                <div>Matière Mon Cahier</div>
                <div>Enseignant</div>
                <div>Volume</div>
                <div>Découpage</div>
                <div>Origine</div>
                <div>Action</div>
              </div>

              <div className="divide-y divide-slate-100">
                {rows.map((row) => {
                  const key = serviceKey(row);
                  const isEditing = edit?.key === key;

                  return (
                    <div key={key} className="grid gap-3 px-4 py-4 text-sm xl:grid-cols-[1fr_1fr_1.1fr_120px_140px_170px_150px] xl:items-center">
                      <div>
                        <p className="text-xs font-black uppercase text-slate-400 xl:hidden">Classe</p>
                        <p className="font-black text-slate-950">{row.class_label}</p>
                        <p className="text-xs font-semibold text-slate-400">{row.level_code}</p>
                      </div>

                      <div>
                        <p className="text-xs font-black uppercase text-slate-400 xl:hidden">Matière</p>
                        <div className="flex items-center gap-2 font-bold text-slate-950">
                          <BookOpenCheck className="h-4 w-4 text-emerald-600" />
                          <span>{row.subject_label}</span>
                        </div>
                        <p className="mt-1 text-xs font-semibold text-slate-400">
                          Reconnu HoraClasse : {row.catalog_subject_label}
                        </p>
                      </div>

                      <div>
                        <p className="text-xs font-black uppercase text-slate-400 xl:hidden">Enseignant</p>
                        <p className="font-bold text-slate-700">{row.teacher_name}</p>
                      </div>

                      <div>
                        <p className="text-xs font-black uppercase text-slate-400 xl:hidden">Volume</p>
                        {isEditing ? (
                          <input
                            value={edit.weekly_units}
                            onChange={(event) => setEdit({ ...edit, weekly_units: event.target.value })}
                            placeholder="ex: 4"
                            className="w-full rounded-2xl border border-slate-200 px-3 py-2 font-bold outline-none focus:border-slate-400"
                          />
                        ) : (
                          <p className={row.is_ready ? "font-black text-slate-950" : "font-black text-amber-700"}>
                            {formatHours(row.weekly_units)}
                          </p>
                        )}
                      </div>

                      <div>
                        <p className="text-xs font-black uppercase text-slate-400 xl:hidden">Découpage</p>
                        {isEditing ? (
                          <input
                            value={edit.split_pattern}
                            onChange={(event) => setEdit({ ...edit, split_pattern: event.target.value })}
                            placeholder="ex: 2+1+1"
                            className="w-full rounded-2xl border border-slate-200 px-3 py-2 font-bold outline-none focus:border-slate-400"
                          />
                        ) : (
                          <p className="font-bold text-slate-700">{row.split_pattern || "—"}</p>
                        )}
                      </div>

                      <div>
                        <p className="text-xs font-black uppercase text-slate-400 xl:hidden">Origine</p>
                        <span className={["inline-flex rounded-full border px-3 py-1 text-xs font-black", sourceClass(row.source)].join(" ")}>
                          {sourceLabel(row.source)}
                        </span>
                        {row.missing_reason ? <p className="mt-2 text-xs font-semibold text-amber-700">{row.missing_reason}</p> : null}
                        {isEditing ? (
                          <input
                            value={edit.room_type_required}
                            onChange={(event) => setEdit({ ...edit, room_type_required: event.target.value })}
                            placeholder="Salle spéciale optionnelle"
                            className="mt-2 w-full rounded-2xl border border-slate-200 px-3 py-2 text-xs font-bold outline-none focus:border-slate-400"
                          />
                        ) : null}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {isEditing ? (
                          <>
                            <button
                              type="button"
                              onClick={() => void saveEdit(row)}
                              disabled={saving}
                              className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
                            >
                              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                              OK
                            </button>
                            <button
                              type="button"
                              onClick={() => setEdit(null)}
                              disabled={saving}
                              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-3 py-2 text-xs font-black text-slate-600 disabled:opacity-50"
                            >
                              <X className="h-4 w-4" />
                              Annuler
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => beginEdit(row)}
                              disabled={saving}
                              className="rounded-2xl border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                            >
                              Modifier
                            </button>
                            {row.source === "override" ? (
                              <button
                                type="button"
                                onClick={() => void deleteOverride(row)}
                                disabled={saving}
                                className="inline-flex items-center gap-1 rounded-2xl border border-red-100 bg-red-50 px-3 py-2 text-xs font-black text-red-700 disabled:opacity-50"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Reset
                              </button>
                            ) : null}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {data?.missing_catalog_subjects?.length ? (
          <div className="rounded-[28px] border border-rose-100 bg-rose-50 p-5 text-rose-950">
            <h3 className="font-black">Matières HoraClasse pas encore activées dans Mon Cahier</h3>
            <p className="mt-1 text-sm text-rose-800">
              Elles peuvent être ajoutées sans modifier les matières déjà utilisées par les notes, absences et emplois du temps.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {data.missing_catalog_subjects.map((item) => (
                <span key={item.catalog_subject_id} className="rounded-full bg-white px-3 py-1 text-xs font-black text-rose-700 shadow-sm">
                  {item.short_name || item.name}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </MontageSectionShell>
  );
}
