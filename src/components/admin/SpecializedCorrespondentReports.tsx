"use client";

import { useEffect, useMemo, useState } from "react";
import type { TeachingTrack } from "@/lib/school-cycles";
import type { SpecializedBulletinPayload } from "@/lib/server/specialized-bulletin";
import "./SpecializedCorrespondentReports.print.css";

type Mode = "council" | "term" | "annual" | "balance" | "unclassified";
type SchoolClass = { id: string; label: string; level?: string | null; academic_year: string };
type SchoolPeriod = {
  id: string; label: string; code?: string | null; start_date: string;
  end_date: string; is_active?: boolean | null;
};
type Entry = SpecializedBulletinPayload["documents"][number];
type Program = NonNullable<Entry["document"]["french"]>;
type PeriodReport = { period: SchoolPeriod; payload: SpecializedBulletinPayload };
const TITLES: Record<Mode, string> = {
  council: "Conseil de classe", term: "Matrice trimestrielle",
  annual: "Matrice annuelle", balance: "Bilan des résultats", unclassified: "Élèves non classés",
};
const TRACK_LABELS: Record<TeachingTrack, string> = {
  french: "Enseignement français", arabic: "Enseignement arabe",
};
function readableError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "PRESCHOOL_QUALITATIVE_STORAGE_REQUIRED")
    return "Le préscolaire nécessite son livret qualitatif. Aucune moyenne numérique ne peut être produite.";
  if (message === "PERIOD_NOT_APPLICABLE_TO_CLASS")
    return "Cette période ne correspond pas à la classe sélectionnée.";
  if (message === "CLASS_TEACHING_NOT_CONFIGURED")
    return "Les enseignements de cette classe ne sont pas encore configurés.";
  if (message === "SPECIALIZED_CONFIGURATION_INVALID")
    return "Le barème ou les coefficients franco-arabes sont à corriger avant l'édition.";
  return message;
}
async function requestData<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: "no-store", signal });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.ok === false) {
    throw new Error(String(json.error || json.message || "Chargement impossible"));
  }
  return json as T;
}
function programFor(entry: Entry | undefined, track: TeachingTrack): Program | null {
  if (!entry || entry.programReadiness?.[track] !== true) return null;
  return entry.document[track] ?? null;
}
function studentName(entry: Entry) {
  const { lastName, firstName, matricule } = entry.document.student;
  return [lastName, firstName].filter(Boolean).join(" ") || matricule || "Élève sans nom";
}
function formatScore(value: number | null | undefined, denominator: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (!denominator || !Number.isFinite(denominator)) return "—";
  return `${value.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / ${denominator}`;
}
function isAllComplete(reports: PeriodReport[], track: TeachingTrack) {
  return reports.length > 0 && reports.every(({ payload }) =>
    payload.documents.length > 0 && payload.documents.every(entry =>
      !entry.document[track] || entry.programReadiness?.[track] === true));
}
function numberMeanOn20(programs: Program[]): number | null {
  if (!programs.length) return null;
  if (programs.some(p => !p.denominator || p.generalAverage === null)) return null;
  const sum = programs.reduce((total, p) => total + 20 * p.generalAverage! / p.denominator, 0);
  return Number((sum / programs.length).toFixed(2));
}

