//src/app/admin/timetables/import/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Upload,
  Info,
  CheckCircle2,
  AlertTriangle,
  FileText,
  CalendarDays,
  Users,
} from "lucide-react";

type UploadState =
  | { status: "idle" }
  | { status: "uploading" }
  | { status: "success"; message: string; errors?: string[] }
  | { status: "error"; message: string; errors?: string[] };

type MetaClass = { id: string; label: string };
type MetaSubject = { id: string; label: string };
type MetaTeacher = { id: string; display_name: string; phone: string | null };
type MetaPeriod = {
  id: string;
  weekday: number;
  period_no: number;
  start_time: string | null;
  end_time: string | null;
};

type TimetablesMeta = {
  classes: MetaClass[];
  subjects: MetaSubject[];
  teachers: MetaTeacher[];
  periods: MetaPeriod[];
};

type ManualMeta = {
  subject_id: string;
  teachers: MetaTeacher[];
  teacherClasses: {
    teacher_id: string;
    class_id: string;
    class_label: string;
  }[];
  existing: {
    weekday: number;
    period_id: string;
    class_id: string;
    class_label: string;
  }[];
};

function Input(p: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...p}
      className={[
        "w-full rounded-xl border border-slate-200 bg-white/90 px-3 py-2 text-sm",
        "shadow-sm outline-none transition",
        "focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/20",
        "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400",
        p.className ?? "",
      ].join(" ")}
    />
  );
}

function Button(p: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...p}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium",
        "bg-emerald-600 text-white shadow-sm hover:bg-emerald-700",
        "focus:outline-none focus:ring-4 focus:ring-emerald-500/30",
        "disabled:opacity-60 disabled:cursor-not-allowed",
        p.className ?? "",
      ].join(" ")}
    />
  );
}

function Select(p: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...p}
      className={[
        "w-full rounded-xl border border-slate-200 bg-white/90 px-3 py-2 text-sm",
        "shadow-sm outline-none transition",
        "focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/20",
        "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400",
        p.className ?? "",
      ].join(" ")}
    />
  );
}

function downloadText(
  filename: string,
  content: string,
  mime = "text/csv;charset=utf-8"
) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const WEEKDAY_LABELS: Record<number, string> = {
  0: "Dimanche",
  1: "Lundi",
  2: "Mardi",
  3: "Mercredi",
  4: "Jeudi",
  5: "Vendredi",
  6: "Samedi",
};

type Mode = "csv" | "manual";

