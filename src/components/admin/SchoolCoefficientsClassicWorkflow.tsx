"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { sameSchoolLevel } from "@/lib/school-levels";
import {
  buildGeneralSecondaryCoefficientPreview,
} from "@/lib/default-general-secondary-coefficients-ci";
import type { SchoolCycle, TeachingTrack } from "@/lib/school-cycles";
import type { FrancoArabicReportsSettings } from "@/lib/franco-arabic-reporting";
import { ciPrimaryFrenchDenominator, ciPrimaryFrenchEntryForName } from "@/lib/primary-french-reference-ci";

type Program = { cycle: SchoolCycle; track: TeachingTrack };
type TeachingClass = { id: string; label: string; level: string | null; cycle: SchoolCycle | null; track: TeachingTrack | null };
type Subject = { id: string; name: string };
type LegacyCoefficient = { level: string; subject_id: string; coeff: number };
type Component = { id?: string; code: string; label: string; level?: string | null; coeff_in_subject: number; order_index: number; is_active: boolean };
type ResponseBase = { ok?: boolean; error?: string; revision?: string };
type SettingsPayload = ResponseBase & {
  configuration?: {
    enabledCycles: SchoolCycle[];
    teachingTracksByCycle: Partial<Record<SchoolCycle, TeachingTrack[]>>;
    subjectTracksByCycle: Partial<Record<SchoolCycle, Record<string, TeachingTrack[]>>>;
  };
  reporting?: FrancoArabicReportsSettings;
  subjects?: Subject[];
};
type ClassPayload = ResponseBase & {
  classes?: TeachingClass[];
  selectedClassId?: string | null;
  selectedSubjectIds?: string[];
  ciPrimaryFrenchApplied?: boolean;
};
type LegacyPayload = ResponseBase & {
  items?: LegacyCoefficient[];
};
type ComponentPayload = ResponseBase & {
  items?: Component[];
};

const programsLabel: Record<SchoolCycle, string> = {
  preschool: "Préscolaire", primary: "Primaire", secondary: "Secondaire",
};
const trackLabel: Record<TeachingTrack, string> = {
  french: "Enseignement français", arabic: "Enseignement arabe",
};
const endpoint = "/api/admin/bulletin-templates";
const classEndpoint = "/api/admin/school-class-subjects";
const historicalEndpoint = "/api/admin/institution/subject-coeffs";
const componentsEndpoint = "/api/admin/institution/subject-components";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Impossible d'effectuer cette opération.";
}
function levelKey(cycle: SchoolCycle, track: TeachingTrack, level: string) {
  return [cycle, track, level].join("|");
}
function numberInput(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}
function getSavedCoefficient(
  reporting: FrancoArabicReportsSettings, cycle: SchoolCycle, track: TeachingTrack,
  level: string, id: string,
): number | null {
  return reporting.coefficients.find(row => row.cycle === cycle && row.track === track &&
    sameSchoolLevel(row.level, level, cycle) && row.subjectId === id)?.coefficient ?? null;
}

/**
 * The SAME admin workflow as ordinary schools: choose teaching/level,
 * edit the discipline table, then save. Keep the historical secondary French
 * coefficient engine unchanged; Arabic coefficients and components remain independently
 * scoped by cycle, level, teaching and subject using existing storage.
 *
 * No shadow subject catalogue, schema migration, global subject-component edits
 * for Arabic, extra "prepare/activate" toggles, or new publication workflow.
 */