export default function SpecializedCorrespondentReports({ mode }: { mode: Mode }) {
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [year, setYear] = useState("");
  const [classId, setClassId] = useState("");
  const [periods, setPeriods] = useState<SchoolPeriod[]>([]);
  const [periodId, setPeriodId] = useState("");
  const [track, setTrack] = useState<TeachingTrack>("french");
  const [reports, setReports] = useState<PeriodReport[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    requestData<{ items?: SchoolClass[] }>("/api/admin/classes?academic_year=all&education_type=all&limit=1000", controller.signal)
      .then(data => {
        const rows = (data.items || []).filter(row => row.id && row.academic_year);
        setClasses(rows);
        setYear(Array.from(new Set(rows.map(row => row.academic_year))).sort().reverse()[0] || "");
      })
      .catch(err => { if (!controller.signal.aborted) setError(readableError(err)); });
    return () => controller.abort();
  }, []);

  const years = useMemo(() =>
    Array.from(new Set(classes.map(row => row.academic_year))).sort().reverse(), [classes]);
  const availableClasses = useMemo(() =>
    classes.filter(row => row.academic_year === year), [classes, year]);
  useEffect(() => { setClassId(""); setPeriods([]); setPeriodId(""); setReports([]); setLoaded(false); }, [year]);

  useEffect(() => {
    setPeriods([]); setPeriodId(""); setReports([]); setLoaded(false);
    if (!classId || !year) return;
    const controller = new AbortController();
    const url = `/api/admin/institution/grading-periods?academic_year=${encodeURIComponent(year)}&class_id=${encodeURIComponent(classId)}`;
    requestData<{ items?: SchoolPeriod[] }>(url, controller.signal).then(data => {
      const available = (data.items || []).filter(row =>
        row.id && row.is_active !== false && row.start_date && row.end_date);
      setPeriods(available);
      setPeriodId(available[0]?.id || "");
    }).catch(err => { if (!controller.signal.aborted) setError(readableError(err)); });
    return () => controller.abort();
  }, [classId, year]);

  useEffect(() => { setReports([]); setLoaded(false); }, [periodId, mode]);

  async function loadReport() {
    if (!classId || !year || !periodId || busy) return;
    const relevant = mode === "annual" ? periods.slice(0, 12) : periods.filter(p => p.id === periodId);
    if (!relevant.length) return;
    setBusy(true); setError(""); setLoaded(false); setReports([]);
    try {
      // No mutation or legacy fallback. Bounded reads, scoped to the selected
      // institution/class by the same authorized bulletin API as the official UI.
      const response: PeriodReport[] = [];
      for (const period of relevant) {
        const params = new URLSearchParams({
          class_id: classId, academic_year: year, period_id: period.id,
          from: period.start_date, to: period.end_date,
        });
        const data = await requestData<{ specialized?: SpecializedBulletinPayload }>(
          `/api/admin/grades/bulletin?${params}`, new AbortController().signal);
        if (!data.specialized || data.specialized.engine !== "specialized")
          throw new Error("Le moteur officiel spécialisé n'est pas activé pour cette classe.");
        response.push({ period, payload: data.specialized });
      }
      setReports(response);
      const availableTracks = new Set(response.flatMap(p => p.payload.programs));
      if (!availableTracks.has(track) && availableTracks.has("arabic")) setTrack("arabic");
    } catch (err) {
      setError(readableError(err));
    } finally { setLoaded(true); setBusy(false); }
  }

  const chosenClass = classes.find(row => row.id === classId);
  const chosenPeriod = periods.find(row => row.id === periodId);
  const supportedTracks = useMemo(() => Array.from(new Set(reports.flatMap(r => r.payload.programs))), [reports]);
  const selectedTrack = supportedTracks.includes(track) ? track : supportedTracks[0] || track;
  const first = reports[0]?.payload;
  const unique = useMemo(() => {
    const values = new Map<string, Entry>();
    for (const report of reports) for (const entry of report.payload.documents) {
      // An enrolment may appear in a later period, or only acquire the
      // selected teaching track in that period. Never silently drop it.
      const previous = values.get(entry.studentId);
      if (!previous || (!previous.document[selectedTrack] && entry.document[selectedTrack])) {
        values.set(entry.studentId, entry);
      }
    }
    return [...values.values()].filter(row => row.document[selectedTrack]);
  }, [reports, selectedTrack]);
  const current = mode === "annual" ? unique :
    first?.documents.filter(row => row.document[selectedTrack]) || [];
  const complete = current.filter(row => !!programFor(row, selectedTrack));
  const pending = current.filter(row => !programFor(row, selectedTrack));
  const subjects = useMemo(() => {
    const names = new Map<string, string>();
    for (const report of reports) for (const row of report.payload.documents) {
      for (const subject of row.document[selectedTrack]?.subjects || []) {
        names.set(subject.id, subject.name);
      }
    }
    return Array.from(names, ([id, name]) => ({ id, name }));
  }, [reports, selectedTrack]);
  const ranked = [...current].sort((a, b) => {
    const one = programFor(a, selectedTrack)?.rank ?? Infinity;
    const two = programFor(b, selectedTrack)?.rank ?? Infinity;
    return one - two || studentName(a).localeCompare(studentName(b), "fr");
  });
  const display = mode === "unclassified" ? pending : mode === "council" ? ranked : current;
  // A partial class average would appear official. Show it only when
  // every expected programme result is complete.
  const classMean = complete.length === current.length
    ? numberMeanOn20(complete.map(row => programFor(row, selectedTrack)!)) : null;
  const annualFullyCovered = unique.every(entry => reports.every(report => {
    const row = report.payload.documents.find(item => item.studentId === entry.studentId);
    return !!programFor(row, selectedTrack);
  }));
  const printable = mode === "unclassified" ? reports.length > 0 :
    isAllComplete(reports, selectedTrack) && unique.length > 0 &&
    (mode !== "annual" || annualFullyCovered);

  return <section className="space-y-5">
    <header className="print:hidden">
      <div className="text-xs font-semibold uppercase tracking-widest text-emerald-700">
        Correspondant Fichier · Enseignements franco-arabes
      </div>
      <h1 className="mt-1 text-2xl font-bold text-slate-900">{TITLES[mode]}</h1>
      <p className="mt-2 text-sm text-slate-600">
        Les résultats proviennent des notes officiellement publiées. Français et arabe restent
        indépendants, y compris pour les rangs, matières et barèmes.
      </p>
    </header>
    <div className="grid gap-3 rounded-xl border bg-white p-4 print:hidden sm:grid-cols-2 lg:grid-cols-4">
      <label className="text-sm">Année scolaire
        <select aria-label="Année scolaire" className="mt-1 w-full rounded-lg border p-2" value={year}
          onChange={e => { setYear(e.target.value); setError(""); }}>
          {years.map(item => <option key={item} value={item}>{item}</option>)}
        </select>
      </label>
      <label className="text-sm">Classe
        <select aria-label="Classe" className="mt-1 w-full rounded-lg border p-2" value={classId}
          onChange={e => { setClassId(e.target.value); setError(""); }}>
          <option value="">— Choisir une classe —</option>
          {availableClasses.map(item => <option key={item.id} value={item.id}>
            {item.label} · {item.level || ""}
          </option>)}
        </select>
      </label>
      <label className="text-sm">Période
        <select aria-label="Période" className="mt-1 w-full rounded-lg border p-2" value={periodId}
          onChange={e => setPeriodId(e.target.value)} disabled={!classId}>
          <option value="">— Choisir une période —</option>
          {periods.map(item => <option key={item.id} value={item.id}>{item.label || item.code || item.id}</option>)}
        </select>
      </label>
      <div className="flex items-end">
        <button type="button" disabled={busy || !classId || !periodId}
          className="w-full rounded-lg bg-emerald-700 p-2.5 font-semibold text-white disabled:opacity-50"
          onClick={() => void loadReport()}>{busy ? "Chargement…" : "Afficher les résultats"}</button>
      </div>
    </div>
    {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 print:hidden">{error}</p>}
    {classId && !periods.length && !error && <p className="text-sm text-slate-600 print:hidden">
      Aucune période disponible pour cette classe : les bulletins et les rapports ne peuvent pas être calculés.
    </p>}
    {loaded && !!reports.length && <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <label className="min-w-56 text-sm">Enseignement
          <select className="mt-1 w-full rounded-lg border p-2" value={selectedTrack}
            onChange={e => setTrack(e.target.value as TeachingTrack)}>
            {supportedTracks.map(item => <option key={item} value={item}>{TRACK_LABELS[item]}</option>)}
          </select>
        </label>
        <button type="button" disabled={!printable} onClick={() => window.print()}
          className="rounded-lg border px-4 py-2 font-semibold disabled:opacity-40">Imprimer le rapport</button>
      </div>
      <div id="specialized-correspondent-report" className="space-y-4 rounded-xl border bg-white p-4 sm:p-6">
        <div className="border-b pb-3 text-center">
          <p className="text-sm font-semibold">RÉPUBLIQUE DE CÔTE D’IVOIRE</p>
          <p className="text-xs">Union - Discipline - Travail</p>
          <h2 className="mt-3 text-lg font-bold uppercase">{TITLES[mode]} · {TRACK_LABELS[selectedTrack]}</h2>
          <p className="text-sm">{chosenClass?.label} · {year} · {mode === "annual" ? "Toutes les périodes" : chosenPeriod?.label}</p>
          <p className="text-xs font-semibold text-amber-800">DOCUMENT DE TRAVAIL — N’EST PAS UN BULLETIN OFFICIEL</p>
        </div>
        {mode === "balance" && <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>Effectif : <strong>{current.length}</strong></div>
          <div>Résultats complets : <strong>{complete.length}</strong></div>
          <div>Résultats incomplets : <strong>{pending.length}</strong></div>
          <div>Moyenne de classe /20 : <strong>{classMean?.toFixed(2) || "—"}</strong>
            {pending.length > 0 && <span className="block text-xs text-amber-800">Résultats incomplets : moyenne non calculable</span>}
          </div>
        </div>}
        {mode === "council" && <p className="text-sm text-amber-800">
          Consultation pédagogique uniquement. Les décisions du conseil ne sont pas enregistrées
          depuis cette vue, pour éviter d’appliquer les décisions de l’ancien cursus aux deux enseignements.
        </p>}
        {mode === "annual" && <p className="text-sm text-amber-800">
          Récapitulatif des périodes publiées. Aucune moyenne ni aucun rang annuel officiel n’est inventé.
        </p>}
        {mode === "unclassified" && <p className="text-sm text-amber-800">
          Cette liste est dérivée de la complétude des notes de {TRACK_LABELS[selectedTrack].toLowerCase()}.
          Elle n’enregistre aucune décision « non classé » de l’ancien cursus.
        </p>}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs sm:text-sm">
            <thead><tr className="border-b bg-slate-50">
              <th className="p-2">Élève</th>
              {mode === "term" && subjects.map(subject =>
                <th key={subject.id} className="p-2 text-center">{subject.name}</th>)}
              {mode === "annual" && reports.map(item =>
                <th key={item.period.id} className="p-2 text-center">{item.period.label}</th>)}
              {mode !== "annual" && <th className="p-2 text-center">Moyenne</th>}
              {mode !== "annual" && <th className="p-2 text-center">Rang</th>}
              <th className="p-2 text-center">Statut</th>
            </tr></thead>
            <tbody>
              {display.map(entry => {
                const program = programFor(entry, selectedTrack);
                return <tr key={entry.studentId} className="border-b">
                  <td className="p-2 font-semibold">{studentName(entry)}</td>
                  {mode === "term" && subjects.map(subject => {
                    const item = program?.subjects.find(s => s.id === subject.id);
                    return <td key={subject.id} className="p-2 text-center">
                      {item ? formatScore(item.average, program!.denominator) : "—"}
                    </td>;
                  })}
                  {mode === "annual" && reports.map(report => {
                    const row = report.payload.documents.find(item => item.studentId === entry.studentId);
                    const periodProgram = programFor(row, selectedTrack);
                    return <td key={report.period.id} className="p-2 text-center">
                      {periodProgram ? formatScore(periodProgram.generalAverage, periodProgram.denominator) : "—"}
                    </td>;
                  })}
                  {mode !== "annual" && <td className="p-2 text-center">
                    {program ? formatScore(program.generalAverage, program.denominator) : "—"}</td>}
                  {mode !== "annual" && <td className="p-2 text-center">{program?.rank ?? "—"}</td>}
                  <td className="p-2 text-center">{mode === "annual"
                    ? (reports.every(report => {
                        const row = report.payload.documents.find(item => item.studentId === entry.studentId);
                        return !!programFor(row, selectedTrack);
                      }) ? "Complet" : "Incomplet")
                    : program ? "Complet" : "Incomplet"}</td>
                </tr>;
              })}
            </tbody>
          </table>
          {!display.length && <p className="p-4 text-sm text-slate-500">Aucun élève correspondant à ce rapport.</p>}
        </div>
        {!printable && mode !== "unclassified" && <p className="text-sm font-semibold text-rose-700 print:hidden">
          Impression bloquée tant que certains résultats du programme sont incomplets.
        </p>}
      </div>
    </div>}
  </section>;
}
