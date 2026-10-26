"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, FileSpreadsheet, Loader2, Printer, RefreshCw } from "lucide-react";
import {
  type AffectationFilter, type SchoolReportKind, type ReportTrack,
  type SchoolReportClass, type ReportRosterResponse, type ReportBulletinResponse,
  buildSchoolCsv, buildSchoolReportClass, buildStatisticsSections, number, pct,
  selectAffectation,
} from "@/lib/school-results-reports";
import { buildSchoolReportHtml } from "@/lib/school-results-print";

type SchoolClass = { id: string; label: string; level: string | null; academic_year: string };
type Period = {
  id: string; code?: string | null; label?: string | null; short_label?: string | null;
  start_date?: string | null; end_date?: string | null; order_index?: number | null;
  is_active?: boolean | null;
};

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: "no-store" });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.ok === false) {
    throw new Error(String(json.error || "Impossible de récupérer les données officielles."));
  }
  return json as T;
}

function cleanFilename(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 100);
}

function formatPeriod(period: Period): string {
  return String(period.short_label || period.label || period.code || "Période");
}

function findSamePeriod(periods: Period[], selected: Period): Period | null {
  const active = periods.filter(p => p.is_active !== false && p.start_date && p.end_date);
  const wantedCode = String(selected.code || "").trim().toLowerCase();
  if (wantedCode) {
    const same = active.find(p => String(p.code || "").trim().toLowerCase() === wantedCode);
    if (same) return same;
  }
  const wantedLabel = String(selected.label || "").trim().toLowerCase();
  if (wantedLabel) {
    const same = active.find(p => String(p.label || "").trim().toLowerCase() === wantedLabel);
    if (same) return same;
  }
  return null;
}

