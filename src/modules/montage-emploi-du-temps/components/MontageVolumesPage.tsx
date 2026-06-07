"use client";

import Link from "next/link";
import React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  DatabaseZap,
  Layers3,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import MontageSectionShell from "./MontageSectionShell";

type Level = { code: string; label: string; cycle: string; displayOrder: number };

type SubjectHourRow = {
  key: string;
  level_code: string;
  level_label: string;
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
  has_mixed_values: boolean;
  services_count: number;
  classes_count: number;
  teachers_count: number;
  class_labels: string[];
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
  subject_hour_rows: number;
  subject_hour_rows_ready: number;
  subject_hour_rows_missing: number;
};

type VolumesResponse =
  | {
      ok: true;
      message: string;
      levels: Level[];
      subject_hour_rows: SubjectHourRow[];
      missing_catalog_subjects: CatalogCoverageSubject[];
      totals: VolumesTotals;
      warnings: string[];
    }
  | { ok: false; error: string; message?: string };

type Draft = {
  weekly_units: string;
  split_pattern: string;
  room_type_required: string;
};

type DraftsByKey = Record<string, Draft>;

function toDraft(row: SubjectHourRow): Draft {
  return {
    weekly_units: row.weekly_units ? String(row.weekly_units).replace(".", ",") : "",
    split_pattern: row.split_pattern || "",
    room_type_required: row.room_type_required || "",
  };
}

function buildDrafts(rows: SubjectHourRow[]): DraftsByKey {
  return rows.reduce<DraftsByKey>((acc, row) => {
    acc[row.key] = toDraft(row);
    return acc;
  }, {});
}

function formatHours(value: number | null) {
  if (value === null || value === undefined) return "À compléter";

  const hours = Math.floor(value);
  const minutes = Math.round((value - hours) * 60);

  if (minutes === 0) return `${hours}h`;
  if (hours === 0) return `${minutes} min`;
  return `${hours}h${String(minutes).padStart(2, "0")}`;
}

function formatSplitPattern(pattern: string | null) {
  if (!pattern) return "—";

  return pattern
    .split("+")
    .map((part) => {
      const value = Number(part.trim().replace(",", "."));
      if (!Number.isFinite(value)) return part.trim();
      return formatHours(value);
    })
    .join(" + ");
}

function sourceLabel(row: SubjectHourRow) {
  if (row.source === "override") return row.has_mixed_values ? "Personnalisé mixte" : "Personnalisé";
  if (row.source === "default_catalog") return "Référentiel";
  return "À compléter";
}

function sourceClass(row: SubjectHourRow) {
  if (row.source === "override") return "bg-indigo-50 text-indigo-700 ring-indigo-100";
  if (row.source === "default_catalog") return "bg-emerald-50 text-emerald-700 ring-emerald-100";
  return "bg-amber-50 text-amber-700 ring-amber-100";
}

function isDraftChanged(row: SubjectHourRow, draft?: Draft) {
  if (!draft) return false;
  const original = toDraft(row);
  return (
    draft.weekly_units.trim() !== original.weekly_units.trim() ||
    draft.split_pattern.trim() !== original.split_pattern.trim() ||
    draft.room_type_required.trim() !== original.room_type_required.trim()
  );
}

function StatCard({ label, value, tone }: { label: string; value: string | number; tone: "slate" | "emerald" | "amber" | "indigo" | "rose" }) {
  const tones: Record<typeof tone, string> = {
    slate: "border-slate-200 bg-slate-50 text-slate-950",
    emerald: "border-emerald-100 bg-emerald-50 text-emerald-800",
    amber: "border-amber-100 bg-amber-50 text-amber-800",
    indigo: "border-indigo-100 bg-indigo-50 text-indigo-800",
    rose: "border-rose-100 bg-rose-50 text-rose-800",
  };

  return (
    <div className={`rounded-3xl border p-4 ${tones[tone]}`}>
      <p className="text-xs font-black uppercase tracking-wide opacity-70">{label}</p>
      <p className="mt-1 text-2xl font-black">{value}</p>
    </div>
  );
}

