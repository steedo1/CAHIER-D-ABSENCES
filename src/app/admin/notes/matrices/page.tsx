// src/app/admin/notes/matrices/page.tsx
"use client";
import SpecializedCorrespondentReports from "@/components/admin/SpecializedCorrespondentReports";
import { useBilingualCorrespondentMode } from "@/hooks/useBilingualCorrespondentMode";


import React, { useEffect, useMemo, useState } from "react";
import EducationScopeFilter from "@/components/admin/EducationScopeFilter";
import {
  DEFAULT_EDUCATION_SCOPE,
  type EducationScopedClass,
  type EducationScopeValue,
} from "@/lib/education-scope";
import {
  Download,
  FileSpreadsheet,
  Loader2,
  Printer,
  RefreshCw,
  Search,
} from "lucide-react";

type ClassRow = EducationScopedClass & {
  id: string;
  name?: string;
  label?: string | null;
  level?: string | null;
  academic_year?: string | null;
};

type PeriodRow = {
  id: string;
  academic_year: string | null;
  code: string | null;
  label: string | null;
  short_label: string | null;
  start_date: string | null;
  end_date: string | null;
  order_index?: number | null;
  is_active?: boolean | null;
};

type InstitutionSettings = {
  institution_name?: string | null;
  institution_logo_url?: string | null;
  institution_phone?: string | null;
  institution_email?: string | null;
  institution_postal_address?: string | null;
  institution_status?: string | null;
  institution_code?: string | null;
  settings_json?: any;
};

type BulletinSubject = {
  subject_id: string;
  subject_name?: string | null;
  coeff_bulletin?: number | null;
  include_in_average?: boolean | null;
};

type BulletinPerSubject = {
  subject_id: string;
  avg20: number | null;
  has_grade?: boolean | null;
  is_nc?: boolean | null;
};

type BulletinSubjectComponent = {
  id: string;
  subject_id: string;
  label: string;
  short_label?: string | null;
  order_index?: number | null;
};

type BulletinPerSubjectComponent = {
  subject_id: string;
  component_id: string;
  avg20: number | null;
};

type BulletinItem = {
  student_id: string;
  full_name: string;
  matricule: string | null;
  general_avg: number | null;
  rank?: number | null;
  coverage?: { has_academic_grade?: boolean | null; status?: string | null } | null;
  general_avg_status?: string | null;
  admin_forced_nc?: boolean | null;
  per_subject?: BulletinPerSubject[];
  per_subject_components?: BulletinPerSubjectComponent[];
  conduct_avg?: number | null;
};

type BulletinResponse = {
  ok?: boolean;
  class?: { id: string; label?: string | null; academic_year?: string | null; level?: string | null };
  period?: { from?: string | null; to?: string | null; label?: string | null; short_label?: string | null; code?: string | null };
  subjects?: BulletinSubject[];
  subject_components?: BulletinSubjectComponent[];
  items?: BulletinItem[];
};

type MatrixRow = {
  student_id: string;
  full_name: string;
  matricule: string | null;
  averages: Record<string, number | null>;
  general_avg: number | null;
  rank: number | null;
};

const CONDUCT_COLUMN_KEY = "__matrice_conduite__";
const componentColumnKey = (id: string) => `__matrice_component__:${id}`;
const isConductSubject = (label: string | null | undefined) =>
  /\b(conduite|conduct)\b/i.test(String(label || ""));

const BRAND_SITE = "www.mon-cahier.com";
const BRAND_SLOGAN = "La plateforme idéale pour une école connectée, l’école du futur.";

function clsLabel(cls: ClassRow | null | undefined) {
  return cls?.label || cls?.name || "Classe";
}

function periodLabel(period: PeriodRow | null | undefined) {
  return period?.short_label || period?.label || period?.code || "Période";
}

function formatAvg(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  return Number(value).toFixed(2);
}

function formatDateFr(value?: string | null) {
  if (!value) return "—";
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("fr-FR");
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function cleanNumber(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(2));
}