export default function ImportEmploisDuTempsPage() {
  const [mode, setMode] = useState<Mode>("csv");

  // ---------- ÉTAT CSV EXISTANT ----------
  const [file, setFile] = useState<File | null>(null);
  const [sampleLines, setSampleLines] = useState<string[]>([]);
  const [uploadState, setUploadState] = useState<UploadState>({
    status: "idle",
  });
  const [overwrite, setOverwrite] = useState<boolean>(false);

  // ---------- MÉTA COMMUNE ----------
  const [meta, setMeta] = useState<TimetablesMeta | null>(null);
  const [metaLoading, setMetaLoading] = useState<boolean>(false);
  const [metaError, setMetaError] = useState<string | null>(null);

  // ---------- ÉTAT SAISIE MANUELLE ----------
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>("");
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>("");
  const [manualMeta, setManualMeta] = useState<ManualMeta | null>(null);
  const [manualLoading, setManualLoading] = useState<boolean>(false);
  const [manualError, setManualError] = useState<string | null>(null);

  // clé = `${weekday}_${period_id}` -> classes sélectionnées
  const [cellSelection, setCellSelection] = useState<Record<string, string[]>>(
    {}
  );
  const [activeCell, setActiveCell] = useState<{
    weekday: number;
    period_id: string;
  } | null>(null);

  const [savingManual, setSavingManual] = useState(false);
  const [saveManualMessage, setSaveManualMessage] = useState<string | null>(
    null
  );
  const [saveManualError, setSaveManualError] = useState<string | null>(null);

  // ---------- CHARGEMENT MÉTA COMMUNE ----------
  useEffect(() => {
    async function loadMeta() {
      try {
        setMetaLoading(true);
        setMetaError(null);
        const res = await fetch("/api/admin/timetables/meta", {
          method: "GET",
        });
        if (!res.ok) {
          setMetaError(
            `Impossible de charger les données d'aide (HTTP ${res.status}).`
          );
          return;
        }
        const json = (await res.json()) as TimetablesMeta;
        setMeta(json);
      } catch (e: any) {
        setMetaError(
          e?.message || "Erreur lors du chargement des données d'aide."
        );
      } finally {
        setMetaLoading(false);
      }
    }
    loadMeta();
  }, []);

  // ---------- HELPERS CSV ----------
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) {
      setFile(null);
      setSampleLines([]);
      setUploadState({ status: "idle" });
      return;
    }
    setFile(f);
    setUploadState({ status: "idle" });

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = String(ev.target?.result || "");
      const lines = text
        .split(/\r?\n/)
        .slice(0, 6)
        .filter(Boolean);
      setSampleLines(lines);
    };
    reader.readAsText(f, "utf-8");
  }

  function handleDownloadTemplate() {
    const header = [
      "classe",
      "enseignant_email_ou_tel",
      "discipline",
      "jour",
      "heure_debut",
      "heure_fin",
      "periode_no",
    ].join(";");
    const example = [
      "1re D1",
      "ATTEKEBLE ACHILLE",
      "PHYSIQUE-CHIMIE",
      "Lundi",
      "07:15",
      "08:10",
      "1",
    ].join(";");
    const content = [header, example].join("\n");
    downloadText("modele_emplois_du_temps.csv", content);
  }

  async function handleUpload() {
    if (!file) return;
    setUploadState({ status: "uploading" });

    try {
      const form = new FormData();
      form.append("file", file);
      form.append("overwrite", overwrite ? "1" : "0");

      const res = await fetch("/api/admin/timetables/import", {
        method: "POST",
        body: form,
      });

      let message = `Import impossible (erreur serveur : HTTP ${res.status}).`;
      let errors: string[] | undefined = undefined;

      try {
        const json = (await res.json().catch(() => null as any)) as any;
        if (json?.message) {
          message = json.message;
        } else if (json?.error) {
          message = json.error;
        }
        if (Array.isArray(json?.errors)) {
          errors = json.errors as string[];
        }
      } catch {
        // ignore
      }

      if (!res.ok) {
        setUploadState({ status: "error", message, errors });
        return;
      }

      setUploadState({ status: "success", message, errors });
    } catch (e: any) {
      setUploadState({
        status: "error",
        message: e?.message || "Erreur lors de l’import.",
      });
    }
  }

  // ---------- HELPERS MÉTA MANUELLE ----------
  async function fetchManualMeta(subjectId: string, teacherId?: string) {
    if (!subjectId) {
      setManualMeta(null);
      return;
    }
    try {
      setManualLoading(true);
      setManualError(null);
      const params = new URLSearchParams({ subject_id: subjectId });
      if (teacherId) params.set("teacher_id", teacherId);
      const res = await fetch(
        `/api/admin/timetables/manual?${params.toString()}`,
        {
          method: "GET",
        }
      );
      if (!res.ok) {
        const json = (await res.json().catch(() => null as any)) as any;
        setManualError(
          json?.message ||
            `Impossible de charger les données (HTTP ${res.status}).`
        );
        setManualMeta(null);
        return;
      }
      const json = (await res.json()) as ManualMeta;
      setManualMeta({
        subject_id: json.subject_id,
        teachers: json.teachers || [],
        teacherClasses: json.teacherClasses || [],
        existing: json.existing || [],
      });

      // si un enseignant est précisé, pré-remplir les cases avec l'existant
      if (teacherId && json.existing) {
        const next: Record<string, string[]> = {};
        for (const row of json.existing) {
          const key = `${row.weekday}_${row.period_id}`;
          if (!next[key]) next[key] = [];
          if (!next[key].includes(row.class_id)) {
            next[key].push(row.class_id);
          }
        }
        setCellSelection(next);
      } else {
        // changement de matière => on repart à zéro
        setCellSelection({});
      }
    } catch (e: any) {
      setManualError(e?.message || "Erreur lors du chargement des données.");
      setManualMeta(null);
      setCellSelection({});
    } finally {
      setManualLoading(false);
    }
  }

  function handleChangeSubject(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;
    setSelectedSubjectId(value);
    setSelectedTeacherId("");
    setActiveCell(null);
    setSaveManualMessage(null);
    setSaveManualError(null);
    setCellSelection({});
    if (value) {
      fetchManualMeta(value);
    } else {
      setManualMeta(null);
    }
  }

  function handleChangeTeacher(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;
    setSelectedTeacherId(value);
    setActiveCell(null);
    setSaveManualMessage(null);
    setSaveManualError(null);
    setCellSelection({});
    if (selectedSubjectId && value) {
      fetchManualMeta(selectedSubjectId, value);
    }
  }

  const periodSlots = useMemo(() => {
    if (!meta?.periods?.length) return [] as { period_no: number; label: string }[];
    const byNo = new Map<number, { period_no: number; label: string }>();

    for (const p of meta.periods) {
      const existing = byNo.get(p.period_no);
      const label = `${p.start_time?.slice(0, 5) || "??:??"}–${
        p.end_time?.slice(0, 5) || "??:??"
      }`;
      if (!existing) {
        byNo.set(p.period_no, { period_no: p.period_no, label });
      }
    }

    return Array.from(byNo.values()).sort(
      (a, b) => a.period_no - b.period_no
    );
  }, [meta]);

  const availableWeekdays = useMemo(() => {
    if (!meta?.periods?.length) return [] as number[];
    const s = new Set<number>();
    for (const p of meta.periods) {
      s.add(p.weekday);
    }
    return Array.from(s.values()).sort((a, b) => a - b);
  }, [meta]);

  function findPeriod(weekday: number, period_no: number): MetaPeriod | undefined {
    return meta?.periods?.find(
      (p) => p.weekday === weekday && p.period_no === period_no
    );
  }

  const teachersForSelectedSubject: MetaTeacher[] = useMemo(() => {
    if (!manualMeta) return [];
    if (!selectedSubjectId) return [];
    return manualMeta.teachers || [];
  }, [manualMeta, selectedSubjectId]);

  const classesForSelectedTeacher: MetaClass[] = useMemo(() => {
    if (!manualMeta || !selectedTeacherId) return [];
    const relevant = manualMeta.teacherClasses.filter(
      (tc) => tc.teacher_id === selectedTeacherId
    );
    const seen = new Set<string>();
    const out: MetaClass[] = [];
    for (const r of relevant) {
      if (!seen.has(r.class_id)) {
        seen.add(r.class_id);
        out.push({ id: r.class_id, label: r.class_label });
      }
    }
    return out;
  }, [manualMeta, selectedTeacherId]);

  function keyForCell(weekday: number, period_id: string) {
    return `${weekday}_${period_id}`;
  }

  function handleCellClick(weekday: number, period: MetaPeriod | undefined) {
    if (!period) return;
    if (!selectedSubjectId || !selectedTeacherId) {
      setManualError(
        "Sélectionnez d’abord une matière puis un enseignant pour éditer le tableau."
      );
      return;
    }
    setManualError(null);
    setActiveCell({ weekday, period_id: period.id });
  }

  function toggleClassForActiveCell(classId: string) {
    if (!activeCell) return;
    const key = keyForCell(activeCell.weekday, activeCell.period_id);
    setCellSelection((prev) => {
      const existing = prev[key] || [];
      const exists = existing.includes(classId);
      const nextClasses = exists
        ? existing.filter((id) => id !== classId)
        : [...existing, classId];
      return { ...prev, [key]: nextClasses };
    });
  }

  async function handleSaveManual() {
    if (!selectedSubjectId || !selectedTeacherId) {
      setSaveManualError(
        "Sélectionnez une matière et un enseignant avant d’enregistrer."
      );
      return;
    }
    setSaveManualMessage(null);
    setSaveManualError(null);
    setSavingManual(true);

    const items = Object.entries(cellSelection)
      .map(([key, class_ids]) => {
        const [weekdayStr, period_id] = key.split("_");
        const weekday = Number(weekdayStr);
        return {
          weekday,
          period_id,
          class_ids,
        };
      })
      .filter((it) => it.class_ids && it.class_ids.length > 0);

    try {
      const res = await fetch("/api/admin/timetables/manual", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          subject_id: selectedSubjectId,
          teacher_id: selectedTeacherId,
          items,
        }),
      });

      const json = (await res.json().catch(() => null as any)) as any;
      if (!res.ok) {
        setSaveManualError(
          json?.message ||
            json?.error ||
            `Erreur lors de l’enregistrement (HTTP ${res.status}).`
        );
        return;
      }

      setSaveManualMessage(
        json?.message || "Emploi du temps enregistré avec succès."
      );

      // on recharge pour être certain d’être aligné avec la BDD
      await fetchManualMeta(selectedSubjectId, selectedTeacherId);
      setActiveCell(null);
    } catch (e: any) {
      setSaveManualError(
        e?.message || "Erreur inattendue lors de l’enregistrement."
      );
    } finally {
      setSavingManual(false);
    }
  }

  function isCellActive(weekday: number, period: MetaPeriod | undefined) {
    if (!period) return false;
    const key = keyForCell(weekday, period.id);
    const classes = cellSelection[key] || [];
    return classes.length > 0;
  }

  // ---------- RENDU ----------
  return (
    <main className="min-h-screen bg-slate-50/80 p-4 md:p-6 space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            Emplois du temps
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Importez un fichier CSV ou utilisez le tableau interactif pour
            construire les emplois du temps des professeurs.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="hidden md:inline text-xs text-slate-500">
            Mode de saisie
          </span>
          <div className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white/80 p-1">
            <button
              type="button"
              onClick={() => setMode("csv")}
              className={[
                "px-3 py-1 text-xs md:text-sm rounded-full transition",
                mode === "csv"
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-100",
              ].join(" ")}
            >
              Import CSV
            </button>
            <button
              type="button"
              onClick={() => setMode("manual")}
              className={[
                "px-3 py-1 text-xs md:text-sm rounded-full transition",
                mode === "manual"
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-100",
              ].join(" ")}
            >
              Saisie manuelle
            </button>
          </div>
        </div>
      </header>

      {/* ======================= MODE CSV ======================= */}
      {mode === "csv" && (
        <section className="grid gap-4 lg:grid-cols-3">
          {/* Étapes / Instructions */}
          <div className="rounded-2xl border border-slate-200 bg-white/90 shadow-sm p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Info className="h-5 w-5 text-emerald-600" />
              <h2 className="text-sm font-semibold text-slate-800">
                Comment préparer votre fichier ?
              </h2>
            </div>
            <ol className="space-y-2 text-sm text-slate-600 list-decimal list-inside">
              <li>
                Une ligne = un cours (ex : 1re D1, PHYSIQUE-CHIMIE, Lundi,
                07:15–08:10).
              </li>
              <li>
                Indiquez au moins : <strong>classe</strong>,{" "}
                <strong>enseignant</strong> (nom complet ou téléphone),{" "}
                <strong>discipline</strong>, <strong>jour</strong>,{" "}
                <strong>heure_debut</strong>, <strong>heure_fin</strong>. Le
                numéro de créneau <code>periode_no</code> est facultatif.
              </li>
              <li>
                Téléchargez le{" "}
                <button
                  type="button"
                  onClick={handleDownloadTemplate}
                  className="text-emerald-700 underline underline-offset-2 hover:text-emerald-800"
                >
                  modèle CSV d’exemple
                </button>{" "}
                pour vous guider.
              </li>
            </ol>

            <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50/80 px-3 py-2 text-xs text-amber-900 flex gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <p>
                Assurez-vous d&apos;avoir configuré les{" "}
                <strong>créneaux horaires</strong> de l&apos;établissement
                (jours + heures de début / fin). L&apos;import fait la
                correspondance automatiquement entre{" "}
                <code>jour, heure_debut, heure_fin</code> et ces créneaux.
              </p>
            </div>

            {/* Aide dynamique pour l’admin */}
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-3 text-xs text-slate-700 space-y-2">
              <div className="font-semibold text-slate-800 mb-1">
                Aide : valeurs disponibles dans votre établissement
              </div>

              {metaLoading && (
                <p className="text-slate-500">
                  Chargement des données d&apos;aide…
                </p>
              )}

              {metaError && <p className="text-red-600">{metaError}</p>}

              {meta && (
                <div className="space-y-2">
                  <div>
                    <div className="font-medium">Classes :</div>
                    <p className="text-slate-600">
                      {meta.classes.length === 0
                        ? "Aucune classe trouvée."
                        : meta.classes.map((c) => c.label).join(", ")}
                    </p>
                  </div>

                  <div>
                    <div className="font-medium">Disciplines activées :</div>
                    <p className="text-slate-600">
                      {meta.subjects.length === 0
                        ? "Aucune discipline configurée."
                        : meta.subjects.map((s) => s.label).join(", ")}
                    </p>
                  </div>

                  <div>
                    <div className="font-medium">Enseignants :</div>
                    <p className="text-slate-600">
                      {meta.teachers.length === 0
                        ? "Aucun enseignant trouvé."
                        : meta.teachers
                            .map((t) =>
                              t.phone
                                ? `${t.display_name} (${t.phone})`
                                : t.display_name
                            )
                            .join("; ")}
                    </p>
                  </div>

                  <div>
                    <div className="font-medium">Créneaux horaires :</div>
                    <div className="max-h-32 overflow-auto space-y-1 text-slate-600">
                      {meta.periods.length === 0 && (
                        <p>Aucun créneau configuré.</p>
                      )}
                      {meta.periods.map((p) => (
                        <div key={p.id}>
                          {WEEKDAY_LABELS[p.weekday] ?? `Jour ${p.weekday}`} –{" "}
                          {p.period_no} :{" "}
                          {p.start_time?.slice(0, 5)}-
                          {p.end_time?.slice(0, 5)}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Zone d’upload */}
          <div className="rounded-2xl border border-slate-200 bg-white/90 shadow-sm p-4 space-y-4">
            <div className="flex items-center gap-2">
              <Upload className="h-5 w-5 text-emerald-600" />
              <h2 className="text-sm font-semibold text-slate-800">
                Sélection du fichier
              </h2>
            </div>

            <label
              htmlFor="file"
              className="mt-2 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-emerald-200 bg-emerald-50/40 px-4 py-8 text-center text-sm text-slate-600 hover:border-emerald-400 hover:bg-emerald-50 transition"
            >
              <FileText className="h-8 w-8 text-emerald-500 mb-2" />
              <span className="font-medium">
                {file
                  ? file.name
                  : "Déposez votre fichier CSV ou cliquez pour le sélectionner"}
              </span>
              <span className="mt-1 text-xs text-slate-500">
                Formats recommandés : <strong>.csv</strong> (séparateur « ; »).
              </span>
              <Input
                id="file"
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={handleFileChange}
              />
            </label>

            <div className="flex items-center gap-2 text-xs text-slate-600">
              <input
                id="overwrite"
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                checked={overwrite}
                onChange={(e) => setOverwrite(e.target.checked)}
              />
              <label htmlFor="overwrite">
                Remplacer les lignes existantes pour les mêmes classes /
                créneaux (option avancée).
              </label>
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                onClick={handleUpload}
                disabled={!file || uploadState.status === "uploading"}
              >
                {uploadState.status === "uploading" ? (
                  <>
                    <Upload className="h-4 w-4 animate-spin" />
                    Import en cours…
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    Importer le fichier
                  </>
                )}
              </Button>
            </div>

            {uploadState.status === "success" && (
              <div className="mt-2 flex flex-col gap-2">
                <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50/80 px-3 py-2 text-xs text-emerald-900">
                  <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                  <p>{uploadState.message}</p>
                </div>

                {uploadState.errors && uploadState.errors.length > 0 && (
                  <details className="rounded-xl border border-emerald-200 bg-white/80 px-3 py-2 text-[11px] text-slate-700">
                    <summary className="cursor-pointer font-semibold">
                      Détails des lignes ignorées (
                      {uploadState.errors.length})
                    </summary>
                    <ul className="mt-2 list-disc list-inside space-y-1">
                      {uploadState.errors.map((err, idx) => (
                        <li key={idx}>{err}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}

            {uploadState.status === "error" && (
              <div className="mt-2 flex flex-col gap-2">
                <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50/80 px-3 py-2 text-xs text-red-900">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <p>{uploadState.message}</p>
                </div>

                {uploadState.errors && uploadState.errors.length > 0 && (
                  <details className="rounded-xl border border-red-200 bg-white/80 px-3 py-2 text-[11px] text-slate-700">
                    <summary className="cursor-pointer font-semibold">
                      Détails des erreurs ({uploadState.errors.length})
                    </summary>
                    <ul className="mt-2 list-disc list-inside space-y-1">
                      {uploadState.errors.map((err, idx) => (
                        <li key={idx}>{err}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
          </div>

          {/* Aperçu des premières lignes */}
          <div className="rounded-2xl border border-slate-200 bg-white/90 shadow-sm p-4 space-y-3">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-slate-700" />
              <h2 className="text-sm font-semibold text-slate-800">
                Aperçu du fichier
              </h2>
            </div>
            {sampleLines.length === 0 ? (
              <p className="text-xs text-slate-500">
                Sélectionnez un fichier pour voir un aperçu des premières
                lignes.
              </p>
            ) : (
              <pre className="max-h-64 overflow-auto rounded-xl bg-slate-900 text-[11px] leading-relaxed text-slate-100 p-3">
                {sampleLines.map((l, idx) => (
                  <div key={idx}>{l}</div>
                ))}
              </pre>
            )}
            <p className="text-[11px] text-slate-500">
              Vérifiez que les colonnes correspondent bien au modèle (classe,
              enseignant, discipline, jour, heures de début/fin…).
            </p>
          </div>
        </section>
      )}

      {/* ======================= MODE MANUEL ======================= */}
      {mode === "manual" && (
        <section className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
            {/* Filtres matière / prof */}
            <div className="rounded-2xl border border-slate-200 bg-white/90 shadow-sm p-4 space-y-4">
              <div className="flex items-center gap-2">
                <CalendarDays className="h-5 w-5 text-emerald-600" />
                <h2 className="text-sm font-semibold text-slate-800">
                  Choix de la matière et du professeur
                </h2>
              </div>

              <div className="space-y-3 text-sm">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Matière
                  </label>
                  <Select
                    value={selectedSubjectId}
                    onChange={handleChangeSubject}
                  >
                    <option value="">— Sélectionnez une matière —</option>
                    {meta?.subjects.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </Select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Professeur
                  </label>
                  <Select
                    value={selectedTeacherId}
                    onChange={handleChangeTeacher}
                    disabled={!selectedSubjectId || manualLoading}
                  >
                    <option value="">
                      {selectedSubjectId
                        ? manualLoading
                          ? "Chargement…"
                          : "— Sélectionnez un professeur —"
                        : "Choisissez d’abord une matière"}
                    </option>
                    {teachersForSelectedSubject.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.display_name}
                        {t.phone ? ` (${t.phone})` : ""}
                      </option>
                    ))}
                  </Select>
                </div>

                <div className="mt-2 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2 text-xs text-slate-600 space-y-1">
                  <p>
                    1. Choisissez une matière, puis un professeur lié à cette
                    matière.
                  </p>
                  <p>
                    2. Cliquez sur les cases du tableau pour indiquer les
                    classes du prof sur chaque créneau.
                  </p>
                  <p>3. Enregistrez l’emploi du temps pour ce professeur.</p>
                </div>

                {manualError && (
                  <div className="mt-2 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50/80 px-3 py-2 text-xs text-red-900">
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    <p>{manualError}</p>
                  </div>
                )}

                {classesForSelectedTeacher.length > 0 && (
                  <div className="mt-2 rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2 text-xs text-slate-700 space-y-1">
                    <div className="flex items-center gap-1 font-medium text-slate-800">
                      <Users className="h-3 w-3" />
                      Classes de ce professeur pour cette matière :
                    </div>
                    <p className="text-[11px]">
                      {classesForSelectedTeacher
                        .map((c) => c.label)
                        .join(", ")}
                    </p>
                  </div>
                )}

                {saveManualMessage && (
                  <div className="mt-2 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50/80 px-3 py-2 text-xs text-emerald-900">
                    <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                    <p>{saveManualMessage}</p>
                  </div>
                )}

                {saveManualError && (
                  <div className="mt-2 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50/80 px-3 py-2 text-xs text-red-900">
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    <p>{saveManualError}</p>
                  </div>
                )}

                <div className="pt-2 border-t border-slate-100 flex justify-end">
                  <Button
                    type="button"
                    onClick={handleSaveManual}
                    disabled={
                      savingManual ||
                      !selectedSubjectId ||
                      !selectedTeacherId
                    }
                  >
                    {savingManual ? (
                      <>
                        <Upload className="h-4 w-4 animate-spin" />
                        Enregistrement…
                      </>
                    ) : (
                      <>
                        <Upload className="h-4 w-4" />
                        Enregistrer pour ce professeur
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>

            {/* Tableau interactif */}
            <div className="rounded-2xl border border-slate-200 bg-white/90 shadow-sm p-4 space-y-3 overflow-x-auto">
              <div className="flex items-center gap-2">
                <CalendarDays className="h-5 w-5 text-emerald-600" />
                <h2 className="text-sm font-semibold text-slate-800">
                  Tableau d&apos;emploi du temps
                </h2>
              </div>

              {!meta?.periods?.length ? (
                <p className="text-xs text-slate-500">
                  Aucun créneau horaire n&apos;est configuré pour cet
                  établissement. Configurez d&apos;abord les créneaux dans les
                  paramètres.
                </p>
              ) : (
                <div className="mt-2 rounded-2xl border border-slate-100 bg-slate-50/60 p-3">
                  <table className="w-full border-separate border-spacing-[4px] text-[11px] md:text-xs">
                    <thead>
                      <tr>
                        <th className="w-32 align-bottom text-left text-[11px] font-semibold text-slate-500">
                          Créneaux / Jours
                        </th>
                        {availableWeekdays.map((wd) => (
                          <th
                            key={wd}
                            className="min-w-[80px] text-center text-[11px] font-medium text-slate-600"
                          >
                            {WEEKDAY_LABELS[wd] ?? `Jour ${wd}`}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {periodSlots.map((slot) => (
                        <tr key={slot.period_no}>
                          <th className="align-middle text-left text-[11px] font-medium text-slate-700">
                            <div>{`Créneau ${slot.period_no}`}</div>
                            <div className="text-[10px] text-slate-500">
                              {slot.label}
                            </div>
                          </th>
                          {availableWeekdays.map((wd) => {
                            const period = findPeriod(wd, slot.period_no);
                            const active = isCellActive(wd, period);
                            const disabled = !period;
                            const label = period
                              ? `${slot.label}`
                              : "Aucun créneau";
                            return (
                              <td key={`${wd}_${slot.period_no}`}>
                                <button
                                  type="button"
                                  disabled={
                                    disabled ||
                                    !selectedSubjectId ||
                                    !selectedTeacherId
                                  }
                                  onClick={() => handleCellClick(wd, period)}
                                  title={label}
                                  className={[
                                    "w-full rounded-xl border px-2 py-3 text-[10px] md:text-[11px] leading-tight transition",
                                    disabled
                                      ? "border-slate-100 bg-slate-100 text-slate-300 cursor-not-allowed"
                                      : active
                                      ? "border-emerald-500 bg-emerald-50 text-emerald-900 shadow-sm"
                                      : "border-slate-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/60",
                                  ].join(" ")}
                                >
                                  {period ? (
                                    <>
                                      <div className="font-medium">
                                        {WEEKDAY_LABELS[wd] ?? `Jour ${wd}`}
                                      </div>
                                      <div className="text-[10px] text-slate-500">
                                        {slot.label}
                                      </div>
                                      <div className="mt-1 text-[10px]">
                                        {active
                                          ? (() => {
                                              const key = keyForCell(
                                                wd,
                                                period.id
                                              );
                                              const count =
                                                (cellSelection[key] || [])
                                                  .length || 0;
                                              return `${count} classe(s)`;
                                            })()
                                          : "Aucun cours"}
                                      </div>
                                    </>
                                  ) : (
                                    <span className="text-slate-400">
                                      —
                                    </span>
                                  )}
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!selectedSubjectId || !selectedTeacherId ? (
                    <p className="mt-2 text-[11px] text-slate-500">
                      Sélectionnez une matière et un professeur pour activer le
                      tableau.
                    </p>
                  ) : (
                    <p className="mt-2 text-[11px] text-slate-500">
                      Cliquez sur une case pour choisir les classes du
                      professeur sur ce créneau.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Panneau de sélection des classes pour la cellule active */}
          {activeCell && selectedTeacherId && (
            <div className="rounded-2xl border border-slate-200 bg-white/90 shadow-sm p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-slate-800">
                    Classes sur le créneau sélectionné
                  </div>
                  <div className="text-xs text-slate-500">
                    {
                      WEEKDAY_LABELS[activeCell.weekday] ??
                      `Jour ${activeCell.weekday}`
                    }{" "}
                    –{" "}
                    {(() => {
                      const period = meta?.periods.find(
                        (p) => p.id === activeCell.period_id
                      );
                      if (!period) return "Créneau inconnu";
                      return `${period.start_time?.slice(0, 5)}–${period.end_time?.slice(0, 5)}`;
                    })()}
                  </div>
                </div>
                <button
                  type="button"
                  className="text-xs text-slate-500 hover:text-slate-700"
                  onClick={() => setActiveCell(null)}
                >
                  Fermer
                </button>
              </div>

              {classesForSelectedTeacher.length === 0 ? (
                <p className="text-xs text-slate-500">
                  Ce professeur n&apos;est associé à aucune classe pour cette
                  matière. Configurez d&apos;abord les affectations dans
                  &quot;Affectation professeurs / classes&quot;.
                </p>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                  {classesForSelectedTeacher.map((c) => {
                    const key = keyForCell(
                      activeCell.weekday,
                      activeCell.period_id
                    );
                    const selectedIds = cellSelection[key] || [];
                    const checked = selectedIds.includes(c.id);
                    return (
                      <label
                        key={c.id}
                        className={[
                          "flex items-center gap-2 rounded-xl border px-2 py-2 cursor-pointer text-xs",
                          checked
                            ? "border-emerald-400 bg-emerald-50"
                            : "border-slate-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/60",
                        ].join(" ")}
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                          checked={checked}
                          onChange={() => toggleClassForActiveCell(c.id)}
                        />
                        <span className="truncate">{c.label}</span>
                      </label>
                    );
                  })}
                </div>
              )}

              <p className="text-[11px] text-slate-500 mt-1">
                Les classes cochées seront enregistrées pour ce professeur /
                cette matière sur ce créneau au moment où vous cliquez sur
                &laquo;&nbsp;Enregistrer pour ce professeur&nbsp;&raquo;.
              </p>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