export default function SchoolCoefficientsClassicWorkflow() {
  const [settings, setSettings] = useState<SettingsPayload | null>(null);
  const [classes, setClasses] = useState<TeachingClass[]>([]);
  const [historical, setHistorical] = useState<LegacyCoefficient[]>([]);
  const [programKey, setProgramKey] = useState("");
  const [classId, setClassId] = useState("");
  const [subjectIds, setSubjectIds] = useState<string[]>([]);
  const [subjectClassId, setSubjectClassId] = useState("");
  const [ciPrimaryApplied, setCiPrimaryApplied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingClass, setLoadingClass] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [changes, setChanges] = useState<Record<string, string>>({});
  const [scaleChange, setScaleChange] = useState("");
  const [componentsFor, setComponentsFor] = useState<Subject | null>(null);
  const [components, setComponents] = useState<Component[]>([]);
  const [componentsBusy, setComponentsBusy] = useState(false);
  const [componentsRevision, setComponentsRevision] = useState("");
  const [componentsScope, setComponentsScope] = useState("");
  const contextRef = useRef("");
  const [showCiSecondaryPreview, setShowCiSecondaryPreview] = useState(false);
  const [ciPrimary, setCiPrimary] = useState<{
    matches: Array<{ code: string; label: string; denominator: number }>;
    missing: string[];
    newlyAssociated: string[];
    proposedSubjectIds: string[];
    classId: string;
  } | null>(null);
  const [ciBusy, setCiBusy] = useState(false);

  async function parseResponse<T extends ResponseBase>(response: Response, fallback: string): Promise<T> {
    const result = await response.json().catch(() => ({})) as T;
    if (!response.ok || !result.ok) throw new Error(result.error || fallback);
    return result;
  }

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const [template, classResult, legacy] = await Promise.all([
        fetch(endpoint, { cache: "no-store" }),
        fetch(classEndpoint, { cache: "no-store" }),
        fetch(historicalEndpoint, { cache: "no-store" }),
      ]);
      const [t, c, h] = await Promise.all([
        parseResponse<SettingsPayload>(template, "Paramètres des bulletins indisponibles"),
        parseResponse<ClassPayload>(classResult, "Classes indisponibles"),
        parseResponse<LegacyPayload>(legacy, "Coefficients historiques indisponibles"),
      ]);
      if (!t.configuration || !t.reporting) throw new Error("Configuration pédagogique manquante");
      setSettings(t);
      setClasses(c.classes || []);
      setHistorical(h.items || []);
      setChanges({});
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  const programs = useMemo<Program[]>(() => (settings?.configuration?.enabledCycles || [])
    .flatMap(cycle => (settings?.configuration?.teachingTracksByCycle[cycle] || [])
      .map(track => ({ cycle, track }))), [settings]);

  const chosenProgram = programs.find(row => levelKey(row.cycle, row.track, "") === programKey) || programs[0];
  const chosenProgramKey = chosenProgram ? levelKey(chosenProgram.cycle, chosenProgram.track, "") : "";
  const scopedClasses = useMemo(() => classes.filter(row =>
    row.cycle === chosenProgram?.cycle && row.track === chosenProgram?.track), [classes, chosenProgram?.cycle, chosenProgram?.track]);
  const selectedClass = scopedClasses.find(row => row.id === classId) || scopedClasses[0] || null;
  const actualClassId = selectedClass?.id || "";
  const cycle = chosenProgram?.cycle;
  const track = chosenProgram?.track;
  const level = selectedClass?.level || "";
  const componentScope = [actualClassId, cycle, track, level].join("|");
  contextRef.current = componentScope;
  const frenchSecondary = cycle === "secondary" && track === "french";
  const arabicSecondary = cycle === "secondary" && track === "arabic";
  const showCoefficients = cycle === "secondary";
  const configuredSubjects = (subjectClassId === actualClassId ? settings?.subjects || [] : []).filter(row =>
    !!(cycle && track && settings?.configuration?.subjectTracksByCycle[cycle]?.[row.id]?.includes(track)) &&
    subjectIds.includes(row.id));
  const reporting = settings?.reporting;
  const currentScale = reporting?.scales.find(row => row.cycle === cycle && row.track === track &&
    sameSchoolLevel(row.level, level, row.cycle));
  const scaleDisplay = scaleChange || numberInput(currentScale?.maxScore);
  const primaryFrenchReferenceApplied = cycle === "primary" && track === "french" && ciPrimaryApplied;
  // CI primary scales are per subject, independent of the bulletin-wide /10 scale.
  // They are read-only here: editing a denominator without changing validation
  // and printed reports would create inconsistent official marks.
  function primaryCompositionScale(subject: Subject): number | null {
    if (primaryFrenchReferenceApplied) {
      const reference = ciPrimaryFrenchEntryForName(subject.name);
      return reference ? ciPrimaryFrenchDenominator(level, reference.code) : null;
    }
    const common = Number(scaleDisplay);
    return Number.isInteger(common) && common > 0 ? common : null;
  }
  const isLoadingSubjects = loading || loadingClass || (Boolean(actualClassId) && subjectClassId !== actualClassId);

  useEffect(() => {
    if (!actualClassId) { setSubjectIds([]); setSubjectClassId(""); return; }
    const controller = new AbortController();
    setLoadingClass(true); setError("");
    setSubjectIds([]); setSubjectClassId(""); setCiPrimaryApplied(false);
    setChanges({}); setScaleChange(""); setCiPrimary(null); setShowCiSecondaryPreview(false);
    setComponentsFor(null); setComponents([]); setComponentsBusy(false); setComponentsRevision("");
    (async () => {
      try {
        const response = await fetch(classEndpoint + "?class_id=" + encodeURIComponent(actualClassId), {
          cache: "no-store", signal: controller.signal,
        });
        const data = await parseResponse<ClassPayload>(response, "Matières de classe indisponibles");
        if (data.selectedClassId !== actualClassId) throw new Error("Classe sélectionnée incohérente");
        if (!controller.signal.aborted) {
          setSubjectIds(data.selectedSubjectIds || []);
          setCiPrimaryApplied(data.ciPrimaryFrenchApplied === true);
          setSubjectClassId(actualClassId);
        }
      } catch (e) {
        if (!controller.signal.aborted) setError(errorMessage(e));
      } finally {
        if (!controller.signal.aborted) setLoadingClass(false);
      }
    })();
    return () => controller.abort();
  }, [actualClassId]);

  function coeffFor(subjectId: string): string {
    if (!cycle || !track || !reporting) return "";
    const key = levelKey(cycle, track, level) + "|" + subjectId;
    if (Object.hasOwn(changes, key)) return changes[key];
    if (frenchSecondary) {
      const found = historical.find(row => row.subject_id === subjectId && sameSchoolLevel(row.level, level, cycle));
      return numberInput(found?.coeff);
    }
    return numberInput(getSavedCoefficient(reporting, cycle, track, level, subjectId));
  }

  function onCoeffChange(subjectId: string, value: string) {
    if (!cycle || !track) return;
    const key = levelKey(cycle, track, level) + "|" + subjectId;
    setChanges(old => ({ ...old, [key]: value }));
    setMessage("");
  }

  const ciSecondaryPreview = frenchSecondary && level ? buildGeneralSecondaryCoefficientPreview(
    configuredSubjects.map(subject => ({
      level, subject_id: subject.id, subject_name: subject.name,
      coeff: Number(coeffFor(subject.id)) || 0,
    })),
  ) : [];
  const applicableCi = ciSecondaryPreview.filter(row => row.willApply && row.coeff !== null);
  function applyCiSecondary() {
    if (!cycle || !track || !level || !frenchSecondary) return;
    const next = { ...changes };
    for (const row of applicableCi) next[levelKey(cycle, track, level) + "|" + row.subject_id] = String(row.coeff);
    setChanges(next);
    setMessage("Référentiel CI proposé pour " + applicableCi.length +
      " discipline(s). Vérifiez puis enregistrez. Les sous-matières existantes ne sont pas écrasées.");
    setShowCiSecondaryPreview(true);
  }

  async function primaryCiReference(apply: boolean) {
    if (!actualClassId || cycle !== "primary" || track !== "french" || ciBusy || !settings?.revision) return;
    setCiBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(classEndpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classId: actualClassId, revision: settings.revision,
          action: apply ? "apply_ci_primary_french" : "preview_ci_primary_french" }),
      });
      const data = await parseResponse<ResponseBase & { preview?: typeof ciPrimary }>(
        response, "Référentiel primaire indisponible");
      setCiPrimary(data.preview || null);
      if (apply) {
        // Applying the CI reference can change class curricula and the reporting
        // revision; refresh them before any next save.
        const refreshed = await fetch(endpoint, { cache: "no-store" });
        const updated = await parseResponse<SettingsPayload>(refreshed, "Paramètres actualisés indisponibles");
        setSettings(updated);
        setSubjectIds(data.preview?.proposedSubjectIds || []);
        setSubjectClassId(actualClassId);
        setCiPrimaryApplied(true);
        setScaleChange("");
        setMessage("Référentiel CI appliqué à la classe : disciplines supplémentaires conservées.");
      } else {
        setMessage("Prévisualisation du référentiel primaire : aucune modification enregistrée.");
      }
    } catch (e) { setError(errorMessage(e)); }
    finally { setCiBusy(false); }
  }

  async function save() {
    if (!settings?.reporting || !cycle || !track || !actualClassId || !level || isLoadingSubjects || saving) return;
    setError(""); setMessage(""); setSaving(true);
    try {
      const old = settings.reporting;
      // Preserve unrelated cycles, programs, reporting formats and coefficients.
      let next: FrancoArabicReportsSettings = { ...old, enabled: true, engine: "specialized",
        // Secondary French always uses its historical calculator. Arabic reads
        // ONLY teaching-scoped policies, never shared French coefficient rows.
        coefficientSource: "program" };
      if (cycle === "primary" || arabicSecondary) {
        const maximum = Number(scaleDisplay);
        if (!Number.isInteger(maximum) || maximum < 1 || maximum > 100)
          throw new Error("Indiquez le barème de notation confirmé par l'école (de 1 à 100).");
        const current = old.scales.filter(row => !(row.cycle === cycle && row.track === track &&
          sameSchoolLevel(row.level, level, cycle)));
        next = { ...next, scales: [...current, { cycle, track, level, maxScore: maximum }] };
      }
      if (showCoefficients) {
        if (!configuredSubjects.length) throw new Error("Aucune matière attribuée à cette classe et à cet enseignement.");
        const numbers = configuredSubjects.map(subject => ({ subject,
          value: Number(coeffFor(subject.id)), raw: coeffFor(subject.id).trim() }));
        for (const { subject, value, raw } of numbers) {
          if (!raw || !Number.isFinite(value) || value < 0 || value > 99)
            throw new Error("Vérifiez le coefficient de " + subject.name + ".");
        }
        if (frenchSecondary) {
          // The existing French bulletin engine continues to read this EXACT
          // institution-level table. Save ONLY the chosen class/teaching rows,
          // never all unseen historical coefficient rows.
          const response = await fetch(historicalEndpoint, {
            method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ items: numbers.map(({ subject, value }) => ({
              level, subject_id: subject.id, coeff: value,
            })) }),
          });
          await parseResponse<ResponseBase>(response, "Enregistrement des coefficients français impossible");
        } else {
          // The historical table does NOT contain a teaching track: Arabic
          // coefficients must NEVER be written there.
          const untouched = old.coefficients.filter(row => !(row.cycle === cycle && row.track === track &&
            sameSchoolLevel(row.level, level, cycle) &&
            configuredSubjects.some(subject => subject.id === row.subjectId)));
          next = { ...next,
            coefficients: [...untouched, ...numbers.filter(row => row.value > 0).map(({ subject, value }) => ({
              cycle, track, level, subjectId: subject.id, coefficient: value, includeInAverage: true,
            }))] };
        }
      }
      const response = await fetch(endpoint, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...next, revision: settings.revision }),
      });
      const value = await parseResponse<SettingsPayload>(response,
        "Les coefficients sont enregistrés, mais les paramètres du bulletin doivent être rechargés.");
      setSettings(prev => prev && ({ ...prev, reporting: value.reporting || next, revision: value.revision || prev.revision }));
      setChanges({});
      // No second checkbox: the specialized engine is enabled by this explicit save.
      setMessage("Paramètres enregistrés pour " + selectedClass.label + " — " + trackLabel[track] + ".");
      if (frenchSecondary) {
        const r = await fetch(historicalEndpoint, { cache: "no-store" });
        const data = await parseResponse<LegacyPayload>(r, "Rechargement des coefficients impossible");
        setHistorical(data.items || []);
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function editComponents(subject: Subject) {
    if (cycle !== "secondary" || !track || !level || isLoadingSubjects) return;
    const scope = componentScope;
    setComponentsScope(scope); setComponentsFor(subject); setComponents([]);
    setComponentsBusy(true); setError("");
    try {
      const query = new URLSearchParams({ subject_id: subject.id, class_id: actualClassId, cycle, track, level });
      const response = await fetch(componentsEndpoint + "?" + query, { cache: "no-store" });
      const payload = await parseResponse<ComponentPayload>(response, "Sous-matières indisponibles");
      if (contextRef.current !== scope) return;
      setComponentsRevision(payload.revision || "");
      setComponents((payload.items || []).map((row, i) => ({
        id: row.id, code: row.code || "c" + (i + 1), label: row.label || "",
        coeff_in_subject: Number(row.coeff_in_subject || 0),
        order_index: i + 1, is_active: row.is_active !== false,
      })));
    } catch (e) {
      if (contextRef.current === scope) { setError(errorMessage(e)); setComponentsFor(null); }
    } finally {
      if (contextRef.current === scope) setComponentsBusy(false);
    }
  }

  async function saveComponents() {
    if (!componentsFor || cycle !== "secondary" || !track || componentsScope !== componentScope || componentsBusy || !componentsRevision) return;
    const scope = componentScope;
    const active = components.filter(row => row.label.trim());
    const sum = active.reduce((total, row) => total + Number(row.coeff_in_subject), 0);
    const parent = Number(coeffFor(componentsFor.id));
    if (active.some(row => !Number.isFinite(row.coeff_in_subject) || row.coeff_in_subject <= 0) ||
      (showCoefficients && active.length > 0 && Math.abs(sum - parent) > 0.001)) {
      setError("La somme des sous-matières doit être égale au coefficient de la discipline."); return;
    }
    setComponentsBusy(true); setError("");
    try {
      const response = await fetch(componentsEndpoint, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject_id: componentsFor.id, class_id: actualClassId, cycle, track, level,
          revision: componentsRevision, items: active.map((row, i) => ({
          id: row.id, code: row.code, label: row.label.trim(),
          coeff_in_subject: Number(row.coeff_in_subject), order_index: i + 1, is_active: true,
        })) }),
      });
      await parseResponse<ResponseBase>(response, "Enregistrement des sous-matières impossible");
      if (contextRef.current !== scope) return;
      setMessage("Sous-matières enregistrées pour " + componentsFor.name + " — " + trackLabel[track] + ".");
      setComponentsFor(null);
    } catch (e) { if (contextRef.current === scope) setError(errorMessage(e)); }
    finally { if (contextRef.current === scope) setComponentsBusy(false); }
  }

  return <section className="space-y-4 rounded-2xl border bg-white p-5 shadow-sm" id="subject-coeffs">
    <header className="flex flex-wrap justify-between gap-3">
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-sky-700">Notation</p>
        <h2 className="text-lg font-bold text-slate-900">{cycle === "primary" ? "Barèmes des disciplines par matière" : "Coefficients des disciplines par niveau"}</h2>
        <p className="text-sm text-slate-600">Le même parcours que dans les établissements classiques. Les données restent séparées par enseignement.</p>
      </div>
      <button type="button" disabled={loading || saving} onClick={() => void refresh()}
        className="h-9 rounded-lg border px-3 text-sm disabled:opacity-40">Rafraîchir</button>
    </header>
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {message && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{message}</p>}
    {loading ? <p className="text-sm">Chargement des matières et coefficients…</p> : <>
      <div className="grid gap-3 rounded-xl border p-3 md:grid-cols-3">
        <label className="text-sm font-semibold">Cycle
          <select aria-label="Cycle" className="mt-1 block w-full rounded-lg border p-2" value={cycle || ""}
            onChange={e => {
              const first = programs.find(p => p.cycle === e.target.value);
              setProgramKey(first ? levelKey(first.cycle, first.track, "") : "");
              setClassId(""); setMessage("");
            }}>
            {Array.from(new Set(programs.map(x => x.cycle))).map(item =>
              <option key={item} value={item}>{programsLabel[item]}</option>)}
          </select>
        </label>
        <label className="text-sm font-semibold">Enseignement
          <select aria-label="Enseignement" className="mt-1 block w-full rounded-lg border p-2" value={track || ""}
            onChange={e => { setProgramKey(levelKey(cycle!, e.target.value as TeachingTrack, "")); setClassId(""); setMessage(""); }}>
            {programs.filter(row => row.cycle === cycle).map(row =>
              <option key={row.track} value={row.track}>{trackLabel[row.track]}</option>)}
          </select>
        </label>
        <label className="text-sm font-semibold">Niveau / classe
          <select aria-label="Niveau et classe" className="mt-1 block w-full rounded-lg border p-2" value={actualClassId}
            disabled={!scopedClasses.length} onChange={e => { setClassId(e.target.value); setMessage(""); }}>
            {scopedClasses.length === 0 && <option value="">Aucune classe configurée</option>}
            {scopedClasses.map(row => <option key={row.id} value={row.id}>{row.label}{row.level ? " — " + row.level : ""}</option>)}
          </select>
        </label>
      </div>
      {cycle === "preschool" ? <p className="rounded-lg bg-slate-50 p-3 text-sm">
        Au préscolaire, le livret utilise les compétences et observations existantes. Aucun coefficient de matière ni classement à saisir.
      </p> : !selectedClass ? <p role="alert" className="p-3 text-sm text-amber-900">Choisissez une classe configurée dans « Matières par classe ».</p> :
      <div className="space-y-3">
        {frenchSecondary && configuredSubjects.length > 0 && !isLoadingSubjects && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <h3 className="font-bold text-slate-900">Référentiel CI — Secondaire général</h3>
          <p className="text-xs text-slate-700">Initialisation rapide des coefficients officiels reconnus pour ce niveau ; les autres matières et les sous-matières existantes sont conservées.</p>
          <p className="mt-1 text-xs">{applicableCi.length} matière(s) reconnue(s).</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="rounded-lg border bg-white px-3 py-2 text-sm"
              onClick={() => setShowCiSecondaryPreview(v => !v)}>Prévisualiser</button>
            <button type="button" className="rounded-lg bg-emerald-700 px-3 py-2 text-sm text-white"
              disabled={applicableCi.length === 0 || saving} onClick={applyCiSecondary}>Appliquer CI</button>
          </div>
          {showCiSecondaryPreview && <ul className="mt-3 grid gap-1 text-xs sm:grid-cols-2">
            {ciSecondaryPreview.map(row => <li key={row.subject_id} className="rounded-lg bg-white p-2">
              {row.subject_name} : {row.coeff ?? "Non reconnu"}
            </li>)}
          </ul>}
        </div>}
        {cycle === "primary" && track === "french" && <div className="rounded-xl border border-sky-200 bg-sky-50 p-4">
          <h3 className="font-bold">Référentiel CI — Primaire français</h3>
          <p className="text-xs">Les matières existantes sont conservées. Barème de bulletin /10 ; barèmes particuliers par composition.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={() => void primaryCiReference(false)}
              disabled={ciBusy} className="rounded-lg border bg-white px-3 py-2 text-sm">Prévisualiser</button>
            <button type="button" onClick={() => void primaryCiReference(true)}
              disabled={ciBusy || !ciPrimary?.matches?.length || ciPrimary?.classId !== actualClassId}
              className="rounded-lg bg-emerald-700 px-3 py-2 text-sm text-white disabled:opacity-50">Appliquer CI</button>
          </div>
          {ciPrimary?.classId === actualClassId && <p className="mt-2 text-xs">
            {ciPrimary.matches.length} matière(s) reconnue(s), {ciPrimary.newlyAssociated.length} à associer.
            {ciPrimary.missing.length > 0 && " Matières absentes : " + ciPrimary.missing.join(", ")}
          </p>}
        </div>}
        {cycle === "primary" || arabicSecondary ? <label className="inline-block text-sm font-semibold">
          {cycle === "primary" ? "Barème général du bulletin" : "Barème des notes"} — {selectedClass.label} (valeur confirmée par l’établissement)
          <input aria-label="Barème des notes" type="number" min={1} max={100} step={1} className="mt-1 block w-36 rounded-lg border p-2"
            placeholder="À renseigner" disabled={saving}
            value={scaleDisplay} onChange={e => setScaleChange(e.target.value)}/>
        </label> : null}
        {cycle === "primary" && <p className="text-xs text-slate-600">
          {primaryFrenchReferenceApplied
            ? "Référentiel CI appliqué : les barèmes de composition sont affichés pour chaque matière. Ils ne sont pas des coefficients. La moyenne générale du bulletin reste sur /10."
            : "Le barème affiché par matière est celui de l'enseignement. Les barèmes spécifiques non confirmés ne sont pas déduits automatiquement."}
        </p>}
        {isLoadingSubjects ? <p className="text-sm text-slate-600">Chargement des disciplines de la classe…</p> :
          configuredSubjects.length === 0 ? <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
            Aucune matière affectée à cette classe et à cet enseignement. Utilisez « Répartition des matières » et « Matières par classe » ci-dessous.
          </p> : <div className="overflow-x-auto rounded-lg border">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600"><tr>
                <th className="px-3 py-2 text-left">Discipline</th>
                {showCoefficients ? <>
                  <th className="px-3 py-2 text-right">Coefficient bulletin</th>
                  <th className="px-3 py-2 text-right">Sous-matières (optionnel)</th>
                </> : <th className="px-3 py-2 text-right">Barème de composition</th>}
              </tr></thead>
              <tbody className="divide-y">
                {configuredSubjects.map(subject => <tr key={subject.id}>
                  <td className="px-3 py-2 font-medium">{subject.name}</td>
                  {showCoefficients && <td className="px-3 py-2 text-right">
                    <input aria-label={"Coefficient " + subject.name} type="number" min={0} max={99} step={0.5}
                      value={coeffFor(subject.id)} disabled={saving}
                      onChange={event => onCoeffChange(subject.id, event.target.value)}
                      placeholder="À renseigner" className="w-24 rounded-lg border px-2 py-1 text-right"/>
                  </td>}
                  <td className="px-3 py-2 text-right">
                    {showCoefficients ? <button type="button" className="rounded-lg border px-2 py-1 text-xs"
                        disabled={componentsBusy || saving} onClick={() => void editComponents(subject)}>Ajouter / modifier les sous-matières</button>
                      : <span aria-label={"Barème de composition " + subject.name} className="font-semibold text-slate-800">
                          {primaryCompositionScale(subject) === null ? "Non défini" : "/" + primaryCompositionScale(subject)}
                        </span>}
                  </td>
                </tr>)}
              </tbody>
            </table>
          </div>}
        {configuredSubjects.length > 0 && !isLoadingSubjects &&
          <div className="flex justify-end"><button type="button" disabled={saving}
            onClick={() => void save()} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {saving ? "Enregistrement…" : cycle === "primary" ? "Enregistrer le barème général" : "Enregistrer les coefficients"}
          </button></div>}
      </div>}
    </>}
    {componentsFor && componentsScope === componentScope && <div className="rounded-xl border border-sky-200 bg-sky-50 p-4">
      <h3 className="font-semibold">Sous-matières de {componentsFor.name} — {level}</h3>
      <p className="mb-3 text-xs text-slate-600">La somme des sous-matières doit correspondre au coefficient total de la matière. Enregistrez d’abord ce coefficient.</p>
      {componentsBusy && <p>Chargement ou enregistrement…</p>}
      {components.map((row, index) => <div key={index} className="mb-2 grid grid-cols-[1fr_6rem_auto] gap-2">
        <input aria-label={"Sous-matière " + (index + 1)} className="rounded-lg border p-2 text-sm" value={row.label} disabled={componentsBusy}
          onChange={e => setComponents(old => old.map((v, i) => i === index ? { ...v, label: e.target.value } : v))}/>
        <input aria-label={"Coefficient sous-matière " + (index + 1)} className="rounded-lg border p-2 text-sm" type="number" min={0} step={0.5}
          disabled={componentsBusy} value={numberInput(row.coeff_in_subject)}
          onChange={e => setComponents(old => old.map((v, i) => i === index ? { ...v, coeff_in_subject: Number(e.target.value) } : v))}/>
        <button type="button" disabled={componentsBusy} onClick={() => setComponents(old => old.filter((_, i) => i !== index))} className="rounded-lg border px-2">Retirer</button>
      </div>)}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="rounded-lg border px-3 py-2 text-sm" disabled={componentsBusy} onClick={() => setComponents(old => [...old, {
          code: "c_" + crypto.randomUUID(), label: "", coeff_in_subject: 1,
          order_index: old.length + 1, is_active: true,
        }])}>+ Ajouter une sous-matière</button>
        <button type="button" className="rounded-lg bg-sky-700 px-3 py-2 text-sm text-white" disabled={componentsBusy || !componentsRevision}
          onClick={() => void saveComponents()}>Enregistrer les sous-matières</button>
        <button type="button" className="rounded-lg border px-3 py-2 text-sm" onClick={() => setComponentsFor(null)}>Fermer</button>
      </div>
    </div>}
  </section>;
}
