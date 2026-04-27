"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Calendar, Filter, RefreshCw, Download, FileText } from "lucide-react";

/* ───────── UI helpers ───────── */
function Input(p: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...p}
      className={[
        "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm",
        "shadow-sm outline-none transition",
        "focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/20",
        "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400",
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
        "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm",
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
        "inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow",
        p.disabled
          ? "cursor-not-allowed opacity-60"
          : "transition hover:bg-emerald-700",
        p.className ?? "",
      ].join(" ")}
    />
  );
}

function GhostButton(p: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...p}
      className={[
        "inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium",
        p.disabled
          ? "cursor-not-allowed opacity-60"
          : "transition hover:bg-slate-50",
        p.className ?? "",
      ].join(" ")}
    />
  );
}

function Card({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-base font-semibold text-slate-800">{title}</div>
          {subtitle ? (
            <div className="mt-0.5 text-xs text-slate-500">{subtitle}</div>
          ) : null}
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}

/* ───────── Types ───────── */
type ClassItem = {
  id: string;
  name: string;
  level: string;
  academic_year?: string | null;
};

type MatrixSubject = { id: string; name: string };
type MatrixStudent = { id: string; full_name: string; rank?: number };
type MatrixValue = { student_id: string; subject_id: string; minutes: number };

type MatrixPayload = {
  subjects: MatrixSubject[];
  students: MatrixStudent[];
  values: MatrixValue[];
  subjectDistinct: Record<string, number>;
};

/** Périodes de notes (trimestres / séquences) */
type GradePeriod = {
  id: string;
  academic_year: string | null;
  code: string | null;
  label: string | null;
  short_label: string | null;
  start_date: string;
  end_date: string;
  coeff: number | null;
};

type InstitutionSettings = {
  institution_name?: string | null;
  institution_logo_url?: string | null;
  institution_phone?: string | null;
  institution_email?: string | null;
  institution_region?: string | null;
  institution_postal_address?: string | null;
  institution_status?: string | null;
  institution_head_name?: string | null;
  institution_head_title?: string | null;
  country_name?: string | null;
  country_motto?: string | null;
  ministry_name?: string | null;
  institution_code?: string | null;
  settings_json?: any;
};

type TopStudent = MatrixStudent & { total: number };
type TopSubject = MatrixSubject & { total: number };

type PdfPrintOptions = {
  title: string;
  subtitle: string;
  tableHtml: string;
  summaryHtml?: string;
  institution?: InstitutionSettings | null;
};

/* ───────── Helpers ───────── */
const nf = new Intl.NumberFormat("fr-FR");

const BRAND_COMPANY = "Nexa Digital SARL";
const BRAND_SITE = "www.mon-cahier.com";

const toYMD = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;

const hoursLabel = (minutes: number) => {
  const h = (minutes || 0) / 60;
  const s = h.toFixed(1).replace(".", ",");
  return s.replace(/,0$/, "") + " h";
};

function escapeHtml(value: any) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(value: any) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function formatDateFR(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("fr-FR");
}

function generatedAtLabel() {
  try {
    return new Date().toLocaleString("fr-FR", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return new Date().toLocaleString("fr-FR");
  }
}

function normalizeInstitutionSettings(json: any): InstitutionSettings {
  const raw = json?.institution || json?.settings || json?.item || json || {};
  const settingsJson = raw?.settings_json || {};

  return {
    ...settingsJson,
    ...raw,
    institution_name:
      raw?.institution_name ||
      raw?.name ||
      settingsJson?.institution_name ||
      settingsJson?.name ||
      null,
    institution_logo_url:
      raw?.institution_logo_url ||
      raw?.logo_url ||
      settingsJson?.institution_logo_url ||
      settingsJson?.logo_url ||
      null,
    institution_phone:
      raw?.institution_phone ||
      raw?.phone ||
      settingsJson?.institution_phone ||
      settingsJson?.phone ||
      null,
    institution_email:
      raw?.institution_email ||
      raw?.email ||
      settingsJson?.institution_email ||
      settingsJson?.email ||
      null,
    institution_postal_address:
      raw?.institution_postal_address ||
      raw?.postal_address ||
      raw?.address ||
      settingsJson?.institution_postal_address ||
      settingsJson?.postal_address ||
      settingsJson?.address ||
      null,
  };
}

/** Ouvre une fenêtre imprimable pour générer un beau PDF via Imprimer → Enregistrer en PDF */
function openPdfPrintWindow({
  title,
  subtitle,
  tableHtml,
  summaryHtml,
  institution,
}: PdfPrintOptions) {
  if (typeof window === "undefined") return;

  const w = window.open("", "_blank", "width=1280,height=850");

  if (!w) {
    alert(
      "Votre navigateur a bloqué la fenêtre d'impression. " +
        "Autorisez les fenêtres pop-up pour ce site."
    );
    return;
  }

  const institutionName = escapeHtml(
    institution?.institution_name || "ÉTABLISSEMENT"
  );

  const institutionMetaParts = [
    institution?.institution_postal_address,
    institution?.institution_phone ? `Tél : ${institution.institution_phone}` : "",
    institution?.institution_email,
    institution?.institution_status,
  ]
    .map((x) => String(x || "").trim())
    .filter(Boolean);

  const institutionMeta = institutionMetaParts.length
    ? institutionMetaParts.map(escapeHtml).join(" • ")
    : "";

  const logoUrl = String(institution?.institution_logo_url || "").trim();

  const logoHtml = logoUrl
    ? `<img src="${escapeAttr(logoUrl)}" alt="Logo établissement" />`
    : `<span>Logo</span>`;

  const html = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    @page {
      size: A4 landscape;
      margin: 6mm;
    }

    * {
      box-sizing: border-box;
    }

    html,
    body {
      margin: 0;
      padding: 0;
      color: #0f172a;
      background: #f8fafc;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    body {
      padding: 8px;
    }

    .sheet {
      min-height: calc(100vh - 16px);
      background: #ffffff;
      border: 1px solid #dbe3ee;
      border-radius: 14px;
      padding: 8px;
      box-shadow: 0 12px 35px rgba(15, 23, 42, 0.06);
    }

    .print-header {
      display: grid;
      grid-template-columns: 70px 1fr 190px;
      gap: 10px;
      align-items: center;
      padding: 8px 10px;
      border: 1px solid #cbd5e1;
      border-radius: 14px;
      background:
        linear-gradient(135deg, rgba(16, 185, 129, 0.10), rgba(15, 23, 42, 0.02)),
        #ffffff;
      position: relative;
      overflow: hidden;
    }

    .print-header::before {
      content: "";
      position: absolute;
      inset: 0;
      border-top: 5px solid #059669;
      pointer-events: none;
    }

    .logo-box {
      height: 58px;
      width: 58px;
      border: 1px solid #cbd5e1;
      border-radius: 12px;
      background: #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      color: #94a3b8;
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
    }

    .logo-box img {
      width: 100%;
      height: 100%;
      object-fit: contain;
      padding: 5px;
    }

    .header-main {
      display: flex;
      flex-direction: column;
      justify-content: center;
      min-width: 0;
    }

    .institution-name {
      font-size: 15px;
      line-height: 1.05;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 0.02em;
      color: #0f172a;
      margin: 0;
    }

    .institution-meta {
      margin-top: 2px;
      font-size: 8.5px;
      color: #475569;
      line-height: 1.2;
    }

    .doc-title {
      margin-top: 5px;
      display: inline-flex;
      width: fit-content;
      align-items: center;
      border-radius: 999px;
      background: #064e3b;
      color: #ffffff;
      padding: 3px 8px;
      font-size: 8.8px;
      font-weight: 800;
      letter-spacing: 0.07em;
      text-transform: uppercase;
    }

    .brand-line {
      margin-top: 3px;
      font-size: 8.8px;
      color: #334155;
    }

    .brand-line strong {
      color: #047857;
      font-weight: 900;
    }

    .header-side {
      border-left: 1px solid #cbd5e1;
      padding-left: 9px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 3px;
      font-size: 8.8px;
      color: #334155;
    }

    .meta-row {
      display: flex;
      justify-content: space-between;
      gap: 6px;
      border-bottom: 1px dashed #cbd5e1;
      padding-bottom: 2px;
    }

    .meta-row:last-child {
      border-bottom: none;
      padding-bottom: 0;
    }

    .meta-row span:first-child {
      color: #64748b;
      font-weight: 700;
    }

    .meta-row span:last-child {
      text-align: right;
      font-weight: 800;
      color: #0f172a;
    }

    .subtitle {
      margin: 5px 0 0;
      padding: 5px 8px;
      border-radius: 10px;
      border: 1px solid #e2e8f0;
      background: #f8fafc;
      color: #334155;
      font-size: 9.5px;
      font-weight: 650;
    }

    .summary-grid {
      margin-top: 5px;
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 6px;
    }

    .summary-card {
      border: 1px solid #dbeafe;
      border-radius: 10px;
      padding: 5px 7px;
      background: linear-gradient(180deg, #ffffff, #f8fafc);
    }

    .summary-label {
      font-size: 8px;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-weight: 900;
    }

    .summary-value {
      margin-top: 2px;
      font-size: 13px;
      color: #0f172a;
      font-weight: 950;
    }

    .summary-note {
      margin-top: 1px;
      font-size: 7.5px;
      color: #64748b;
    }

    .table-wrap {
      margin-top: 5px;
      border: 1px solid #cbd5e1;
      border-radius: 12px;
      overflow: hidden;
    }

    table.matrix-table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 9px;
      background: #ffffff;
    }

    .matrix-table th,
    .matrix-table td {
      border: 1px solid #cbd5e1;
      padding: 4px 5px;
      vertical-align: middle;
    }

    .matrix-table thead th {
      background: #eafaf4;
      color: #064e3b;
      font-weight: 900;
      text-transform: uppercase;
      font-size: 8px;
      letter-spacing: 0.03em;
    }

    .matrix-table tbody tr:nth-child(even) td {
      background: #f8fafc;
    }

    .matrix-table tbody tr:hover td {
      background: #ecfdf5;
    }

    .rank-col {
      width: 34px;
      text-align: center;
    }

    .student-col {
      width: 178px;
      text-align: left;
    }

    .subject-th {
      width: 34px;
      height: 100px;
      padding: 3px !important;
      text-align: center;
      vertical-align: bottom;
    }

    .subject-th > div {
      height: 92px;
      margin: auto;
      writing-mode: vertical-rl;
      transform: rotate(180deg);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: 1;
    }

    .num {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }

    .total-cell,
    .total-head {
      width: 58px;
      text-align: right;
      font-weight: 950;
      color: #0f172a;
      background: #fefce8 !important;
    }

    .matrix-table tfoot td {
      background: #ecfdf5;
      color: #064e3b;
      font-weight: 950;
      font-variant-numeric: tabular-nums;
    }

    .footer {
      margin-top: 6px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      border-top: 1px solid #cbd5e1;
      padding-top: 5px;
      color: #475569;
      font-size: 8.5px;
    }

    .footer strong {
      color: #047857;
      font-weight: 950;
    }

    .signature {
      text-align: right;
      white-space: nowrap;
    }

    @media print {
      body {
        padding: 0;
        background: #ffffff;
      }

      .sheet {
        min-height: auto;
        border: none;
        border-radius: 0;
        box-shadow: none;
        padding: 0;
      }

      .print-header,
      .summary-card,
      .subtitle,
      .table-wrap {
        break-inside: avoid;
      }

      thead {
        display: table-header-group;
      }

      tfoot {
        display: table-footer-group;
      }

      tr {
        break-inside: avoid;
      }
    }
  </style>
</head>
<body>
  <main class="sheet">
    <header class="print-header">
      <div class="logo-box">${logoHtml}</div>

      <div class="header-main">
        <h1 class="institution-name">${institutionName}</h1>
        ${
          institutionMeta
            ? `<div class="institution-meta">${institutionMeta}</div>`
            : ""
        }
        <div class="doc-title">${escapeHtml(title)}</div>
        <div class="brand-line">
          <strong>${escapeHtml(BRAND_COMPANY)}</strong> • ${escapeHtml(
    BRAND_SITE
  )}
        </div>
      </div>

      <aside class="header-side">
        <div class="meta-row">
          <span>Document</span>
          <span>PDF</span>
        </div>
        <div class="meta-row">
          <span>Généré le</span>
          <span>${escapeHtml(generatedAtLabel())}</span>
        </div>
        <div class="meta-row">
          <span>Solution</span>
          <span>Mon Cahier</span>
        </div>
      </aside>
    </header>

    <div class="subtitle">${escapeHtml(subtitle)}</div>

    ${summaryHtml || ""}

    <section class="table-wrap">
      ${tableHtml}
    </section>

    <footer class="footer">
      <div>
        Document généré automatiquement depuis <strong>Mon Cahier</strong>.
      </div>
      <div class="signature">
        ${escapeHtml(BRAND_COMPANY)} • <strong>${escapeHtml(BRAND_SITE)}</strong>
      </div>
    </footer>
  </main>

  <script>
    window.addEventListener("load", function () {
      window.print();
      setTimeout(function () { window.close(); }, 400);
    });
  </script>
</body>
</html>`;

  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
}

/* CSV – échappage + export UTF-16LE (Excel-friendly) */
function csvEscape(x: any) {
  const s = String(x ?? "");
  return `"${s.replace(/"/g, '""')}"`;
}