export default function MontageVolumesPage() {
  const [data, setData] = React.useState<Extract<VolumesResponse, { ok: true }> | null>(null);
  const [levelFilter, setLevelFilter] = React.useState("all");
  const [statusFilter, setStatusFilter] = React.useState<"all" | "ready" | "missing" | "override">("all");
  const [query, setQuery] = React.useState("");
  const [drafts, setDrafts] = React.useState<DraftsByKey>({});
  const [loading, setLoading] = React.useState(true);
  const [savingKey, setSavingKey] = React.useState<string | null>(null);
  const [savingAction, setSavingAction] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

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
      setDrafts(buildDrafts(json.subject_hour_rows || []));
      setLevelFilter((current) => current || "all");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de charger les matières et heures.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const rows = React.useMemo(() => {
    let next = [...(data?.subject_hour_rows || [])];
    const q = query.trim().toLowerCase();

    if (levelFilter !== "all") next = next.filter((row) => row.level_code === levelFilter);
    if (statusFilter === "ready") next = next.filter((row) => row.is_ready);
    if (statusFilter === "missing") next = next.filter((row) => !row.is_ready);
    if (statusFilter === "override") next = next.filter((row) => row.source === "override");
    if (q) {
      next = next.filter((row) => {
        return [row.subject_label, row.subject_code, row.catalog_subject_label, row.level_label]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q);
      });
    }

    return next;
  }, [data?.subject_hour_rows, levelFilter, query, statusFilter]);

  const availableLevels = React.useMemo(() => {
    const used = new Set((data?.subject_hour_rows || []).map((row) => row.level_code));
    return (data?.levels || []).filter((level) => used.has(level.code));
  }, [data?.levels, data?.subject_hour_rows]);

  function updateDraft(key: string, patch: Partial<Draft>) {
    setDrafts((current) => ({
      ...current,
      [key]: {
        weekly_units: current[key]?.weekly_units || "",
        split_pattern: current[key]?.split_pattern || "",
        room_type_required: current[key]?.room_type_required || "",
        ...patch,
      },
    }));
  }

  async function postAction(payload: Record<string, unknown>, key?: string) {
    if (key) setSavingKey(key);
    else setSavingAction(true);
    setError(null);
    setNotice(null);

    try {
      const res = await fetch("/api/admin/montage-emploi-du-temps/volumes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; message?: string; error?: string } | null;

      if (!json?.ok) throw new Error(json?.message || json?.error || "Action impossible.");

      setNotice(json.message || "Action effectuée.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action impossible.");
    } finally {
      if (key) setSavingKey(null);
      else setSavingAction(false);
    }
  }

  async function saveRow(row: SubjectHourRow) {
    const draft = drafts[row.key] || toDraft(row);
    await postAction(
      {
        action: "save_subject_level_volume",
        level_code: row.level_code,
        subject_id: row.subject_id,
        catalog_subject_id: row.catalog_subject_id,
        weekly_units: draft.weekly_units,
        split_pattern: draft.split_pattern,
        room_type_required: draft.room_type_required || null,
      },
      row.key,
    );
  }

  async function resetRow(row: SubjectHourRow) {
    await postAction(
      {
        action: "reset_subject_level_volume",
        level_code: row.level_code,
        subject_id: row.subject_id,
        catalog_subject_id: row.catalog_subject_id,
      },
      row.key,
    );
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
      title="Référentiels et services"
      description="Centraliser les référentiels utiles au montage : matières et heures, créneaux officiels et vérification des services enseignants, sans recréer les données Mon Cahier."
      badge="Référentiels Mon Cahier"
      status="Mon Cahier source officielle"
      note="Les matières affichées viennent des matières et affectations existantes de Mon Cahier. Cette page règle les volumes par niveau et matière ; les professeurs restent consultables dans Services enseignants."
      cards={[
        { title: "Matières et heures", description: "Les volumes et découpages se règlent ici par niveau et matière." },
        { title: "Créneaux officiels", description: "Les horaires restent ceux de institution_periods, sans créneaux parallèles." },
        { title: "Services enseignants", description: "Les affectations sont lues depuis Mon Cahier et vérifiées avant génération." },
      ]}
    >
      <div className="space-y-5">
        <div className="grid gap-3 md:grid-cols-2">
          <Link href="/admin/montage-emploi-du-temps/creneaux" className="rounded-3xl border border-slate-200 bg-white p-5 text-sm font-bold text-slate-800 shadow-sm transition hover:bg-slate-50">
            Voir les créneaux officiels Mon Cahier
          </Link>
          <Link href="/admin/montage-emploi-du-temps/services" className="rounded-3xl border border-slate-200 bg-white p-5 text-sm font-bold text-slate-800 shadow-sm transition hover:bg-slate-50">
            Vérifier les services enseignants détectés
          </Link>
        </div>
        <div className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-600">Référentiel HoraClasse</p>
              <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-950">Volumes par niveau et matière</h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
                On affiche la matière, le volume actuel, le nouveau volume et le découpage. Les enseignants ne sont pas affichés ici.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void syncMissingSubjects()}
                disabled={savingAction || loading || !data?.missing_catalog_subjects.length}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {savingAction ? <Loader2 className="h-4 w-4 animate-spin" /> : <DatabaseZap className="h-4 w-4" />}
                Compléter matières manquantes
              </button>

              <button
                type="button"
                onClick={() => void load()}
                disabled={loading || savingAction || Boolean(savingKey)}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Recharger
              </button>
            </div>
          </div>

          {totals ? (
            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <StatCard label="Matières/niveaux" value={totals.subject_hour_rows} tone="slate" />
              <StatCard label="Prêts" value={totals.subject_hour_rows_ready} tone="emerald" />
              <StatCard label="À compléter" value={totals.subject_hour_rows_missing} tone="amber" />
              <StatCard label="Services liés" value={totals.services} tone="indigo" />
              <StatCard label="Matières à ajouter" value={totals.catalog_subjects_missing_in_mon_cahier} tone="rose" />
            </div>
          ) : null}

          <div className="mt-5 grid gap-3 rounded-3xl border border-slate-200 bg-slate-50/70 p-4 lg:grid-cols-[1fr_1fr_1.4fr]">
            <label className="text-sm font-black text-slate-700">
              <span className="mb-2 flex items-center gap-2"><SlidersHorizontal className="h-4 w-4" /> Niveau à afficher</span>
              <select
                value={levelFilter}
                onChange={(event) => setLevelFilter(event.target.value)}
                className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
              >
                <option value="all">Tous les niveaux</option>
                {availableLevels.map((level) => (
                  <option key={level.code} value={level.code}>{level.label}</option>
                ))}
              </select>
            </label>

            <label className="text-sm font-black text-slate-700">
              <span className="mb-2 block">Statut</span>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
                className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
              >
                <option value="all">Tous les statuts</option>
                <option value="ready">Prêts</option>
                <option value="missing">À compléter</option>
                <option value="override">Personnalisés</option>
              </select>
            </label>

            <label className="text-sm font-black text-slate-700">
              <span className="mb-2 flex items-center gap-2"><Search className="h-4 w-4" /> Rechercher une matière</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Maths, EPS, Français..."
                className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
              />
            </label>
          </div>

          {notice && (
            <div className="mt-5 rounded-3xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800">
              <div className="flex gap-3"><CheckCircle2 className="h-5 w-5 shrink-0" /><p>{notice}</p></div>
            </div>
          )}

          {error && (
            <div className="mt-5 rounded-3xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800">
              <div className="flex gap-3"><AlertTriangle className="h-5 w-5 shrink-0" /><p>{error}</p></div>
            </div>
          )}

          {loading ? (
            <div className="mt-6 flex items-center gap-3 rounded-3xl border border-slate-200 bg-slate-50 p-6 text-sm font-bold text-slate-600">
              <Loader2 className="h-5 w-5 animate-spin" /> Chargement des matières et heures...
            </div>
          ) : (
            <div className="mt-6 overflow-hidden rounded-[28px] border border-slate-200 bg-white">
              <div className="grid grid-cols-[1.3fr_1fr_1fr_1.1fr_1.1fr_1fr] gap-3 bg-slate-950 px-4 py-3 text-xs font-black uppercase tracking-wide text-white">
                <div>Matière</div>
                <div>Volume actuel</div>
                <div>Nouveau volume</div>
                <div>Découpage</div>
                <div>Type / statut</div>
                <div className="text-right">Action</div>
              </div>

              <div className="divide-y divide-slate-100">
                {rows.map((row) => {
                  const draft = drafts[row.key] || toDraft(row);
                  const changed = isDraftChanged(row, draft);
                  const saving = savingKey === row.key;

                  return (
                    <div key={row.key} className="grid grid-cols-[1.3fr_1fr_1fr_1.1fr_1.1fr_1fr] items-center gap-3 px-4 py-4 text-sm hover:bg-slate-50/70">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
                            <Layers3 className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-black text-slate-950">{row.subject_label}</p>
                            <p className="truncate text-xs font-bold text-slate-500">{row.level_label} · {row.services_count} service(s) · {row.classes_count} classe(s)</p>
                          </div>
                        </div>
                      </div>

                      <div>
                        <p className="font-black text-slate-950">{formatHours(row.weekly_units)}</p>
                        <p className="mt-1 text-xs font-bold text-slate-500">{formatSplitPattern(row.split_pattern)}</p>
                      </div>

                      <input
                        value={draft.weekly_units}
                        onChange={(event) => updateDraft(row.key, { weekly_units: event.target.value })}
                        placeholder="Ex. 4 ou 1,5"
                        className="h-11 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                      />

                      <input
                        value={draft.split_pattern}
                        onChange={(event) => updateDraft(row.key, { split_pattern: event.target.value })}
                        placeholder="Ex. 2+1+1"
                        className="h-11 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                      />

                      <div>
                        <span className={`inline-flex rounded-full px-3 py-1 text-xs font-black ring-1 ${sourceClass(row)}`}>{sourceLabel(row)}</span>
                        {row.has_mixed_values && <p className="mt-1 text-xs font-bold text-amber-700">Valeurs différentes selon services</p>}
                        {!row.is_ready && <p className="mt-1 text-xs font-bold text-red-700">À compléter</p>}
                      </div>

                      <div className="flex justify-end gap-2">
                        {row.source === "override" && (
                          <button
                            type="button"
                            onClick={() => void resetRow(row)}
                            disabled={saving || savingAction}
                            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                            title="Revenir au référentiel"
                          >
                            <RotateCcw className="h-4 w-4" />
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => void saveRow(row)}
                          disabled={saving || savingAction || !changed}
                          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-black text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                          Enregistrer
                        </button>
                      </div>

                      {row.missing_reason && (
                        <div className="col-span-6 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-2 text-xs font-bold text-amber-800">
                          {row.missing_reason}
                        </div>
                      )}
                    </div>
                  );
                })}

                {rows.length === 0 && (
                  <div className="px-4 py-12 text-center text-sm font-bold text-slate-500">
                    Aucune ligne matière/heure à afficher pour ces filtres.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </MontageSectionShell>
  );
}
