"use client";

import React, { useEffect, useState } from "react";
import { Upload, Info, CheckCircle2, AlertTriangle, FileText } from "lucide-react";

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

function downloadText(filename: string, content: string, mime = "text/csv;charset=utf-8") {
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

export default function ImportEmploisDuTempsPage() {
  const [file, setFile] = useState<File | null>(null);
  const [sampleLines, setSampleLines] = useState<string[]>([]);
  const [uploadState, setUploadState] = useState<UploadState>({ status: "idle" });
  const [overwrite, setOverwrite] = useState<boolean>(false);

  const [meta, setMeta] = useState<TimetablesMeta | null>(null);
  const [metaLoading, setMetaLoading] = useState<boolean>(false);
  const [metaError, setMetaError] = useState<string | null>(null);

  useEffect(() => {
    async function loadMeta() {
      try {
        setMetaLoading(true);
        setMetaError(null);
        const res = await fetch("/api/admin/timetables/meta", { method: "GET" });
        if (!res.ok) {
          setMetaError(`Impossible de charger les données d'aide (HTTP ${res.status}).`);
          return;
        }
        const json = (await res.json()) as TimetablesMeta;
        setMeta(json);
      } catch (e: any) {
        setMetaError(e?.message || "Erreur lors du chargement des données d'aide.");
      } finally {
        setMetaLoading(false);
      }
    }
    loadMeta();
  }, []);

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
      const lines = text.split(/\r?\n/).slice(0, 6).filter(Boolean);
      setSampleLines(lines);
    };
    reader.readAsText(f, "utf-8");
  }

  function handleDownloadTemplate() {
    const header = [
      "classe",
      "enseignant_email_ou_tel", // nom complet ou téléphone
      "discipline",
      "jour", // Lundi, Mardi, ... ou 1..6
      "heure_debut", // HH:MM
      "heure_fin", // HH:MM
      "periode_no", // optionnel : n° de créneau
    ].join(";");
    const example = [
      "1re D1",
      "ATTEKEBLE ACHILLE", // nom complet de l'enseignant (téléphone possible à la place)
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
        const json = await res.json().catch(() => null as any);
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

  return (
    <main className="min-h-screen bg-slate-50/80 p-4 md:p-6 space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Import emplois du temps</h1>
          <p className="text-sm text-slate-500 mt-1">
            Chargez un fichier CSV d’emplois du temps (classes / enseignants / disciplines / créneaux).
            Ces données seront utilisées pour détecter les appels manquants et les retards.
          </p>
        </div>
      </header>

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
            <li>Une ligne = un cours (ex : 1re D1, PHYSIQUE-CHIMIE, Lundi, 07:15–08:10).</li>
            <li>
              Indiquez au moins : <strong>classe</strong>,{" "}
              <strong>enseignant</strong> (nom complet ou téléphone),{" "}
              <strong>discipline</strong>, <strong>jour</strong>,{" "}
              <strong>heure_debut</strong>, <strong>heure_fin</strong>.{" "}
              Le numéro de créneau <code>periode_no</code> est facultatif.
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
              <p className="text-slate-500">Chargement des données d&apos;aide…</p>
            )}

            {metaError && (
              <p className="text-red-600">
                {metaError}
              </p>
            )}

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
                        {p.start_time?.slice(0, 5)}-{p.end_time?.slice(0, 5)}
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
              Remplacer les lignes existantes pour les mêmes classes / créneaux
              (option avancée).
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
                    Détails des lignes ignorées ({uploadState.errors.length})
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
              Sélectionnez un fichier pour voir un aperçu des premières lignes.
            </p>
          ) : (
            <pre className="max-h-64 overflow-auto rounded-xl bg-slate-900 text-[11px] leading-relaxed text-slate-100 p-3">
              {sampleLines.map((l, idx) => (
                <div key={idx}>{l}</div>
              ))}
            </pre>
          )}
          <p className="text-[11px] text-slate-500">
            Vérifiez que les colonnes correspondent bien au modèle
            (classe, enseignant, discipline, jour, heures de début/fin…).
          </p>
        </div>
      </section>
    </main>
  );
}
