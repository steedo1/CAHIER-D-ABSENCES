"use client";
import { schoolLevelKey, sameSchoolLevel } from "@/lib/school-levels";

import { useEffect, useMemo, useState } from "react";
import {
  convertScoreScale,
  defaultFrancoArabicReportsSettings,
  getConfiguredScoringScale,
  type FrancoArabicReportsSettings,
  type LevelScoringScale,
  type ReportFormat,
  type SubjectReportCoefficient,
} from "@/lib/franco-arabic-reporting";
import {
  SCHOOL_CYCLE_OPTIONS,
  TEACHING_TRACK_OPTIONS,
  type SchoolCycle,
  type TeachingTrack,
} from "@/lib/school-cycles";

type ReportResponse = {
  ok?: boolean;
  reporting?: FrancoArabicReportsSettings;
  error?: string;
  revision?: string;
};
type CycleResponse = {
  ok?: boolean;
  subjects?: Array<{ id: string; name: string }>;
  configuration?: {
    enabled: boolean;
    enabledCycles: SchoolCycle[];
    teachingTracksByCycle: Partial<Record<SchoolCycle, TeachingTrack[]>>;
    subjectTracksByCycle: Partial<Record<SchoolCycle, Record<string, TeachingTrack[]>>>;
  };
  error?: string;
};
type AllowedProgram = { cycle: SchoolCycle; track: TeachingTrack };