function downloadCsv(data: string, filename: string): void {
  const blob = new Blob([data], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function printHtml(html: string): void {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.style.opacity = "0";
  document.body.appendChild(iframe);
  const frame = iframe.contentWindow;
  if (!frame) {
    iframe.remove();
    throw new Error("Le navigateur ne permet pas de préparer l'impression.");
  }
  const cleanup = () => {
    frame.removeEventListener("afterprint", cleanup);
    iframe.remove();
  };
  frame.addEventListener("afterprint", cleanup);
  const doc = frame.document;
  doc.open();
  doc.write(html);
  doc.close();
  window.setTimeout(() => {
    try {
      frame.focus();
      frame.print();
    } catch {
      cleanup();
    }
  }, 400);
}

export default function RapportsScolairesPage() {
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [academicYear, setAcademicYear] = useState("");
  const [classId, setClassId] = useState("");
  const [periods, setPeriods] = useState<Period[]>([]);
  const [periodId, setPeriodId] = useState("");
  const [kind, setKind] = useState<SchoolReportKind>("statistics");
  const [affectation, setAffectation] = useState<AffectationFilter>("all");
  const [track, setTrack] = useState<ReportTrack>("french");
  const [result, setResult] = useState<SchoolReportClass[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingClasses, setLoadingClasses] = useState(true);
  const [periodsLoading, setPeriodsLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    void getJson<{ items?: SchoolClass[] }>("/api/admin/classes?academic_year=all&education_type=all&limit=5000")
      .then(json => {
        if (cancelled) return;
        const data = (json.items || []).filter(c => c.id && c.academic_year);
        setClasses(data);
        setAcademicYear(Array.from(new Set(data.map(c => c.academic_year))).sort().reverse()[0] || "");
      }).catch(e => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoadingClasses(false); });
    return () => { cancelled = true; };
  }, []);

  const years = useMemo(() => Array.from(new Set(classes.map(c => c.academic_year))).sort().reverse(), [classes]);
  const availableClasses = useMemo(() => classes.filter(c => c.academic_year === academicYear), [classes, academicYear]);
  const selectedClass = availableClasses.find(c => c.id === classId);
  const firstClass = selectedClass || availableClasses[0];
  const selectedPeriod = periods.find(p => p.id === periodId);

  useEffect(() => {
    setResult(null);
    setError("");
    setNotice("");
    setPeriods([]);
    setPeriodId("");
    const classForPeriod = classId && availableClasses.some(c => c.id === classId)
      ? classId : availableClasses[0]?.id;
    if (!classForPeriod || !academicYear) return;
    let cancelled = false;
    setPeriodsLoading(true);
    const qs = new URLSearchParams({ academic_year: academicYear, class_id: classForPeriod });
    void getJson<{ items?: Period[] }>("/api/admin/institution/grading-periods?" + qs.toString())
      .then(json => {
        if (cancelled) return;
        const items = (json.items || []).filter(p => p.id && p.is_active !== false && p.start_date && p.end_date);
        setPeriods(items);
        setPeriodId(items[0]?.id || "");
      }).catch(e => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setPeriodsLoading(false); });
    return () => { cancelled = true; };
  }, [academicYear, classId, availableClasses]);

  useEffect(() => {
    setResult(null);
    setNotice("");
  }, [periodId, track]);

  async function loadReport() {
    if (busy || !selectedPeriod || !firstClass) return;
    setBusy(true);
    setError("");
    setNotice("");
    setResult(null);
    try {
      const targets = classId ? availableClasses.filter(cls => cls.id === classId) : availableClasses;
      if (!targets.length) throw new Error("Aucune classe pour cette année scolaire.");
      const resultRows: SchoolReportClass[] = [];
      for (let offset = 0; offset < targets.length; offset += 2) {
        const batch = targets.slice(offset, offset + 2);
        const snapshots = await Promise.all(batch.map(async cls => {
          const periodResponse = cls.id === firstClass.id
            ? { items: periods }
            : await getJson<{ items?: Period[] }>("/api/admin/institution/grading-periods?" +
                new URLSearchParams({ academic_year: academicYear, class_id: cls.id }).toString());
          const p = findSamePeriod(periodResponse.items || [], selectedPeriod);
          if (!p || !p.start_date || !p.end_date) {
            throw new Error("La période « " + formatPeriod(selectedPeriod) +
              " » n'existe pas pour " + cls.label + ". Sélectionnez une classe ou une période commune.");
          }
          const params = new URLSearchParams({
            class_id: cls.id, academic_year: academicYear,
            period_id: p.id, from: p.start_date, to: p.end_date, export_light: "1", active_only: "false",
          });
          const [roster, bulletin] = await Promise.all([
            getJson<ReportRosterResponse>("/api/admin/classes/" + encodeURIComponent(cls.id) +
              "/roster?academic_year=" + encodeURIComponent(academicYear)),
            getJson<ReportBulletinResponse>("/api/admin/grades/bulletin?" + params.toString()),
          ]);
          return buildSchoolReportClass({
            id: cls.id, label: cls.label, level: cls.level || "",
            roster, bulletin, track,
          });
        }));
        resultRows.push(...snapshots);
      }
      setResult(resultRows);
      const unknown = resultRows.reduce((n, cls) => n + cls.students.filter(s => s.isAffected === null).length, 0);
      if (unknown) setNotice(String(unknown) + " statut(s) d'affectation non renseigné(s), conservé(s) dans « Tous les élèves ».");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible de construire le rapport.");
    } finally {
      setBusy(false);
    }
  }

  const displayedStudents = useMemo(() =>
    (result || []).flatMap(cls => selectAffectation(cls.students, affectation)), [result, affectation]);
  const total = displayedStudents.length;
  const classed = displayedStudents.filter(s => s.average !== null).length;
  const title = kind === "statistics" ? "Synthèse statistique des résultats" : "Liste nominative des résultats";
  const filenameBase = cleanFilename((kind === "statistics" ? "synthese_statistique" : "liste_nominative") +
    "_" + academicYear + "_" + (selectedPeriod ? formatPeriod(selectedPeriod) : "periode"));

  function exportCsv() {
    if (!result) return;
    downloadCsv(buildSchoolCsv(result, kind, affectation), filenameBase + ".csv");
  }

  function exportPdf() {
    if (!result || !selectedPeriod) return;
    printHtml(buildSchoolReportHtml({
      classes: result,
      kind, filter: affectation,
      academicYear, periodLabel: formatPeriod(selectedPeriod), track,
    }));
  }

  const inputClass = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-500";
  const formLabel = "mb-1 block text-xs font-bold uppercase tracking-wide text-slate-600";

  return (
    <main className="space-y-5 px-3 py-5 sm:px-6">
      <header className="rounded-2xl bg-slate-950 px-5 py-6 text-white shadow-sm">
        <p className="text-xs font-bold uppercase tracking-widest text-emerald-300">Correspondant Fichier</p>
        <h1 className="mt-1 text-2xl font-black">Rapports scolaires</h1>
        <p className="mt-2 text-sm text-slate-300">Statistiques et listes nominatives issues des bulletins officiels. PDF ou CSV, sans ressaisie.</p>
      </header>
      <section className="rounded-2xl border bg-white p-4 shadow-sm sm:p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className={formLabel} htmlFor="report-kind">Type de rapport</label>
            <select id="report-kind" className={inputClass} value={kind} onChange={e => setKind(e.target.value as SchoolReportKind)}>
              <option value="statistics">Synthèse statistique des résultats</option>
              <option value="nominal">Liste nominative des résultats</option>
            </select>
          </div>
          <div>
            <label className={formLabel} htmlFor="report-year">Année scolaire</label>
            <select id="report-year" className={inputClass} value={academicYear} onChange={e => { setClassId(""); setAcademicYear(e.target.value); }} disabled={loadingClasses}>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <label className={formLabel} htmlFor="report-class">Niveau / classe</label>
            <select id="report-class" className={inputClass} value={classId} onChange={e => setClassId(e.target.value)} disabled={loadingClasses}>
              <option value="">Tout l'établissement</option>
              {availableClasses.map(c => <option key={c.id} value={c.id}>{c.label}{c.level ? " · " + c.level : ""}</option>)}
            </select>
          </div>
          <div>
            <label className={formLabel} htmlFor="report-period">Période</label>
            <select id="report-period" className={inputClass} value={periodId} onChange={e => setPeriodId(e.target.value)} disabled={periodsLoading || !periods.length}>
              {!periods.length && <option value="">Aucune période configurée</option>}
              {periods.map(p => <option key={p.id} value={p.id}>{formatPeriod(p)}</option>)}
            </select>
          </div>
          <div>
            <label className={formLabel} htmlFor="report-affectation">Affectation</label>
            <select id="report-affectation" className={inputClass} value={affectation} onChange={e => setAffectation(e.target.value as AffectationFilter)}>
              <option value="all">Tous les élèves</option>
              <option value="affected">Élèves affectés</option>
              <option value="unaffected">Élèves non affectés</option>
            </select>
          </div>
          <div>
            <label className={formLabel} htmlFor="report-track">Enseignement</label>
            <select id="report-track" className={inputClass} value={track} onChange={e => setTrack(e.target.value as ReportTrack)}>
              <option value="french">Enseignement français / général</option>
              <option value="arabic">Enseignement arabe (si configuré)</option>
            </select>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <button type="button" disabled={!selectedPeriod || busy || loadingClasses || periodsLoading}
            onClick={() => void loadReport()}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-40">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {busy ? "Calcul du rapport…" : "Afficher le rapport"}
          </button>
          <button type="button" disabled={!result || busy} onClick={exportPdf}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-40">
            <Printer className="h-4 w-4" /> Imprimer / PDF
          </button>
          <button type="button" disabled={!result || busy} onClick={exportCsv}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-40">
            <Download className="h-4 w-4" /> Télécharger CSV
          </button>
        </div>
        {error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800">{error}</p>}
        {notice && <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{notice}</p>}
        <p className="mt-3 text-xs text-slate-500">Le PDF utilise l'impression du navigateur. Aucun document n'est enregistré dans Supabase. Les périodes incompatibles entre classes bloquent le rapport global au lieu de produire un total incomplet.</p>
      </section>
      {result && (
        <section className="rounded-2xl border bg-white p-4 shadow-sm sm:p-6">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-emerald-700" />
            <h2 className="text-lg font-bold text-slate-900">{title}</h2>
          </div>
          <p className="mt-1 text-sm text-slate-600">{academicYear} · {selectedPeriod && formatPeriod(selectedPeriod)} · {result.length} classe(s)</p>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-500">Élèves</div><div className="text-2xl font-black">{total}</div></div>
            <div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-500">Classés</div><div className="text-2xl font-black">{classed}</div></div>
            <div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-500">Non classés</div><div className="text-2xl font-black">{total - classed}</div></div>
          </div>
          <div className="mt-4 overflow-x-auto">
            {kind === "statistics" ? (
              <table className="w-full min-w-[650px] border-collapse text-left text-sm">
                <thead><tr className="border-b bg-slate-50"><th className="p-2">Classe</th><th className="p-2">Niveau</th><th className="p-2">Effectif</th><th className="p-2">Classés</th><th className="p-2">≥ 10 /20</th><th className="p-2">Taux</th><th className="p-2">Moy. /20</th></tr></thead>
                <tbody>{buildStatisticsSections(result, affectation).slice(-1).flatMap(s => s.classRows.filter(r => r.gender === "T")).map((row, i) => (
                  <tr key={row.className + i} className="border-b">
                    <td className="p-2">{row.className}</td><td className="p-2">{row.level}</td><td className="p-2">{row.total.effectif}</td>
                    <td className="p-2">{row.total.classed}</td><td className="p-2">{row.total.above10}</td>
                    <td className="p-2">{pct(row.total.above10, row.total.classed)}</td><td className="p-2">{number(row.total.average20)}</td>
                  </tr>
                ))}</tbody>
              </table>
            ) : (
              <table className="w-full min-w-[620px] border-collapse text-left text-sm">
                <thead><tr className="border-b bg-slate-50"><th className="p-2">Classe</th><th className="p-2">Matricule</th><th className="p-2">Nom et prénoms</th><th className="p-2">Moyenne</th><th className="p-2">Rang</th></tr></thead>
                <tbody>{result.flatMap(cls => selectAffectation(cls.students, affectation).map(s => ({ cls, s }))).slice(0, 100).map(({ cls, s }) => (
                  <tr key={cls.id + s.id} className="border-b"><td className="p-2">{cls.label}</td><td className="p-2">{s.matricule || "—"}</td><td className="p-2">{s.name}</td>
                    <td className="p-2">{s.average === null ? "NC" : number(s.average) + " /" + s.denominator}</td><td className="p-2">{s.rank ?? "—"}</td></tr>
                ))}</tbody>
              </table>
            )}
          </div>
          {kind === "nominal" && total > 100 && <p className="mt-2 text-xs text-slate-500">Aperçu limité à 100 élèves ; les exports contiennent tous les élèves filtrés.</p>}
        </section>
      )}
    </main>
  );
}