function downloadCsvUtf16LE(filename: string, content: string) {
  const bom = new Uint8Array([0xff, 0xfe]);
  const buf = new Uint8Array(bom.length + content.length * 2);
  buf.set(bom, 0);

  for (let i = 0; i < content.length; i++) {
    const code = content.charCodeAt(i);
    buf[bom.length + i * 2] = code & 0xff;
    buf[bom.length + i * 2 + 1] = code >> 8;
  }

  const blob = new Blob([buf], { type: "text/csv;charset=utf-16le" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ───────── Page ───────── */
const HOT_RATIO = 0.95;

export default function AbsencesMatrixOnly() {
  // Filtres dates
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rubrique, setRubrique] = useState<"absent" | "tardy">("absent");

  // Sélections niveau / classe
  const [allClasses, setAllClasses] = useState<ClassItem[]>([]);
  const [selectedLevel, setSelectedLevel] = useState("");
  const [selectedClassId, setSelectedClassId] = useState("");

  // Périodes / années scolaires
  const [periods, setPeriods] = useState<GradePeriod[]>([]);
  const [periodsLoading, setPeriodsLoading] = useState(false);
  const [selectedAcademicYear, setSelectedAcademicYear] = useState<string>("");
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>("");

  // Paramètres établissement pour les impressions
  const [institution, setInstitution] = useState<InstitutionSettings | null>(
    null
  );

  // Données matrice
  const [matrix, setMatrix] = useState<MatrixPayload | null>(null);

  // UI
  const [loading, setLoading] = useState(false);

  /* Charger classes */
  useEffect(() => {
    fetch("/api/admin/classes?limit=500", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        const itemsRaw = Array.isArray(j) ? j : j.items || [];
        const items: ClassItem[] = itemsRaw.map((c: any) => ({
          id: String(c.id),
          name: String(c.name || c.label || c.code || "Classe"),
          level: String(c.level || "").trim(),
          academic_year: c.academic_year || null,
        }));
        setAllClasses(items);
      })
      .catch(() => setAllClasses([]));
  }, []);

  /* Charger paramètres établissement pour PDF */
  useEffect(() => {
    const run = async () => {
      try {
        const res = await fetch("/api/admin/institution/settings", {
          cache: "no-store",
        });
        if (!res.ok) return;
        const json = await res.json();
        setInstitution(normalizeInstitutionSettings(json));
      } catch (e) {
        console.warn("[Absences] paramètres établissement indisponibles", e);
        setInstitution(null);
      }
    };
    run();
  }, []);

  /* Charger périodes (même route que les bulletins) */
  useEffect(() => {
    const run = async () => {
      try {
        setPeriodsLoading(true);
        const res = await fetch("/api/admin/institution/grading-periods", {
          cache: "no-store",
        });

        if (!res.ok) {
          console.warn("[Absences] grading-periods non disponible", res.status);
          setPeriods([]);
          return;
        }

        const json = await res.json();
        const items: GradePeriod[] = Array.isArray(json)
          ? json
          : Array.isArray((json as any).items)
          ? (json as any).items
          : [];

        setPeriods(items);
      } catch (e) {
        console.error("[Absences] erreur chargement periods", e);
        setPeriods([]);
      } finally {
        setPeriodsLoading(false);
      }
    };

    run();
  }, []);

  /* Niveaux à partir des classes */
  const levelsFromClasses = useMemo(() => {
    const s = new Set<string>();
    for (const c of allClasses) if (c.level) s.add((c.level || "").trim());
    return Array.from(s).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })
    );
  }, [allClasses]);

  const classesOfLevel = useMemo(() => {
    if (!selectedLevel) return [];
    return allClasses
      .filter((c) => c.level === selectedLevel)
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true })
      );
  }, [allClasses, selectedLevel]);

  /* Années scolaires disponibles */
  const academicYears = useMemo(() => {
    const set = new Set<string>();

    allClasses.forEach((c) => {
      if (c.academic_year) set.add(c.academic_year);
    });

    periods.forEach((p) => {
      if (p.academic_year) set.add(p.academic_year);
    });

    return Array.from(set).sort();
  }, [allClasses, periods]);

  /* Quand on sélectionne une classe, on synchronise l'année scolaire */
  useEffect(() => {
    const cls = allClasses.find((c) => c.id === selectedClassId);
    if (cls?.academic_year) {
      setSelectedAcademicYear(cls.academic_year);
      setSelectedPeriodId("");
    }
  }, [selectedClassId, allClasses]);

  /* Périodes filtrées par année scolaire */
  const filteredPeriods = useMemo(() => {
    if (!selectedAcademicYear) return periods;
    return periods.filter((p) => p.academic_year === selectedAcademicYear);
  }, [periods, selectedAcademicYear]);

  /* Quand on sélectionne une période, on remplit automatiquement les dates */
  useEffect(() => {
    if (!selectedPeriodId) return;
    const p = periods.find((pp) => pp.id === selectedPeriodId);
    if (!p) return;

    setFrom(p.start_date || "");
    setTo(p.end_date || "");
  }, [selectedPeriodId, periods]);

  /* Quand on change de niveau, on vide la classe */
  useEffect(() => {
    setSelectedClassId("");
  }, [selectedLevel]);

  /* Index minutes par élève × matière */
  const matrixIndex = useMemo(() => {
    const dict: Record<string, Record<string, number>> = {};
    if (!matrix) return dict;

    for (const v of matrix.values) {
      if (!dict[v.student_id]) dict[v.student_id] = {};
      dict[v.student_id][v.subject_id] =
        (dict[v.student_id][v.subject_id] || 0) + Number(v.minutes || 0);
    }

    return dict;
  }, [matrix]);

  function setRange(kind: "week" | "month" | "ytd") {
    const now = new Date();

    if (kind === "week") {
      const d = new Date(now);
      const day = (d.getDay() + 6) % 7;
      d.setDate(d.getDate() - day);

      const start = d;
      const end = new Date(start);
      end.setDate(start.getDate() + 6);

      setFrom(toYMD(start));
      setTo(toYMD(end));
    } else if (kind === "month") {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);

      setFrom(toYMD(start));
      setTo(toYMD(end));
    } else {
      const start = new Date(now.getFullYear(), 0, 1);

      setFrom(toYMD(start));
      setTo(toYMD(now));
    }
  }

  /* Rafraîchir matrice */
  async function refreshMatrix() {
    if (!selectedClassId) {
      setMatrix(null);
      return;
    }

    setLoading(true);

    try {
      const qs = new URLSearchParams();
      qs.set("class_id", selectedClassId);
      qs.set("type", rubrique);
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);

      const [mat, subs] = await Promise.all([
        fetch("/api/admin/absences/matrix?" + qs.toString(), {
          cache: "no-store",
        })
          .then((r) => r.json())
          .catch(() => null),
        fetch(`/api/class/subjects?class_id=${selectedClassId}`, {
          cache: "no-store",
        })
          .then((r) => r.json())
          .catch(() => ({ items: [] })),
      ]);

      const payload: MatrixPayload =
        mat && (mat as any).subjects && (mat as any).students
          ? (mat as MatrixPayload)
          : { subjects: [], students: [], values: [], subjectDistinct: {} };

      // matières officielles de la classe
      const classSubjects: MatrixSubject[] = (subs.items || []).map((s: any) => ({
        id: s.id,
        name: (s.label || s.name || "").trim() || s.id,
      }));

      // fusion
      const map = new Map<string, MatrixSubject>();
      for (const s of payload.subjects) map.set(s.id, s);
      for (const s of classSubjects) if (!map.has(s.id)) map.set(s.id, s);

      const mergedSubjects = Array.from(map.values()).sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
      );

      const subjectDistinct: Record<string, number> = {
        ...(payload.subjectDistinct || {}),
      };

      for (const s of mergedSubjects) {
        if (!(s.id in subjectDistinct)) subjectDistinct[s.id] = 0;
      }

      const sortedStudents = [...(payload.students || [])].sort((a, b) =>
        (a.full_name || "").localeCompare(b.full_name || "", undefined, {
          sensitivity: "base",
        })
      );

      const numberedStudents: MatrixStudent[] = sortedStudents.map((s, i) => ({
        ...s,
        rank: (s as any).rank ?? i + 1,
      }));

      setMatrix({
        subjects: mergedSubjects,
        students: numberedStudents,
        values: payload.values || [],
        subjectDistinct,
      });
    } catch {
      setMatrix(null);
    } finally {
      setLoading(false);
    }
  }

  function resetAll() {
    setFrom("");
    setTo("");
    setRubrique("absent");
    setSelectedLevel("");
    setSelectedClassId("");
    setSelectedAcademicYear("");
    setSelectedPeriodId("");
    setMatrix(null);
  }

  /* Totaux & éléments « chauds » */
  const subjectTotals = useMemo(() => {
    const m = new Map<string, number>();
    if (!matrix) return m;

    for (const v of matrix.values) {
      m.set(v.subject_id, (m.get(v.subject_id) || 0) + (v.minutes || 0));
    }

    return m;
  }, [matrix]);

  const studentTotals = useMemo(() => {
    const m = new Map<string, number>();
    if (!matrix) return m;

    for (const v of matrix.values) {
      m.set(v.student_id, (m.get(v.student_id) || 0) + (v.minutes || 0));
    }

    return m;
  }, [matrix]);

  function computeHotSet(m: Map<string, number>) {
    const vals = Array.from(m.values());
    if (!vals.length) return new Set<string>();

    const max = Math.max(...vals);
    if (max <= 0) return new Set<string>();

    const thr = Math.ceil(max * HOT_RATIO);
    const out = new Set<string>();

    for (const [id, total] of m) if (total >= thr) out.add(id);

    return out;
  }

  const hotSubjects = useMemo(
    () => computeHotSet(subjectTotals),
    [subjectTotals]
  );

  const hotStudents = useMemo(
    () => computeHotSet(studentTotals),
    [studentTotals]
  );

  const selectedClass = useMemo(() => {
    if (!selectedClassId) return null;
    return allClasses.find((c) => c.id === selectedClassId) || null;
  }, [allClasses, selectedClassId]);

  const globalStats = useMemo<{
    studentsCount: number;
    subjectsCount: number;
    totalMinutesAll: number;
    avgPerStudent: number;
    avgPerSubject: number;
    topStudents: TopStudent[];
    topSubjects: TopSubject[];
  } | null>(() => {
    if (!matrix) return null;

    const studentsCount = matrix.students.length;
    const subjectsCount = matrix.subjects.length;

    let totalMinutesAll = 0;
    for (const v of matrix.values) totalMinutesAll += v.minutes || 0;

    const avgPerStudent = studentsCount ? totalMinutesAll / studentsCount : 0;
    const avgPerSubject = subjectsCount ? totalMinutesAll / subjectsCount : 0;

    const topStudents: TopStudent[] = [...matrix.students]
      .map((s) => ({
        ...s,
        total: studentTotals.get(s.id) || 0,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    const topSubjects: TopSubject[] = [...matrix.subjects]
      .map((s) => ({
        ...s,
        total: subjectTotals.get(s.id) || 0,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    return {
      studentsCount,
      subjectsCount,
      totalMinutesAll,
      avgPerStudent,
      avgPerSubject,
      topStudents,
      topSubjects,
    };
  }, [matrix, studentTotals, subjectTotals]);

  /* Export CSV */
  function exportMatrixCsv() {
    if (!matrix) return;

    const sep = ";";
    const EOL = "\r\n";
    const lines: string[] = [];

    lines.push("sep=;");

    const head = ["N°", "Élève", ...matrix.subjects.map((s) => s.name), "Total"];
    lines.push(head.map(csvEscape).join(sep));

    for (const stu of matrix.students) {
      const row: string[] = [
        csvEscape(String(stu.rank ?? "")),
        csvEscape(stu.full_name),
      ];

      let tot = 0;

      for (const sub of matrix.subjects) {
        const min = matrixIndex[stu.id]?.[sub.id] || 0;
        tot += min;

        const cell =
          rubrique === "absent"
            ? min
              ? String((min / 60).toFixed(1)).replace(".", ",")
              : ""
            : min
            ? String(min)
            : "";

        row.push(csvEscape(cell));
      }

      const totalCell =
        rubrique === "absent"
          ? tot
            ? String((tot / 60).toFixed(1)).replace(".", ",")
            : ""
          : tot
          ? String(tot)
          : "";

      row.push(csvEscape(totalCell));
      lines.push(row.join(sep));
    }

    const csv = lines.join(EOL);

    downloadCsvUtf16LE(
      `matrice_${rubrique}_${from || "debut"}_${to || "fin"}.csv`,
      csv
    );
  }

  /* Export PDF via fenêtre d'impression – matrice élèves × disciplines */
  function exportMatrixPdf() {
    if (!matrix || !globalStats) return;

    const selectedPeriod = selectedPeriodId
      ? periods.find((pp) => pp.id === selectedPeriodId)
      : null;

    const periodLabel = (() => {
      if (selectedPeriod) {
        return (
          selectedPeriod.label ||
          selectedPeriod.short_label ||
          selectedPeriod.code ||
          `${selectedPeriod.start_date} → ${selectedPeriod.end_date}`
        );
      }

      if (from || to) return `${from || "début"} → ${to || "fin"}`;

      return "Toute la période";
    })();

    const classLabel = selectedClass
      ? `${selectedClass.name} (${selectedClass.level})`
      : selectedLevel
      ? `Niveau ${selectedLevel}`
      : "Classe non précisée";

    const rubriqueLabel =
      rubrique === "absent" ? "Absences (heures)" : "Retards (minutes)";

    const yearLabel =
      selectedAcademicYear ||
      selectedClass?.academic_year ||
      selectedPeriod?.academic_year ||
      "—";

    const valueLabel = (min: number) =>
      rubrique === "absent" ? hoursLabel(min) : `${nf.format(min)} min`;

    const summaryHtml = `
      <section class="summary-grid">
        <div class="summary-card">
          <div class="summary-label">Année scolaire</div>
          <div class="summary-value">${escapeHtml(yearLabel)}</div>
          <div class="summary-note">Référence administrative</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">Élèves</div>
          <div class="summary-value">${escapeHtml(
            nf.format(globalStats.studentsCount)
          )}</div>
          <div class="summary-note">Effectif dans la matrice</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">Disciplines</div>
          <div class="summary-value">${escapeHtml(
            nf.format(globalStats.subjectsCount)
          )}</div>
          <div class="summary-note">Colonnes contrôlées</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">Total période</div>
          <div class="summary-value">${escapeHtml(
            valueLabel(globalStats.totalMinutesAll)
          )}</div>
          <div class="summary-note">Toutes disciplines confondues</div>
        </div>
      </section>
    `;

    const headerHtml = `
      <thead>
        <tr>
          <th class="rank-col">N°</th>
          <th class="student-col">Élève</th>
          ${matrix.subjects
            .map(
              (s) =>
                `<th class="subject-th" title="${escapeAttr(
                  s.name
                )}"><div>${escapeHtml(s.name)}</div></th>`
            )
            .join("")}
          <th class="total-head">Total</th>
        </tr>
      </thead>
    `;

    const bodyHtml = matrix.students
      .map((stu, idx) => {
        let totalMinutes = 0;

        const cellsHtml = matrix.subjects
          .map((subj) => {
            const minutes = matrixIndex[stu.id]?.[subj.id] || 0;
            totalMinutes += minutes;
            const display =
              rubrique === "absent" ? hoursLabel(minutes) : nf.format(minutes);

            return `<td class="num">${escapeHtml(display)}</td>`;
          })
          .join("");

        const totalDisplay =
          rubrique === "absent"
            ? hoursLabel(totalMinutes)
            : `${nf.format(totalMinutes)} min`;

        return `
          <tr>
            <td class="rank-col">${escapeHtml(stu.rank ?? idx + 1)}</td>
            <td class="student-col">${escapeHtml(stu.full_name)}</td>
            ${cellsHtml}
            <td class="total-cell">${escapeHtml(totalDisplay)}</td>
          </tr>
        `;
      })
      .join("");

    const totalsRowCells = matrix.subjects
      .map((subj) => {
        const minutes = subjectTotals.get(subj.id) || 0;
        const display = valueLabel(minutes);
        return `<td class="num">${escapeHtml(display)}</td>`;
      })
      .join("");

    const footerHtml = `
      <tfoot>
        <tr>
          <td colspan="2">Total général</td>
          ${totalsRowCells}
          <td class="total-cell">${escapeHtml(
            valueLabel(globalStats.totalMinutesAll)
          )}</td>
        </tr>
      </tfoot>
    `;

    const tableHtml = `
      <table class="matrix-table">
        ${headerHtml}
        <tbody>${bodyHtml}</tbody>
        ${footerHtml}
      </table>
    `;

    openPdfPrintWindow({
      title: `Matrice des ${rubrique === "absent" ? "absences" : "retards"}`,
      subtitle: `Classe : ${classLabel} • Période : ${periodLabel} • Rubrique : ${rubriqueLabel}`,
      summaryHtml,
      tableHtml,
      institution,
    });
  }

  const hasClass = Boolean(selectedClassId);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-slate-900">
          Matrice des absences
        </h1>
        <p className="text-sm text-slate-600">
          Filtre la période, l&apos;année scolaire, le niveau, la classe et la
          rubrique (absence/retard). Le tableau affiche les élèves en lignes et
          les disciplines en colonnes.
        </p>
      </div>

      {/* Filtres */}
      <Card
        title="Filtres"
        subtitle="Choisis d’abord l’année scolaire, puis éventuellement une période, puis le niveau et la classe. Les dates restent modifiables."
        actions={
          <div className="flex items-center gap-2">
            <GhostButton onClick={() => setRange("week")}>
              <Calendar className="h-4 w-4" /> Semaine
            </GhostButton>
            <GhostButton onClick={() => setRange("month")}>
              <Calendar className="h-4 w-4" /> Mois
            </GhostButton>
            <GhostButton onClick={() => setRange("ytd")}>
              <Calendar className="h-4 w-4" /> Année à date
            </GhostButton>
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
          {/* Année scolaire */}
          <div className="md:col-span-2">
            <div className="mb-1 text-xs font-semibold uppercase text-slate-500">
              Année scolaire
            </div>
            <Select
              value={selectedAcademicYear}
              onChange={(e) => {
                const year = e.target.value;
                setSelectedAcademicYear(year);
                setSelectedPeriodId("");
              }}
              disabled={periodsLoading || academicYears.length === 0}
            >
              <option value="">
                {academicYears.length === 0
                  ? "Non configuré"
                  : "Toutes années…"}
              </option>
              {academicYears.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </Select>
          </div>

          {/* Période */}
          <div className="md:col-span-2">
            <div className="mb-1 text-xs font-semibold uppercase text-slate-500">
              Période (trimestre / séquence)
            </div>
            <Select
              value={selectedPeriodId}
              onChange={(e) => setSelectedPeriodId(e.target.value)}
              disabled={periodsLoading || filteredPeriods.length === 0}
            >
              <option value="">
                {filteredPeriods.length === 0
                  ? "Aucune période"
                  : "Sélectionner…"}
              </option>
              {filteredPeriods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label ||
                    p.short_label ||
                    p.code ||
                    `${formatDateFR(p.start_date)} → ${formatDateFR(
                      p.end_date
                    )}`}
                </option>
              ))}
            </Select>
          </div>

          {/* Niveau */}
          <div className="md:col-span-1">
            <div className="mb-1 text-xs text-slate-500">Niveau</div>
            <Select
              value={selectedLevel}
              onChange={(e) => setSelectedLevel(e.target.value)}
            >
              <option value="">— Tous —</option>
              {levelsFromClasses.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </Select>
          </div>

          {/* Classe */}
          <div className="md:col-span-1">
            <div className="mb-1 text-xs text-slate-500">Classe</div>
            <Select
              value={selectedClassId}
              onChange={(e) => setSelectedClassId(e.target.value)}
              disabled={!selectedLevel}
            >
              <option value="">— Choisir —</option>
              {classesOfLevel.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>

          {/* Rubrique */}
          <div className="md:col-span-2">
            <div className="mb-1 text-xs text-slate-500">Rubrique</div>
            <Select
              value={rubrique}
              onChange={(e) => setRubrique(e.target.value as any)}
            >
              <option value="absent">Absences (heures)</option>
              <option value="tardy">Retards (minutes)</option>
            </Select>
          </div>

          {/* Du */}
          <div className="md:col-span-2">
            <div className="mb-1 text-xs text-slate-500">Du</div>
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>

          {/* Au */}
          <div className="md:col-span-2">
            <div className="mb-1 text-xs text-slate-500">Au</div>
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            onClick={refreshMatrix}
            disabled={Boolean(loading || !selectedClassId)}
          >
            {loading ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Filter className="h-4 w-4" />
            )}
            Actualiser
          </Button>

          <GhostButton onClick={resetAll}>Réinitialiser</GhostButton>

          <GhostButton onClick={exportMatrixCsv} disabled={!matrix}>
            <Download className="h-4 w-4" /> Export CSV
          </GhostButton>

          <GhostButton onClick={exportMatrixPdf} disabled={!matrix}>
            <FileText className="h-4 w-4" /> Imprimer / PDF (matrice)
          </GhostButton>
        </div>
      </Card>

      {/* Synthèse visuelle */}
      {matrix && globalStats && (
        <Card
          title="Synthèse de la période sélectionnée"
          subtitle="Vue d’ensemble des absences/retards pour cette classe et cette période."
        >
          <div className="grid gap-4 md:grid-cols-4">
            <div className="rounded-xl bg-emerald-50 px-4 py-3">
              <div className="text-[11px] font-semibold uppercase text-emerald-700">
                Élèves
              </div>
              <div className="mt-1 text-xl font-bold text-emerald-900">
                {globalStats.studentsCount}
              </div>
              <div className="mt-1 text-xs text-emerald-800/80">
                Nombre d&apos;élèves dans la matrice
              </div>
            </div>

            <div className="rounded-xl bg-indigo-50 px-4 py-3">
              <div className="text-[11px] font-semibold uppercase text-indigo-700">
                Disciplines
              </div>
              <div className="mt-1 text-xl font-bold text-indigo-900">
                {globalStats.subjectsCount}
              </div>
              <div className="mt-1 text-xs text-indigo-800/80">
                Colonnes de la matrice
              </div>
            </div>

            <div className="rounded-xl bg-amber-50 px-4 py-3">
              <div className="text-[11px] font-semibold uppercase text-amber-700">
                Total sur la période
              </div>
              <div className="mt-1 text-xl font-bold text-amber-900">
                {rubrique === "absent"
                  ? hoursLabel(globalStats.totalMinutesAll)
                  : `${nf.format(globalStats.totalMinutesAll)} min`}
              </div>
              <div className="mt-1 text-xs text-amber-800/80">
                Somme sur toutes les disciplines et tous les élèves
              </div>
            </div>

            <div className="rounded-xl bg-rose-50 px-4 py-3">
              <div className="text-[11px] font-semibold uppercase text-rose-700">
                Moyenne par élève
              </div>
              <div className="mt-1 text-xl font-bold text-rose-900">
                {rubrique === "absent"
                  ? hoursLabel(globalStats.avgPerStudent)
                  : `${nf.format(globalStats.avgPerStudent)} min`}
              </div>
              <div className="mt-1 text-xs text-rose-800/80">
                Charge moyenne par élève sur la période
              </div>
            </div>
          </div>

          {/* Tops */}
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-amber-100 bg-amber-50/40 px-4 py-3">
              <div className="mb-2 text-xs font-semibold uppercase text-amber-700">
                ÉLÈVES LES PLUS CONCERNÉS
              </div>

              {globalStats.topStudents.length === 0 ? (
                <div className="text-xs text-amber-800/80">
                  Aucun élève concerné sur cette période.
                </div>
              ) : (
                <ul className="space-y-1 text-xs text-amber-900">
                  {globalStats.topStudents.map((s, idx) => (
                    <li
                      key={s.id}
                      className="flex items-center justify-between gap-2 rounded-lg bg-white/60 px-2 py-1"
                    >
                      <span className="flex items-center gap-2">
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-100 text-[10px] font-semibold text-amber-800">
                          {idx + 1}
                        </span>
                        <span className="truncate">{s.full_name}</span>
                      </span>
                      <span className="text-[11px] font-semibold text-amber-900">
                        {rubrique === "absent"
                          ? hoursLabel(s.total)
                          : `${nf.format(s.total)} min`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-xl border border-rose-100 bg-rose-50/40 px-4 py-3">
              <div className="mb-2 text-xs font-semibold uppercase text-rose-700">
                DISCIPLINES LES PLUS CONCERNÉES
              </div>

              {globalStats.topSubjects.length === 0 ? (
                <div className="text-xs text-rose-800/80">
                  Aucune discipline concernée sur cette période.
                </div>
              ) : (
                <ul className="space-y-1 text-xs text-rose-900">
                  {globalStats.topSubjects.map((s, idx) => (
                    <li
                      key={s.id}
                      className="flex items-center justify-between gap-2 rounded-lg bg-white/60 px-2 py-1"
                    >
                      <span className="flex items-center gap-2">
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-rose-100 text-[10px] font-semibold text-rose-800">
                          {idx + 1}
                        </span>
                        <span className="truncate">{s.name}</span>
                      </span>
                      <span className="text-[11px] font-semibold text-rose-900">
                        {rubrique === "absent"
                          ? hoursLabel(s.total)
                          : `${nf.format(s.total)} min`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Matrice */}
      <Card
        title="Matrice — Élèves × Disciplines"
        subtitle={
          hasClass
            ? rubrique === "absent"
              ? "Valeurs en heures"
              : "Valeurs en minutes"
            : "Sélectionne une classe puis Actualiser"
        }
      >
        {!hasClass ? (
          <div className="text-sm text-slate-600">—</div>
        ) : loading && !matrix ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-10 w-full animate-pulse rounded bg-slate-100"
              />
            ))}
          </div>
        ) : !matrix ? (
          <div className="text-sm text-slate-600">
            Aucune donnée pour la période/classe sélectionnée.
          </div>
        ) : (
          <div className="overflow-auto">
            <table className="min-w-full rounded-xl border border-slate-200 text-sm">
              <thead className="sticky top-0 z-10 bg-slate-100">
                <tr>
                  <th className="w-12 px-2 py-2 text-left align-bottom">N°</th>
                  <th className="sticky left-0 z-20 bg-slate-100 px-3 py-2 text-left align-bottom">
                    Élève
                  </th>

                  {matrix.subjects.map((subj) => {
                    const isHot = hotSubjects.has(subj.id);

                    return (
                      <th
                        key={subj.id}
                        className={[
                          "px-2 py-2 text-center align-bottom",
                          isHot
                            ? "bg-rose-50 text-rose-800 ring-1 ring-rose-200"
                            : "",
                        ].join(" ")}
                        title={
                          isHot
                            ? "Discipline la plus concernée sur la période"
                            : undefined
                        }
                      >
                        <div className="mx-auto h-24 w-8 rotate-180 whitespace-nowrap [writing-mode:vertical-rl]">
                          {subj.name}
                          {isHot ? " 🔥" : ""}
                        </div>
                      </th>
                    );
                  })}

                  <th className="px-2 py-2 text-center align-bottom">Total</th>
                </tr>
              </thead>

              <tbody>
                {matrix.students.map((stu, rIdx) => {
                  const isHotRow = hotStudents.has(stu.id);
                  const totalMinutes = studentTotals.get(stu.id) || 0;

                  return (
                    <tr
                      key={stu.id}
                      className={[
                        "border-t hover:bg-slate-100",
                        isHotRow
                          ? "bg-amber-50"
                          : rIdx % 2
                          ? "bg-slate-50"
                          : "bg-white",
                      ].join(" ")}
                      title={
                        isHotRow
                          ? "Élève parmi les plus concernés sur la période"
                          : undefined
                      }
                    >
                      <td className="px-2 py-2 text-left tabular-nums">
                        {stu.rank ?? rIdx + 1}
                      </td>

                      <td
                        className={[
                          "sticky left-0 z-10 px-3 py-2",
                          isHotRow ? "bg-amber-50 font-medium" : "bg-inherit",
                        ].join(" ")}
                      >
                        {stu.full_name}
                      </td>

                      {matrix.subjects.map((subj, cIdx) => {
                        const minutes = matrixIndex[stu.id]?.[subj.id] || 0;
                        const tipCount = matrix.subjectDistinct[subj.id] ?? 0;
                        const zebraCol = cIdx % 2 ? "bg-slate-50/60" : "";
                        const isHotCol = hotSubjects.has(subj.id);

                        return (
                          <td
                            key={subj.id}
                            className={[
                              "px-2 py-2 text-center tabular-nums",
                              zebraCol,
                              isHotCol ? "bg-rose-50/70" : "",
                            ].join(" ")}
                            title={`${tipCount} élève(s) distinct(s) ${
                              rubrique === "absent"
                                ? "absent(s)"
                                : "en retard"
                            } en « ${subj.name} » sur la période`}
                          >
                            {rubrique === "absent"
                              ? hoursLabel(minutes)
                              : nf.format(minutes)}
                          </td>
                        );
                      })}

                      <td
                        className="px-2 py-2 text-center font-semibold tabular-nums text-slate-900"
                        title="Somme sur toutes les disciplines de la période"
                      >
                        {rubrique === "absent"
                          ? hoursLabel(totalMinutes)
                          : nf.format(totalMinutes)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="mt-2 text-[11px] text-slate-500">
              Survole une case pour voir le nombre d’élèves distincts concernés
              par la discipline. Les colonnes en rose et les lignes en jaune
              mettent en évidence les plus gros totaux de la période.
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}