export default function SchoolBulletinSettings() {
  const [settings, setSettings] = useState<FrancoArabicReportsSettings>(
    defaultFrancoArabicReportsSettings,
  );
  const [programs, setPrograms] = useState<AllowedProgram[]>([]);
  const [subjects, setSubjects] = useState<Array<{ id: string; name: string }>>([]);
  const [subjectTracksByCycle, setSubjectTracksByCycle] = useState<Partial<Record<SchoolCycle, Record<string, TeachingTrack[]>>>>({});
  const [multicycleReady, setMulticycleReady] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState("");

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setLoaded(false);
    setSettings(defaultFrancoArabicReportsSettings());
    setPrograms([]);
    setSubjects([]);
    setSubjectTracksByCycle({});
    setError("");
    setNotice("");
    (async () => {
      try {
        const response = await fetch("/api/admin/bulletin-templates", {
          cache: "no-store", signal: controller.signal,
        });
        const data = await response.json() as ReportResponse & CycleResponse;
        if (!response.ok || !data.ok || !data.reporting || !data.configuration) {
          throw new Error(data.error || "Chargement impossible.");
        }
        if (!active) return;
        // Keep the validated required fields narrowed; do not alias the
        // entire optional API response before extracting them.
        const reporting = data.reporting;
        const config = data.configuration;
        setSettings(reporting);
        setRevision(data.revision || "");
        setSubjects(data.subjects || []);
        setSubjectTracksByCycle(config.subjectTracksByCycle || {});
        setMulticycleReady(config.enabled);
        setPrograms(config.enabledCycles.flatMap((cycle) =>
          (config.teachingTracksByCycle[cycle] || [])
            .map((track) => ({ cycle, track }))));
        setLoaded(true);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Chargement impossible.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; controller.abort(); };
  }, []);

  const allowedKeys = useMemo(() =>
    new Set(programs.map(({ cycle, track }) => `${cycle}|${track}`)), [programs]);
  const firstProgram = programs.find(row => row.cycle === "primary") ||
    programs.find(row => row.cycle === "secondary");
  const hasSecondary = programs.some(program => program.cycle === "secondary");
  const blocked = loading || saving || !loaded || !multicycleReady;
  const hasArabic = programs.some((program) => program.track === "arabic");

  function updateScale(index: number, update: Partial<LevelScoringScale>) {
    setNotice("");
    setSettings((old) => ({
      ...old,
      scales: old.scales.map((entry, i) => i === index ? { ...entry, ...update } : entry),
    }));
  }

  function appendScale() {
    if (!firstProgram || settings.scales.length >= 120) return;
    setSettings((old) => ({
      ...old,
      scales: [...old.scales, {
        cycle: firstProgram.cycle,
        track: firstProgram.track,
        level: "",
        maxScore: 0,
      }],
    }));
  }

  function availableSubjects(cycle: SchoolCycle, track: TeachingTrack) {
    return subjects.filter((subject) =>
      subjectTracksByCycle[cycle]?.[subject.id]?.includes(track));
  }

  function updateCoefficient(index: number, update: Partial<SubjectReportCoefficient>) {
    setNotice("");
    setSettings((old) => ({
      ...old,
      coefficients: old.coefficients.map((entry, i) =>
        i === index ? { ...entry, ...update } : entry),
    }));
  }

  function appendCoefficient() {
    if (settings.coefficients.length >= 500) return;
    const scale = settings.scales.find((entry) =>
      entry.cycle === "secondary" &&
      entry.level.trim() && availableSubjects(entry.cycle, entry.track).length > 0);
    if (!scale) {
      setError("Définissez un barème puis rattachez des disciplines à cet enseignement.");
      return;
    }
    const subject = availableSubjects(scale.cycle, scale.track)[0];
    if (!subject) return;
    setError("");
    setSettings((old) => ({
      ...old,
      coefficients: [...old.coefficients, {
        cycle: scale.cycle, level: scale.level, track: scale.track,
        subjectId: subject.id, coefficient: 0, includeInAverage: false,
      }],
    }));
  }

  async function save() {
    if (blocked) return;
    const seen = new Set<string>();
    for (const item of settings.scales) {
      const level = item.level.trim();
      const key = `${item.cycle}|${item.track}|${schoolLevelKey(level, item.cycle)}`;
      if (!level || seen.has(key) || !Number.isInteger(item.maxScore) ||
        item.maxScore < 1 || item.maxScore > 100 ||
        !allowedKeys.has(`${item.cycle}|${item.track}`)) {
        setError("Vérifiez les niveaux, les barèmes et les doublons avant d'enregistrer.");
        return;
      }
      seen.add(key);
    }
    const coefficientKeys = new Set<string>();
    for (const policy of settings.coefficients) {
      const key = [
        policy.cycle, policy.track, schoolLevelKey(policy.level, policy.cycle),
        policy.subjectId,
      ].join("|");
      const scaleAvailable = settings.scales.some((entry) =>
        entry.cycle === policy.cycle && entry.track === policy.track &&
        sameSchoolLevel(entry.level, policy.level, policy.cycle));
      if (!scaleAvailable || !availableSubjects(policy.cycle, policy.track)
        .some((subject) => subject.id === policy.subjectId) ||
        !Number.isFinite(policy.coefficient) ||
        policy.coefficient <= 0 || policy.coefficient > 100 ||
        coefficientKeys.has(key)) {
        setError("Vérifiez les coefficients : niveau, discipline, valeurs et doublons.");
        return;
      }
      coefficientKeys.add(key);
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        "/api/admin/bulletin-templates",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...settings, revision, format: hasArabic ? settings.format : "separate" }),
        },
      );
      const data = await response.json() as ReportResponse;
      if (!response.ok || !data.ok || !data.reporting) {
        throw new Error(data.error || "Enregistrement impossible.");
      }
      setSettings(data.reporting);
      setRevision(data.revision || "");
      setNotice("Paramètres de préparation des bulletins enregistrés pour cette école.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-4 rounded-2xl border bg-white p-5 shadow-sm">
      <div>
        <h2 className="text-lg font-bold text-slate-900">Paramètres des bulletins</h2>
        <a href="/admin/bulletins/modeles" className="mt-2 inline-block rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white">
          Voir les modèles de bulletins et livrets
        </a>
        <p className="mt-1 text-sm text-slate-600">
          Définir les barèmes et la présentation par niveau et enseignement.
          Le calcul adapté nécessite une activation explicite ci-dessous.
        </p>
      </div>
      {loading ? <p className="text-sm text-slate-600">Chargement des paramètres…</p> : (
        <>
          {!multicycleReady && (
            <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
              La gestion des nouveaux cycles n’est pas activée pour cet établissement. Les bulletins historiques restent inchangés.
            </p>
          )}
          <label className="flex items-center gap-3 text-sm font-semibold">
            <input type="checkbox" checked={settings.enabled}
              disabled={blocked} className="h-5 w-5"
              onChange={(event) => setSettings((old) => ({ ...old, enabled: event.target.checked }))} />
            Préparer des bulletins propres à cet établissement
          </label>
          {settings.enabled && (
            <div className="space-y-4">
              <label className="flex items-center gap-3 text-sm font-semibold">
                <input id="activate-specialized-bulletins" type="checkbox" disabled={blocked}
                  checked={settings.engine === "specialized"}
                  onChange={(event) => setSettings(old => ({ ...old, engine: event.target.checked ? "specialized" : "legacy" }))} />
                Utiliser ces règles pour les bulletins des cycles configurés
              </label>
              <p className="text-sm text-slate-600">Sans cette activation, les bulletins habituels restent utilisés. Les matières communes aux deux enseignements nécessitent un rattachement explicite des évaluations avant tout calcul.</p>
              {hasSecondary && <>
              <label htmlFor="coefficient-authority" className="block text-sm font-medium">Coefficients des matières du secondaire</label>
              <select id="coefficient-authority" disabled={blocked} className="rounded-lg border p-2"
                value={settings.coefficientSource || "institution"}
                onChange={event => setSettings(old => ({ ...old, coefficientSource: event.target.value as "institution" | "program" }))}>
                <option value="institution">Coefficients existants de l’établissement</option>
                <option value="program">Coefficients définis ici par niveau et enseignement</option>
              </select>
              <p className="text-sm text-slate-600">Une seule règle est utilisée au secondaire. Le primaire utilise ses barèmes et le préscolaire ses compétences sans coefficients.</p>
              </>}
              {hasArabic ? (
              <div>
                <label htmlFor="report-format" className="mb-1 block text-sm font-medium">
                  Présentation souhaitée des bulletins
                </label>
                <select id="report-format" value={settings.format} disabled={blocked}
                  onChange={(event) => setSettings((old) => ({
                    ...old, format: event.target.value as ReportFormat,
                  }))} className="min-h-11 w-full rounded-xl border px-3 py-2">
                  <option value="separate">Deux bulletins distincts : français / arabe</option>
                  <option value="combined">Un document regroupé, deux moyennes distinctes</option>
                  <option value="both">Les deux présentations, sans moyenne commune</option>
                </select>
                <p className="mt-2 text-sm font-semibold text-slate-700">
                  Règle obligatoire : la moyenne française et la moyenne arabe
                  restent indépendantes. Aucun calcul de moyenne franco-arabe globale,
                  même sur un document regroupé.
                </p>
              </div>
              ) : (
                <p className="rounded-xl border bg-slate-50 p-3 text-sm text-slate-700">
                  École ordinaire : bulletin de notes classique, sans mention
                  « Programme français » et sans option bilingue.
                </p>
              )}
              <div className="border-t pt-4">
                <h3 className="font-semibold text-slate-900">Barèmes par niveau — primaire</h3>
                <p className="mt-1 text-xs text-slate-600">Au secondaire, la notation et les coefficients suivent le modèle déjà déployé dans Mon Cahier. Au préscolaire, seules les compétences et les observations sont évaluées.</p>
                <p className="mt-1 text-sm text-slate-600">
                  Laissez vide tant que l’établissement n’a pas confirmé ses barèmes.
                  Aucun barème national n’est deviné : confirmez chaque valeur avec l’établissement avant de l’utiliser.
                </p>
                <div className="mt-3 space-y-3">
                  {settings.scales.map((scale, index) => {
                    // Historical preschool scoring rules are left in stored settings
                    // for compatibility, but cannot be edited or added here.
                    if (scale.cycle === "preschool") return null;
                    const availableTracks = programs.filter((p) => p.cycle === scale.cycle);
                    return (
                      <div key={index} className="grid gap-2 rounded-xl border bg-slate-50 p-3 sm:grid-cols-5">
                        <select aria-label={`Cycle ${index + 1}`} value={scale.cycle}
                          disabled={blocked} className="min-h-10 rounded-lg border px-2"
                          onChange={(event) => {
                            const cycle = event.target.value as SchoolCycle;
                            const track = programs.find((p) => p.cycle === cycle)?.track || "french";
                            updateScale(index, { cycle, track });
                          }}>
                          {SCHOOL_CYCLE_OPTIONS.filter((c) =>
                            c.id !== "preschool" && programs.some((p) => p.cycle === c.id))
                            .map((c) => <option value={c.id} key={c.id}>{c.label}</option>)}
                        </select>
                        <select aria-label={`Enseignement ${index + 1}`} value={scale.track}
                          disabled={blocked} className="min-h-10 rounded-lg border px-2"
                          onChange={(event) => updateScale(index, {
                            track: event.target.value as TeachingTrack,
                          })}>
                          {availableTracks.map((p) =>
                            <option key={p.track} value={p.track}>
                              {!hasArabic ? "Enseignement ordinaire" : TEACHING_TRACK_OPTIONS.find((t) => t.id === p.track)?.label || p.track}
                            </option>)}
                        </select>
                        <input aria-label={`Niveau ${index + 1}`} value={scale.level}
                          disabled={blocked} placeholder="CP1, CE1, CM1…"
                          className="min-h-10 rounded-lg border px-2"
                          onChange={(event) => updateScale(index, { level: event.target.value })} />
                        <input aria-label={`Barème ${index + 1}`} type="number"
                          min={1} max={100} step={1} value={scale.maxScore || ""}
                          disabled={blocked} className="min-h-10 rounded-lg border px-2"
                          onChange={(event) => updateScale(index, {
                            maxScore: Number(event.target.value),
                          })} />
                        <button type="button" disabled={blocked}
                          className="rounded-lg border px-3 py-2 text-sm font-medium text-red-700"
                          onClick={() => setSettings((old) => ({
                            ...old, scales: old.scales.filter((_, i) => i !== index),
                          }))}>Retirer</button>
                      </div>
                    );
                  })}
                </div>
                <button type="button" onClick={appendScale}
                  disabled={blocked || !firstProgram || settings.scales.length >= 120}
                  className="mt-3 min-h-10 rounded-xl border px-4 py-2 text-sm font-semibold">
                  + Ajouter un barème
                </button>
              </div>
              {hasSecondary && (settings.coefficientSource || "institution") === "program" ? <div className="border-t pt-4">
                <h3 className="font-semibold text-slate-900">
                  Coefficients par matière et par niveau — secondaire uniquement
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  Choisissez le niveau et la discipline, puis renseignez le coefficient
                  confirmé par l’établissement. Les coefficients du secondaire existant
                  et du CSCA ne sont pas modifiés.
                </p>
                <div className="mt-3 space-y-3">
                  {settings.coefficients.map((policy, index) => {
                    if (policy.cycle !== "secondary") return null;
                    const selectedKey = [
                      policy.cycle, policy.track, policy.level,
                    ].join("|");
                    const possibleSubjects = availableSubjects(policy.cycle, policy.track);
                    return (
                      <div key={index} className="grid gap-2 rounded-xl border bg-slate-50 p-3 sm:grid-cols-5">
                        <select
                          aria-label={`Niveau-programme du coefficient ${index + 1}`}
                          value={selectedKey}
                          disabled={blocked}
                          className="min-h-10 rounded-lg border px-2 text-sm"
                          onChange={(event) => {
                            const scale = settings.scales.find((entry) =>
                              [entry.cycle, entry.track, entry.level].join("|") === event.target.value);
                            if (!scale) return;
                            updateCoefficient(index, {
                              cycle: scale.cycle, track: scale.track, level: scale.level,
                              subjectId: availableSubjects(scale.cycle, scale.track)[0]?.id || "",
                            });
                          }}
                        >
                          {settings.scales.filter((entry) => entry.cycle === "secondary" && entry.level.trim()).map((entry, idx) =>
                            <option key={idx} value={[entry.cycle, entry.track, entry.level].join("|")}>
                              {entry.level} — {!hasArabic ? "Enseignement ordinaire" : entry.track === "french" ? "Français" : "Arabe"}
                            </option>)}
                        </select>
                        <select aria-label={`Matière du coefficient ${index + 1}`}
                          value={policy.subjectId} disabled={blocked}
                          className="min-h-10 rounded-lg border px-2 text-sm"
                          onChange={(event) => updateCoefficient(index, {
                            subjectId: event.target.value,
                          })}>
                          {possibleSubjects.map((subject) => (
                            <option key={subject.id} value={subject.id}>{subject.name}</option>
                          ))}
                        </select>
                        <input aria-label={`Coefficient de la matière ${index + 1}`}
                          type="number" min={0.01} max={100} step="any"
                          value={policy.coefficient || ""} disabled={blocked}
                          className="min-h-10 rounded-lg border px-2 text-sm"
                          onChange={(event) => updateCoefficient(index, {
                            coefficient: Number(event.target.value),
                          })}
                        />
                        <label className="flex items-center gap-2 text-sm">
                          <input type="checkbox" checked={policy.includeInAverage}
                            disabled={blocked}
                            onChange={(event) => updateCoefficient(index, {
                              includeInAverage: event.target.checked,
                            })} />
                          Compte dans la moyenne
                        </label>
                        <button type="button" disabled={blocked}
                          className="rounded-lg border px-3 py-2 text-sm font-medium text-red-700"
                          onClick={() => setSettings((old) => ({
                            ...old, coefficients: old.coefficients.filter((_, i) => i !== index),
                          }))}>Retirer</button>
                      </div>
                    );
                  })}
                </div>
                <button type="button" onClick={appendCoefficient}
                  disabled={blocked || settings.coefficients.length >= 500}
                  className="mt-3 min-h-10 rounded-xl border px-4 py-2 text-sm font-semibold">
                  + Ajouter un coefficient
                </button>
              </div> : hasSecondary ? <a href="/admin/parametres?tab=coefficients#subject-coeffs" className="block text-sm font-semibold text-sky-800 underline">Configurer les coefficients du secondaire dans les paramètres existants de l’établissement</a> : null}
              {programs.some(p => p.cycle === "preschool") && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                Préscolaire : un livret de compétences et d’observations, sans notes chiffrées, coefficients ni rang.
                Les compétences officielles doivent être validées par la direction.
              </div>}
              {settings.scales.length > 0 && (() => {
                const first = settings.scales[0];
                const scale = getConfiguredScoringScale(settings,
                  first.cycle, first.level, first.track);
                const example = scale && convertScoreScale(scale / 2, scale, 20);
                return example === null || example === undefined ? null : (
                  <p className="rounded-lg bg-sky-50 p-3 text-xs text-sky-900">
                    Vérification mathématique : {scale! / 2}/{scale} correspond à
                    {" "}{example}/20. C’est un exemple de conversion, pas une moyenne générale calculée.
                  </p>
                );
              })()}
            </div>
          )}
          {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
          {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
          <button type="button" onClick={() => void save()} disabled={blocked}
            className="min-h-11 rounded-xl bg-violet-700 px-5 py-3 font-semibold text-white disabled:opacity-50">
            {saving ? "Enregistrement…" : "Enregistrer les paramètres de bulletins"}
          </button>
        </>
      )}
    </section>
  );
}