function normalizeInstitutionSettings(json: any): InstitutionSettings {
  const raw = json?.institution || json?.settings || json?.item || json || {};
  const settingsJson = raw?.settings_json || {};
  return {
    ...settingsJson,
    ...raw,
    institution_name: raw?.institution_name || raw?.name || settingsJson?.institution_name || settingsJson?.name || null,
    institution_logo_url: raw?.institution_logo_url || raw?.logo_url || settingsJson?.institution_logo_url || settingsJson?.logo_url || null,
    institution_phone: raw?.institution_phone || raw?.phone || settingsJson?.institution_phone || settingsJson?.phone || null,
    institution_email: raw?.institution_email || raw?.email || settingsJson?.institution_email || settingsJson?.email || null,
    institution_postal_address: raw?.institution_postal_address || raw?.postal_address || raw?.address || settingsJson?.institution_postal_address || null,
    institution_status: raw?.institution_status || raw?.status || settingsJson?.institution_status || null,
    institution_code: raw?.institution_code || raw?.code || settingsJson?.institution_code || null,
  };
}

function isBlockingStatus(value: unknown) {
  const status = String(value ?? "").toLowerCase().trim();
  return status === "empty" || status === "admin_nc" || status === "not_last_period";
}

function periodAverage(item: BulletinItem) {
  if (item.admin_forced_nc === true) return null;
  if (item.coverage?.has_academic_grade === false) return null;
  if (isBlockingStatus(item.general_avg_status || item.coverage?.status)) return null;
  return cleanNumber(item.general_avg);
}

function Button(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "emerald" | "slate" | "amber" },
) {
  const { tone = "emerald", className = "", ...rest } = props;
  const toneClass = {
    emerald: "bg-emerald-600 text-white hover:bg-emerald-700 focus:ring-emerald-500/25",
    slate: "bg-slate-900 text-white hover:bg-slate-800 focus:ring-slate-500/25",
    amber: "bg-amber-500 text-slate-950 hover:bg-amber-600 focus:ring-amber-500/25",
  }[tone];

  return (
    <button
      {...rest}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-bold shadow-sm transition",
        "focus:outline-none focus:ring-4 disabled:cursor-not-allowed disabled:opacity-50",
        toneClass,
        className,
      ].join(" ")}
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = "", ...rest } = props;
  return (
    <select
      {...rest}
      className={[
        "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm outline-none transition",
        "focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/20 disabled:bg-slate-50 disabled:text-slate-400",
        className,
      ].join(" ")}
    />
  );
}

function printHtmlDocument(html: string, onError: (message: string) => void) {
  if (typeof document === "undefined") return;

  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", "Impression de la matrice");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "1px";
  iframe.style.height = "1px";
  iframe.style.border = "0";
  iframe.style.opacity = "0";
  iframe.style.pointerEvents = "none";

  document.body.appendChild(iframe);

  const frameWindow = iframe.contentWindow;
  const frameDocument = frameWindow?.document;
  if (!frameWindow || !frameDocument) {
    iframe.remove();
    onError("Impossible de préparer l’impression. Réessayez après actualisation de la page.");
    return;
  }

  let printed = false;
  const cleanup = () => window.setTimeout(() => iframe.remove(), 500);
  const launchPrint = () => {
    if (printed) return;
    printed = true;
    try {
      frameWindow.onafterprint = cleanup;
      frameWindow.focus();
      frameWindow.print();
      window.setTimeout(() => {
        if (iframe.parentNode) iframe.remove();
      }, 60000);
    } catch {
      iframe.remove();
      onError("La fenêtre d’impression n’a pas pu être ouverte. Réessayez avec un autre navigateur si le problème persiste.");
    }
  };

  iframe.onload = () => window.setTimeout(launchPrint, 450);
  frameDocument.open();
  frameDocument.write(html);
  frameDocument.close();
  window.setTimeout(launchPrint, 1400);
}

