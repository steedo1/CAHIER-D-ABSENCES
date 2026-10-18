"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { PreschoolAttainment, PreschoolCompetency } from "@/lib/preschool-assessments";
import type { PreschoolRecord, PreschoolMark } from "@/lib/preschool-booklet-store";
import type { TeachingTrack } from "@/lib/school-cycles";
import "./print.css";

type ClassRow = { id: string; label: string | null; level: string | null; academic_year: string };
type Period = { id: string; label: string | null; start_date: string; end_date: string };
type Student = { id: string; name: string; matricule: string | null; tracks: TeachingTrack[] };
type Slot = { record: PreschoolRecord | null; ready: boolean };
type FormData = {
  ok: true; revision: string; year: string; schoolClass: ClassRow;
  classes: ClassRow[]; students: Student[]; periods: Period[];
  programs: TeachingTrack[]; format: "combined" | "separate" | "both";
  catalogs: Partial<Record<TeachingTrack, PreschoolCompetency[]>>;
  records: Record<string, Partial<Record<TeachingTrack, Slot>>>;
  schoolName: string; schoolCode: string;
  signatories: { french?: { name: string }; arabic?: { name: string } };
  admin: boolean; editable: boolean;
};
const TRACKS = { french: "Enseignement français", arabic: "Enseignement arabe" };
const LEVELS: Record<PreschoolAttainment, string> = {
  not_observed: "À observer",
  emerging: "Émergent",
  developing: "En cours d’acquisition",
  acquired: "Acquis",
};
const order: PreschoolAttainment[] = ["not_observed", "emerging", "developing", "acquired"];
const emptyRecord = (): Pick<PreschoolRecord, "observations" | "teacherComment"> =>
  ({ observations: {}, teacherComment: "" });