export default function MatricesTrimestriellesPage() {
  const { isBilingual, loading, error } = useBilingualCorrespondentMode();
  if (loading) return <p className="rounded-xl border p-5" role="status">Vérification du type d’établissement…</p>;
  if (error) return <p className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-800" role="alert">
    Le type de l’établissement n’a pas pu être vérifié : {error}
  </p>;
  if (isBilingual) {
    return <SpecializedCorrespondentReports mode="term" />;
  }
  return <LegacyMatricesTrimestriellesPage />;
}

function LegacyMatricesTrimestriellesPage() {
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [periods, setPeriods] = useState<PeriodRow[]>([]);
  const [institution, setInstitution] = useState<InstitutionSettings | null>(null);
  const [selectedAcademicYear, setSelectedAcademicYear] = useState("");
  const [educationScope, setEducationScope] =
    useState<EducationScopeValue>(DEFAULT_EDUCATION_SCOPE);
  const selectedClassId = educationScope.classId;
  const [selectedPeriodId, setSelectedPeriodId] = useState("");
  const [subjects, setSubjects] = useState<BulletinSubject[]>([]);
  const [rows, setRows] = useState<MatrixRow[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const selectedClass = useMemo(
    () => classes.find((c) => c.id === selectedClassId) || null,
    [classes, selectedClassId],
  );

  const selectedPeriod = useMemo(
    () => periods.find((p) => p.id === selectedPeriodId) || null,
    [periods, selectedPeriodId],
  );

  const academicYears = useMemo(() => {
    const set = new Set<string>();
    classes.forEach((c) => c.academic_year && set.add(c.academic_year));
    periods.forEach((p) => p.academic_year && set.add(p.academic_year));
    return Array.from(set).sort().reverse();
  }, [classes, periods]);

  const filteredClasses = useMemo(() => {
    if (!selectedAcademicYear) return classes;
    return classes.filter((c) => c.academic_year === selectedAcademicYear);
  }, [classes, selectedAcademicYear]);

  const filteredPeriods = useMemo(() => {
    return periods
      .filter((p) => p.is_active !== false)
      .filter((p) => !selectedAcademicYear || p.academic_year === selectedAcademicYear)
      .filter((p) => p.start_date && p.end_date)
      .sort((a, b) => Number(a.order_index ?? 999) - Number(b.order_index ?? 999));
  }, [periods, selectedAcademicYear]);

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => `${row.full_name} ${row.matricule || ""}`.toLowerCase().includes(q));
  }, [rows, search]);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      setErrorMsg(null);
      try {
        const [classRes, instRes] = await Promise.all([
          fetch("/api/admin/classes?academic_year=all&education_type=all&limit=5000", { cache: "no-store" }),
          fetch("/api/admin/institution/settings", { cache: "no-store" }),
        ]);

        const classJson = await classRes.json().catch(() => ({}));
        const items: ClassRow[] = Array.isArray(classJson) ? classJson : Array.isArray(classJson?.items) ? classJson.items : [];
        if (!cancelled) {
          const years = Array.from(new Set(items.map((c) => c.academic_year).filter(Boolean) as string[]))
            .sort()
            .reverse();
          const initialYear = years[0] || items[0]?.academic_year || "";
          setClasses(items);
          setSelectedAcademicYear(initialYear);
        }

        if (instRes.ok) {
          const instJson = await instRes.json().catch(() => ({}));
          if (!cancelled) setInstitution(normalizeInstitutionSettings(instJson));
        }
      } catch (e: any) {
        if (!cancelled) setErrorMsg(e?.message || "Impossible de charger les paramètres.");
      }
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadPeriods() {
      if (!selectedAcademicYear) return;
      try {
        const params = new URLSearchParams({ academic_year: selectedAcademicYear });
        if (selectedClassId) params.set("class_id", selectedClassId);
        const res = await fetch(`/api/admin/institution/grading-periods?${params.toString()}`, { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        const items: PeriodRow[] = Array.isArray(json) ? json : Array.isArray(json?.items) ? json.items : [];
        if (cancelled) return;
        setPeriods(items);
        const first = items.find((p) => p.is_active !== false && p.start_date && p.end_date);
        setSelectedPeriodId((current) => (current && items.some((p) => p.id === current) ? current : first?.id || ""));
      } catch (e: any) {
        if (!cancelled) setErrorMsg(e?.message || "Impossible de charger les périodes.");
      }
    }

    void loadPeriods();
    return () => {
      cancelled = true;
    };
  }, [selectedAcademicYear, selectedClassId]);

  function changeAcademicYear(value: string) {
    setSelectedAcademicYear(value);
    setEducationScope((current) => ({
      ...current,
      levelCode: "",
      classId: "",
    }));
    setRows([]);
    setSubjects([]);
  }

  function changeEducationScope(value: EducationScopeValue) {
    setEducationScope(value);
    setRows([]);
    setSubjects([]);
  }

  async function loadMatrix() {
    setErrorMsg(null);
    setRows([]);
    setSubjects([]);

    if (!selectedClassId || !selectedPeriod?.start_date || !selectedPeriod?.end_date) {
      setErrorMsg("Veuillez choisir une classe et un trimestre valide.");
      return;
    }

    setLoading(true);
    try {
      const params = new URLSearchParams({
        class_id: selectedClassId,
        from: selectedPeriod.start_date,
        to: selectedPeriod.end_date,
        published: "true",
        export_light: "1", // Matrice uniquement : aucune génération QR/PNG côté API.
      });

      const res = await fetch(`/api/admin/grades/bulletin?${params.toString()}`, { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as BulletinResponse | null;
      if (!res.ok || !json?.ok) throw new Error((json as any)?.error || `Erreur ${res.status}`);

      const subjectList = (json.subjects || []).filter((s) => s.subject_id);
      const componentsBySubject = new Map<string, BulletinSubjectComponent[]>();
      for (const component of json.subject_components || []) {
        if (!component.id || !subjectList.some((subject) => subject.subject_id === component.subject_id)) continue;
        const list = componentsBySubject.get(component.subject_id) || [];
        list.push(component);
        componentsBySubject.set(component.subject_id, list);
      }
      for (const list of componentsBySubject.values()) {
        list.sort((a, b) => Number(a.order_index ?? 0) - Number(b.order_index ?? 0));
      }

      // Conserver la colonne Français et insérer immédiatement après ses sous-matières.
      // Les clés préfixées sont purement visuelles et ne créent aucune matière en base.
      const matrixColumns: BulletinSubject[] = subjectList.flatMap((subject) => [
        subject,
        ...(componentsBySubject.get(subject.subject_id) || []).map((component) => ({
          subject_id: componentColumnKey(component.id),
          subject_name: `↳ ${component.label || component.short_label || "Sous-matière"}`,
          include_in_average: false,
        })),
      ]);
      const existingConductSubject = subjectList.find((subject) => isConductSubject(subject.subject_name));
      const classLevel = String(selectedClass?.level || json.class?.level || "");
      const isSecondary = /6[eè]|5[eè]|4[eè]|3[eè]|6eme|5eme|4eme|3eme|seconde|2nde|premi[eè]re|1[eè]re|terminale|tle/i.test(classLevel);
      const showSeparateConduct = !existingConductSubject &&
        (isSecondary || (json.items || []).some((item) => item.conduct_avg !== null && item.conduct_avg !== undefined));
      if (showSeparateConduct) {
        matrixColumns.push({ subject_id: CONDUCT_COLUMN_KEY, subject_name: "Conduite", coeff_bulletin: 1 });
      }

      const nextRows = (json.items || [])
        .map((item) => {
          const averages: Record<string, number | null> = {};
          for (const column of matrixColumns) averages[column.subject_id] = null;

          for (const cell of item.per_subject || []) {
            if (!cell.subject_id) continue;
            averages[cell.subject_id] = cell.is_nc === true || cell.has_grade === false || cell.avg20 == null
              ? null : cleanNumber(cell.avg20);
          }
          for (const cell of item.per_subject_components || []) {
            if (!cell.component_id) continue;
            const key = componentColumnKey(cell.component_id);
            if (!(key in averages)) continue;
            averages[key] = cell.avg20 == null ? null : cleanNumber(cell.avg20);
          }
          if (item.conduct_avg !== null && item.conduct_avg !== undefined) {
            const conductColumn = existingConductSubject?.subject_id || (showSeparateConduct ? CONDUCT_COLUMN_KEY : null);
            if (conductColumn) averages[conductColumn] = cleanNumber(item.conduct_avg);
          }

          return {
            student_id: item.student_id,
            full_name: item.full_name || "Élève",
            matricule: item.matricule ?? null,
            averages,
            general_avg: periodAverage(item),
            rank: item.rank ?? null,
          };
        })
        .sort((a, b) => {
          // Les élèves sont ordonnés alphabétiquement ; le rang reste informatif.
          const name = a.full_name.localeCompare(b.full_name, "fr", { numeric: true, sensitivity: "base" });
          return name || String(a.matricule || "").localeCompare(String(b.matricule || ""), "fr") ||
            a.student_id.localeCompare(b.student_id);
        });

      setSubjects(matrixColumns);
      setRows(nextRows);
    } catch (e: any) {
      setErrorMsg(e?.message || "Impossible de charger la matrice.");
    } finally {
      setLoading(false);
    }
  }

  function exportCsv() {
    if (!rows.length) {
      setErrorMsg("Chargez d’abord la matrice avant l’export CSV.");
      return;
    }

    const headers = ["N°", "Matricule", "Nom et prénoms", ...subjects.map((s) => s.subject_name || "Matière"), "Moyenne générale", "Rang"];
    const lines = [headers.map(csvCell).join(";")];

    rows.forEach((row, idx) => {
      const line = [
        idx + 1,
        row.matricule || "",
        row.full_name,
        ...subjects.map((s) => (row.averages[s.subject_id] === null ? "" : formatAvg(row.averages[s.subject_id]))),
        row.general_avg === null ? "" : formatAvg(row.general_avg),
        row.rank ?? "",
      ];
      lines.push(line.map(csvCell).join(";"));
    });

    const blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeClass = clsLabel(selectedClass).replace(/[^a-z0-9_-]+/gi, "_");
    const safePeriod = periodLabel(selectedPeriod).replace(/[^a-z0-9_-]+/gi, "_");
    a.href = url;
    a.download = `matrice_trimestrielle_${safeClass}_${safePeriod}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function printMatrix() {
    if (!rows.length) {
      setErrorMsg("Chargez d’abord la matrice avant l’impression PDF.");
      return;
    }

    const instName = institution?.institution_name || "ÉTABLISSEMENT";
    const logoUrl = institution?.institution_logo_url || "";
    const logoHtml = logoUrl ? `<img src="${escapeHtml(logoUrl)}" />` : `<span>Logo</span>`;
    const meta = [
      institution?.institution_postal_address,
      institution?.institution_phone ? `Tél : ${institution.institution_phone}` : "",
      institution?.institution_email,
      institution?.institution_code ? `Code : ${institution.institution_code}` : "",
    ]
      .map((x) => String(x || "").trim())
      .filter(Boolean)
      .map(escapeHtml)
      .join(" • ");

    const subjectHeaders = subjects.map((s) => {
      const isComponent = s.subject_id.startsWith("__matrice_component__:");
      return `<th class="${isComponent ? "component" : ""}">${escapeHtml(s.subject_name || "Matière")}</th>`;
    }).join("");
    const bodyRows = rows
      .map(
        (row, idx) => `<tr>
          <td class="num">${idx + 1}</td>
          <td>${escapeHtml(row.matricule || "")}</td>
          <td class="student">${escapeHtml(row.full_name)}</td>
          ${subjects.map((s) => `<td class="num">${escapeHtml(formatAvg(row.averages[s.subject_id]))}</td>`).join("")}
          <td class="num strong">${escapeHtml(formatAvg(row.general_avg))}</td>
          <td class="num strong">${escapeHtml(row.rank ?? "NC")}</td>
        </tr>`,
      )
      .join("");

    const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8" />
<title>Matrice trimestrielle - ${escapeHtml(clsLabel(selectedClass))}</title>
<style>
@page { size: ${subjects.length > 13 ? "A3" : "A4"} landscape; margin: 6mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; color: #0f172a; background: #f8fafc; font-family: Inter, Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { padding: 8px; }
.sheet { background: #fff; border: 1px solid #dbe3ee; border-radius: 8px; padding: 8px; position: static; width: 100%; }
.header { display: grid; grid-template-columns: 58px 1fr 190px; gap: 7px; align-items: center; border: 1px solid #cbd5e1; border-radius: 8px; padding: 6px; background: linear-gradient(135deg, rgba(16,185,129,.10), rgba(15,23,42,.02)), white; break-inside: avoid; }
.logo { width: 52px; height: 52px; border: 1px solid #cbd5e1; border-radius: 6px; display: flex; align-items: center; justify-content: center; overflow: hidden; color: #94a3b8; font-size: 9px; font-weight: 900; }
.logo img { width: 100%; height: 100%; object-fit: contain; padding: 5px; }
h1 { margin: 0; font-size: 13px; text-transform: uppercase; }
.meta { margin-top: 3px; color: #475569; font-size: 8px; line-height: 1.2; }
.side { border-left: 1px solid #cbd5e1; padding-left: 7px; font-size: 8.5px; color: #334155; }
.side strong { color: #0f172a; }
.title { margin: 6px 0; padding: 5px 7px; border-radius: 4px; background: #0f172a; color: white; font-weight: 900; text-transform: uppercase; letter-spacing: .035em; font-size: 10px; break-after: avoid; }
.table-wrap { overflow: visible; }
table { width: 100%; border-collapse: collapse; font-size: 8px; }
thead { display: table-header-group; }
tr { break-inside: avoid; page-break-inside: avoid; }
th { background: #e2e8f0; color: #0f172a; font-size: 7px; text-transform: uppercase; line-height: 1.12; }
th.component { background: #d9f3e8; }
th, td { border: 1px solid #cbd5e1; padding: 2px 3px; vertical-align: middle; line-height: 1.14; }
tr:nth-child(even) td { background: #f8fafc; }
.num { text-align: right; white-space: nowrap; }
.student { min-width: 165px; font-weight: 800; white-space: nowrap; font-size: 7.7px; }
.strong { font-weight: 950; color: #064e3b; }
.footer { position: static; margin-top: 7px; border-top: 1px solid #cbd5e1; padding-top: 4px; text-align: center; font-size: 8px; color: #475569; break-inside: avoid; }
.footer strong { color: #047857; }
@media print {
  html, body { margin: 0 !important; padding: 0 !important; background: white !important; }
  .sheet { border: 0; border-radius: 0; padding: 0; margin: 0; min-height: 0; }
  .header { padding: 5px; }
  .title { margin: 4px 0; }
  th, td { padding: 1.5px 2px; }
  .student { min-width: 135px; }
  .footer { margin-top: 5px; }
}
</style></head><body>
<div class="sheet">
  <div class="header"><div class="logo">${logoHtml}</div><div><h1>${escapeHtml(instName)}</h1><div class="meta">${meta || "Document généré par Mon Cahier"}</div></div><div class="side"><div><strong>Classe :</strong> ${escapeHtml(clsLabel(selectedClass))}</div><div><strong>Trimestre :</strong> ${escapeHtml(periodLabel(selectedPeriod))}</div><div><strong>Dates :</strong> ${escapeHtml(formatDateFr(selectedPeriod?.start_date))} - ${escapeHtml(formatDateFr(selectedPeriod?.end_date))}</div></div></div>
  <div class="title">Matrice des moyennes par matière — liste alphabétique</div>
  <div class="table-wrap"><table><thead><tr><th>N°</th><th>Matricule</th><th>Nom et prénoms</th>${subjectHeaders}<th>Moy. générale</th><th>Rang</th></tr></thead><tbody>${bodyRows}</tbody></table></div>
  <div class="footer"><strong>${BRAND_SITE}</strong> - ${escapeHtml(BRAND_SLOGAN)}</div>
</div>
</body></html>`;

    setErrorMsg(null);
    printHtmlDocument(html, setErrorMsg);
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-5 text-slate-900 md:px-6">
      <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm md:p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-start gap-4">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
              <FileSpreadsheet className="h-6 w-6" />
            </div>
            <div>
              <div className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Correspondant fichier</div>
              <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950 md:text-3xl">Matrices trimestrielles</h1>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
                Matrice officielle par classe : élèves en lignes, matières en colonnes, moyennes publiées du trimestre sélectionné.
              </p>
            </div>
          </div>

          <div className="grid w-full gap-3 rounded-3xl border border-slate-200 bg-slate-50 p-3 md:grid-cols-[130px_minmax(180px,1fr)_auto] xl:max-w-2xl">
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Année</label>
              <Select value={selectedAcademicYear} onChange={(e) => changeAcademicYear(e.target.value)}>
                {academicYears.length ? academicYears.map((y) => <option key={y} value={y}>{y}</option>) : <option value="">Année</option>}
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Trimestre</label>
              <Select value={selectedPeriodId} onChange={(e) => setSelectedPeriodId(e.target.value)}>
                {filteredPeriods.length ? filteredPeriods.map((p) => <option key={p.id} value={p.id}>{periodLabel(p)}</option>) : <option value="">Aucune période</option>}
              </Select>
            </div>
            <div className="flex items-end gap-2">
              <Button onClick={loadMatrix} disabled={loading} className="min-w-[112px]">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Charger
              </Button>
            </div>
          </div>
        </div>

        <EducationScopeFilter
          value={educationScope}
          onChange={changeEducationScope}
          classes={filteredClasses}
          title="Contexte de la matrice trimestrielle"
          className="mt-4"
        />
      </section>

      {errorMsg && (
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {errorMsg}
        </div>
      )}

      <section className="mt-5 rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-black text-slate-950">{clsLabel(selectedClass)} — {periodLabel(selectedPeriod)}</h2>
            <p className="text-sm text-slate-500">{rows.length} élève(s) • {subjects.length} colonne(s) • ordre alphabétique (rang conservé)</p>
          </div>
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher un élève..."
                className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/20 md:w-64"
              />
            </div>
            <Button tone="slate" onClick={exportCsv} disabled={!rows.length}>
              <Download className="h-4 w-4" /> CSV
            </Button>
            <Button tone="amber" onClick={printMatrix} disabled={!rows.length}>
              <Printer className="h-4 w-4" /> Imprimer / PDF
            </Button>
          </div>
        </div>

        <div className="mt-5 overflow-x-auto rounded-2xl border border-slate-200">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2">N°</th>
                <th className="px-3 py-2">Matricule</th>
                <th className="sticky left-12 z-10 min-w-[220px] bg-slate-50 px-3 py-2">Nom et prénoms</th>
                {subjects.map((s) => <th key={s.subject_id} className="px-3 py-2 text-right">{s.subject_name || "Matière"}</th>)}
                <th className="px-3 py-2 text-right">Moy. générale</th>
                <th className="px-3 py-2 text-right">Rang</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleRows.length ? visibleRows.map((row, idx) => (
                <tr key={row.student_id} className="hover:bg-emerald-50/40">
                  <td className="sticky left-0 bg-white px-3 py-2 font-black text-slate-900">{idx + 1}</td>
                  <td className="px-3 py-2 text-slate-600">{row.matricule || "—"}</td>
                  <td className="sticky left-12 min-w-[220px] bg-white px-3 py-2 font-bold text-slate-900">{row.full_name}</td>
                  {subjects.map((s) => <td key={`${row.student_id}-${s.subject_id}`} className="px-3 py-2 text-right font-semibold text-slate-700">{formatAvg(row.averages[s.subject_id])}</td>)}
                  <td className="px-3 py-2 text-right font-black text-emerald-700">{formatAvg(row.general_avg)}</td>
                  <td className="px-3 py-2 text-right font-black text-slate-900">{row.rank ?? "NC"}</td>
                </tr>
              )) : (
                <tr><td colSpan={subjects.length + 5} className="px-3 py-8 text-center text-sm text-slate-500">Chargez une classe et un trimestre pour afficher la matrice.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