async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) {
    throw Error(body.message || body.error || "Chargement indisponible");
  }
  return body as T;
}
function parseCatalogDraft(value: string): PreschoolCompetency[] {
  const entries = value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!entries.length || entries.length > 40) throw Error("Le catalogue exige de 1 à 40 compétences.");
  const seen = new Set<string>();
  return entries.map(line => {
    const pieces = line.split("|").map(part => part.trim());
    if (pieces.length !== 3 || !/^[a-z0-9_-]{1,40}$/.test(pieces[0]) ||
        pieces[1].length < 2 || pieces[1].length > 100 ||
        pieces[2].length < 3 || pieces[2].length > 200 || seen.has(pieces[0])) {
      throw Error("Format attendu : code | Domaine | Compétence. Codes uniques, sans accents ni espaces.");
    }
    seen.add(pieces[0]);
    return { id: pieces[0], domain: pieces[1], label: pieces[2] };
  });
}
function readyFor(data: FormData, studentId: string, track: TeachingTrack) {
  return data.records[studentId]?.[track]?.ready === true;
}
export default function PreschoolBookletPage() {
  const [year, setYear] = useState("");
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [classId, setClassId] = useState("");
  const [data, setData] = useState<FormData | null>(null);
  const [periodId, setPeriodId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [track, setTrack] = useState<TeachingTrack>("french");
  const [variant, setVariant] = useState<"french" | "arabic" | "combined">("french");
  const [record, setRecord] = useState<Pick<PreschoolRecord, "observations" | "teacherComment">>(emptyRecord());
  const [catalogDraft, setCatalogDraft] = useState("");
  const [working, setWorking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async (yearValue: string, classValue: string, periodValue: string) => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams();
      if (yearValue) params.set("year", yearValue);
      if (classValue) params.set("class_id", classValue);
      if (periodValue) params.set("period_id", periodValue);
      const response = await getJson<FormData & { classes?: ClassRow[] }>(
        "/api/preschool/booklets?" + params.toString());
      if (!classValue) {
        setYear(response.year);
        setClasses(response.classes || []);
        setData(null);
      } else {
        setData(response);
        setPeriodId(current => response.periods.some(period => period.id === current)
          ? current : response.periods[0]?.id || "");
        setStudentId(current => response.students.some(student => student.id === current)
          ? current : response.students[0]?.id || "");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Lecture impossible");
      setData(null);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load("", "", ""); }, [load]);
  useEffect(() => {
    if (year && classId) void load(year, classId, periodId);
  }, [year, classId, periodId, load]);

  const student = data?.students.find(item => item.id === studentId);
  const enabledTracks = student?.tracks || [];
  const effectiveTrack = enabledTracks.includes(track) ? track : enabledTracks[0] || track;
  const catalog = data?.catalogs[effectiveTrack] || [];
  const slot = data?.records[studentId]?.[effectiveTrack];
  useEffect(() => {
    if (!data) return;
    setRecord(slot?.record ? {
      observations: slot.record.observations, teacherComment: slot.record.teacherComment,
    } : emptyRecord());
    setCatalogDraft(catalog.map(item => [item.id, item.domain, item.label].join(" | ")).join("\n"));
  }, [data, studentId, effectiveTrack]);

  const availableVariants = useMemo(() => {
    if (enabledTracks.length === 1) return [enabledTracks[0]];
    if (data?.format === "combined") return ["combined"];
    if (data?.format === "separate") return enabledTracks;
    return ["combined", ...enabledTracks];
  }, [enabledTracks, data?.format]);
  const previewVariant = availableVariants.includes(variant) ? variant : availableVariants[0] || "french";
  const printTracks: TeachingTrack[] = previewVariant === "combined"
    ? enabledTracks : [previewVariant as TeachingTrack];
  const printable = !!data && !!student && printTracks.length > 0 &&
    printTracks.every(item => readyFor(data, student.id, item) &&
      (data.catalogs[item]?.length || 0) > 0);
  const preview = student && data ? printTracks.map(currentTrack => ({
    track: currentTrack, catalog: data.catalogs[currentTrack] || [],
    record: data.records[student.id]?.[currentTrack]?.record,
    ready: readyFor(data, student.id, currentTrack),
  })) : [];

  const changeMark = (competencyId: string, patch: Partial<PreschoolMark>) => {
    setRecord(previous => ({
      ...previous, observations: {
        ...previous.observations,
        [competencyId]: {
          attainment: "not_observed", observation: "",
          ...previous.observations[competencyId], ...patch,
        },
      },
    }));
    setNotice("");
  };
  const save = async (mode: "catalog" | "record") => {
    if (!data || working || !effectiveTrack) return;
    setWorking(true); setError(""); setNotice("");
    try {
      let payload: Record<string, unknown> = { mode, track: effectiveTrack, revision: data.revision };
      if (mode === "catalog") payload = { ...payload, competencies: parseCatalogDraft(catalogDraft) };
      else payload = { ...payload, year: data.year, class_id: classId,
        period_id: periodId, student_id: studentId, record };
      await getJson("/api/preschool/booklets", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setNotice(mode === "catalog" ? "Catalogue enregistré." : "Observations enregistrées.");
      await load(year, classId, periodId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Enregistrement impossible");
    } finally { setWorking(false); }
  };

  return <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
    <header className="print:hidden">
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-700">Préscolaire · Mon Cahier</p>
      <h1 className="mt-1 text-2xl font-bold text-slate-900">Livret d’observation des compétences</h1>
      <p className="mt-2 text-sm text-slate-600">Aucune note chiffrée, aucun coefficient, aucune moyenne et aucun rang.
        Les compétences sont déterminées par le catalogue validé par l’établissement.</p>
      <Link className="mt-2 inline-block text-sm font-semibold text-emerald-700 underline" href="/admin/bulletins">
        Retour aux bulletins (administration)
      </Link>
    </header>
    {error && <p role="alert" className="rounded-xl bg-rose-50 p-4 text-sm text-rose-800 print:hidden">{error}</p>}
    {notice && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900 print:hidden">{notice}</p>}
    <section className="grid gap-3 rounded-xl border bg-white p-4 print:hidden sm:grid-cols-2 lg:grid-cols-4">
      <label className="text-sm">Année scolaire
        <input className="mt-1 w-full rounded border p-2" value={year} placeholder="2026-2027"
          onChange={e => { setYear(e.target.value); setClassId(""); }} />
      </label>
      <label className="text-sm">Classe maternelle
        <select className="mt-1 w-full rounded border p-2" value={classId}
          onChange={e => { setClassId(e.target.value); setPeriodId(""); setStudentId(""); }}>
          <option value="">Sélectionner</option>
          {classes.map(item => <option key={item.id} value={item.id}>{item.label} · {item.level}</option>)}
        </select>
      </label>
      <label className="text-sm">Période
        <select className="mt-1 w-full rounded border p-2" value={periodId}
          onChange={e => setPeriodId(e.target.value)} disabled={!data}>
          <option value="">Sélectionner</option>
          {data?.periods.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>
      <label className="text-sm">Élève
        <select className="mt-1 w-full rounded border p-2" value={studentId}
          onChange={e => setStudentId(e.target.value)} disabled={!data}>
          <option value="">Sélectionner</option>
          {data?.students.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
    </section>
    {loading && <p className="text-sm text-slate-600 print:hidden">Chargement de la classe et des observations…</p>}
    {data && student && <div className="grid items-start gap-5 lg:grid-cols-2 print:block">
      <section className="space-y-3 rounded-xl border bg-white p-4 print:hidden">
        <label className="block text-sm font-semibold">Enseignement
          <select className="mt-1 w-full rounded border p-2" value={effectiveTrack}
            onChange={e => setTrack(e.target.value as TeachingTrack)}>
            {enabledTracks.map(item => <option key={item} value={item}>{TRACKS[item]}</option>)}
          </select>
        </label>
        {data.admin && <details className="rounded-lg border p-3">
          <summary className="cursor-pointer font-semibold">Configurer les compétences de {TRACKS[effectiveTrack]}</summary>
          <p className="my-2 text-xs text-slate-600">
            Une ligne par compétence : code | domaine | compétence.
            Exemple de syntaxe (à remplacer par le référentiel validé) :
            <code> langage_01 | Langage | Comprendre une consigne simple </code>
          </p>
          <textarea aria-label="Catalogue de compétences" rows={8} value={catalogDraft}
            onChange={e => setCatalogDraft(e.target.value)}
            className="w-full rounded border p-2 font-mono text-xs" />
          <button type="button" disabled={working} onClick={() => void save("catalog")}
            className="mt-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
            Enregistrer le catalogue</button>
          <p className="mt-1 text-xs text-amber-700">Les anciennes compétences ne peuvent pas être supprimées silencieusement.</p>
        </details>}
        {!catalog.length && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          Aucun référentiel de compétences validé pour cet enseignement.
          Un administrateur doit enregistrer le catalogue avant la saisie.
        </p>}
        {catalog.map(item => <fieldset key={item.id} className="rounded-lg border p-3">
          <legend className="px-1 text-sm font-semibold">{item.domain} · {item.label}</legend>
          <label className="block text-xs">Progression
            <select value={record.observations[item.id]?.attainment || "not_observed"}
              onChange={e => changeMark(item.id, { attainment: e.target.value as PreschoolAttainment })}
              disabled={!data.editable} className="mt-1 w-full rounded border p-2 text-sm">
              {order.map(level => <option key={level} value={level}>{LEVELS[level]}</option>)}
            </select>
          </label>
          <label className="mt-2 block text-xs">Observation
            <textarea className="mt-1 w-full rounded border p-2 text-sm" rows={2}
              maxLength={500} disabled={!data.editable}
              value={record.observations[item.id]?.observation || ""}
              onChange={e => changeMark(item.id, { observation: e.target.value })} />
          </label>
        </fieldset>)}
        <label className="block text-sm font-medium">Appréciation de l’enseignant
          <textarea rows={3} maxLength={1000} disabled={!data.editable}
            className="mt-1 w-full rounded border p-2 text-sm" value={record.teacherComment}
            onChange={e => setRecord(previous => ({ ...previous, teacherComment: e.target.value }))} />
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!data.editable || !catalog.length || working || !periodId}
            onClick={() => void save("record")}
            className="rounded-lg bg-emerald-700 px-5 py-2.5 font-semibold text-white disabled:opacity-40">
            {working ? "Enregistrement…" : "Enregistrer les observations"}
          </button>
          <span className="self-center text-xs text-slate-600">
            {slot?.ready ? "Livret complet" : "Livret en préparation"}
          </span>
        </div>
      </section>
      <section className="space-y-3">
        <div className="flex items-end gap-3 print:hidden">
          <label className="flex-1 text-sm">Modèle de livret
            <select className="mt-1 w-full rounded border p-2" value={previewVariant}
              onChange={e => setVariant(e.target.value as typeof variant)}>
              {availableVariants.map(option => <option key={option} value={option}>
                {option === "combined" ? "Français et arabe — séparés sur le même livret" : TRACKS[option as TeachingTrack]}
              </option>)}
            </select>
          </label>
          <button type="button" disabled={!printable}
            className="rounded-lg bg-slate-900 px-4 py-2.5 font-semibold text-white disabled:opacity-40"
            onClick={() => window.print()}>Imprimer le livret</button>
        </div>
        {!printable && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 print:hidden">
          Impression officielle indisponible tant que chaque compétence du/des enseignements affichés
          n'a pas été observée et enregistrée.
        </p>}
        <article id="preschool-booklet-print" className="space-y-5 rounded-xl border bg-white p-5 text-slate-900 shadow print:shadow-none">
          <div className="border-b-2 border-emerald-700 pb-4 text-center">
            <p className="text-xs font-semibold">RÉPUBLIQUE DE CÔTE D’IVOIRE · UNION – DISCIPLINE – TRAVAIL</p>
            <h2 className="mt-3 text-xl font-bold">{data.schoolName || "Établissement scolaire"}</h2>
            {data.schoolCode && <p className="text-xs">Code : {data.schoolCode}</p>}
            <h3 className="mt-3 text-lg font-bold">LIVRET D’OBSERVATION DES COMPÉTENCES</h3>
            <p className="text-sm">Préscolaire · {data.year} · {data.periods.find(item => item.id === periodId)?.label}</p>
          </div>
          <p className="text-sm"><strong>Élève :</strong> {student.name}
            {student.matricule && <> · Matricule : {student.matricule}</>}
            <span className="block"><strong>Classe :</strong> {data.schoolClass.label}</span>
          </p>
          {preview.map(block => <section key={block.track}>
            <h4 className="mb-2 rounded bg-emerald-700 p-2 font-bold text-white print:bg-transparent print:text-slate-900">
              {TRACKS[block.track]}</h4>
            <table className="w-full border-collapse text-xs">
              <thead><tr className="bg-slate-50">
                <th className="border p-2 text-left">Domaine</th>
                <th className="border p-2 text-left">Compétence</th>
                <th className="border p-2">Progression</th>
                <th className="border p-2">Observation</th>
              </tr></thead>
              <tbody>{block.catalog.map(item => <tr key={item.id}>
                <td className="border p-2">{item.domain}</td>
                <td className="border p-2">{item.label}</td>
                <td className="border p-2">
                  {LEVELS[block.record?.observations[item.id]?.attainment || "not_observed"]}</td>
                <td className="border p-2">{block.record?.observations[item.id]?.observation || "—"}</td>
              </tr>)}</tbody>
            </table>
            {block.record?.teacherComment && <p className="mt-2 text-xs">
              <strong>Appréciation :</strong> {block.record.teacherComment}</p>}
            <p className="mt-5 text-right text-xs">
              Directeur de l’enseignement {block.track === "french" ? "français" : "arabe"} :
              {" "}{data.signatories?.[block.track]?.name || "Signature à renseigner"}
            </p>
          </section>)}
          <p className="border-t pt-3 text-xs">Visa de l’enseignant · Visa du directeur général</p>
          {!printable && <p className="rounded bg-amber-100 p-3 text-center text-xs font-bold text-amber-900">
            BROUILLON — LIVRET INCOMPLET / NON VALIDÉ
          </p>}
        </article>
      </section>
    </div>}
    {data && !data.students.length && <p className="text-sm text-amber-800">
      Aucun élève inscrit dans cette classe ou aucun enseignement préscolaire autorisé.
    </p>}
  </main>;
}
