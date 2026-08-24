// src/app/admin/notes/bilan/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  CalendarDays,
  FileText,
  Loader2,
  Printer,
  RefreshCw,
  School,
  Trophy,
} from "lucide-react";
import EducationScopeFilter from "@/components/admin/EducationScopeFilter";
import {
  buildEducationScopeSearchParams,
  DEFAULT_EDUCATION_SCOPE,
  type EducationScopedClass,
  type EducationScopeValue,
} from "@/lib/education-scope";

type PeriodRow = {
  id: string;
  academic_year: string | null;
  code: string | null;
  label: string | null;
  short_label: string | null;
  start_date: string | null;
  end_date: string | null;
  order_index: number | null;
};

type InstitutionRow = {
  name?: string | null;
  logo_url?: string | null;
  phone?: string | null;
  email?: string | null;
  regional_direction?: string | null;
  postal_address?: string | null;
  status?: string | null;
  head_name?: string | null;
  head_title?: string | null;
  country_name?: string | null;
  country_motto?: string | null;
  ministry_name?: string | null;
  code?: string | null;
  settings_json?: any;
};

type StudentPerformance = {
  student_id: string;
  full_name: string;
  nom: string;
  prenoms: string;
  matricule: string | null;
  class_id: string;
  class_label: string;
  level: string;
  cycle: string;
  moyenne: number;
  rang_classe: number | null;
  moyenne_scientifique: number | null;
  moyenne_litteraire: number | null;
};

type ClassSummary = {
  class_id: string;
  class_label: string;
  level: string;
  cycle: string;
  effectif: number;
  classes_count: number;
  moyenne_classe: number | null;
  absence_count: number;
  absence_minutes: number;
};

type Leader = {
  id: string;
  label: string;
  count: number;
  meta?: string | null;
};

type TopByClassItem = {
  class_id: string;
  class_label: string;
  level: string;
  items: StudentPerformance[];
};

type ReportData = {
  ok: boolean;
  institution?: InstitutionRow | null;
  academic_year: string;
  periods: PeriodRow[];
  selected_period: PeriodRow | null;
  mode: "period" | "annual";
  top_by_class: TopByClassItem[];
  top_by_level: Record<string, StudentPerformance[]>;
  top_by_cycle: Record<string, StudentPerformance[]>;
  top_school: StudentPerformance[];
  top_scientific_by_level: Record<string, StudentPerformance[]>;
  top_literary_by_level: Record<string, StudentPerformance[]>;
  class_merit: ClassSummary[];
  class_absence_merit: ClassSummary[];
  teacher_evaluation_leaders: Leader[];
  class_evaluation_leaders: Leader[];
  meta?: {
    period_label?: string;
    report_from?: string;
    report_to?: string;
    generated_at?: string;
    classes_count?: number;
    classed_students_count?: number;
    total_published_evaluations?: number;
    message?: string;
  };
};

const BRAND_SITE = "www.mon-cahier.com";
const BRAND_SLOGAN = "La plateforme idéale pour une école connectée, l’école du futur.";
const ANNUAL_SELECTOR_VALUE = "__annual__";

function formatAvg(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  return Number(value).toFixed(2);
}

function formatInt(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  return String(Math.round(Number(value)));
}

function periodLabel(period: PeriodRow | null | undefined) {
  if (!period) return "Période";
  return period.short_label || period.label || period.code || "Période";
}

function reportLabel(data: ReportData | null, period: PeriodRow | null | undefined) {
  if (!data) return "Chargez le bilan pour afficher les données.";
  if (data.mode === "annual") return `Bilan annuel • ${data.academic_year}`;
  return `${periodLabel(period)} • ${data.academic_year}`;
}

function formatDateFr(value?: string | null) {
  if (!value) return "—";
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("fr-FR");
}

function generatedAtLabel(value?: string | null) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return new Date().toLocaleString("fr-FR");
  return d.toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function institutionName(data: ReportData | null) {
  const inst = data?.institution;
  return safeText(inst?.name || inst?.settings_json?.institution_name || inst?.settings_json?.name) || "ÉTABLISSEMENT";
}

function classNameJoin(student: StudentPerformance) {
  return [student.nom, student.prenoms].filter(Boolean).join(" ") || student.full_name;
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

function StatCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
          {icon}
        </div>
        <div>
          <div className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</div>
          <div className="mt-0.5 text-xl font-black text-slate-950">{value}</div>
        </div>
      </div>
    </div>
  );
}

function StudentMiniTable({ items, valueKey = "moyenne" }: { items: StudentPerformance[]; valueKey?: "moyenne" | "moyenne_scientifique" | "moyenne_litteraire" }) {
  if (!items.length) {
    return <div className="rounded-xl border border-dashed border-slate-200 p-3 text-sm text-slate-500">Aucune moyenne exploitable.</div>;
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <table className="min-w-[560px] text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2">Rang</th>
            <th className="px-3 py-2">Matricule</th>
            <th className="px-3 py-2">Nom et prénoms</th>
            <th className="px-3 py-2">Classe</th>
            <th className="px-3 py-2 text-right">Moyenne</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.map((item, idx) => (
            <tr key={`${item.student_id}-${idx}`}>
              <td className="px-3 py-2 font-black text-slate-900">{idx + 1}</td>
              <td className="px-3 py-2 text-slate-600">{item.matricule || "—"}</td>
              <td className="px-3 py-2 font-bold text-slate-900 whitespace-nowrap">{classNameJoin(item)}</td>
              <td className="px-3 py-2 text-slate-600">{item.class_label}</td>
              <td className="px-3 py-2 text-right font-black text-emerald-700">{formatAvg(item[valueKey])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderStudentRows(items: StudentPerformance[], valueKey: "moyenne" | "moyenne_scientifique" | "moyenne_litteraire" = "moyenne") {
  if (!items.length) {
    return `<tr><td colspan="5" class="empty">Aucune donnée exploitable.</td></tr>`;
  }

  return items
    .map(
      (item, idx) => `<tr>
        <td class="rank">${idx + 1}</td>
        <td>${escapeHtml(item.matricule || "—")}</td>
        <td class="strong">${escapeHtml(classNameJoin(item))}</td>
        <td>${escapeHtml(item.class_label)}</td>
        <td class="num strong">${escapeHtml(formatAvg(item[valueKey]))}</td>
      </tr>`,
    )
    .join("");
}

function renderGroupedStudents(title: string, groups: Record<string, StudentPerformance[]>, valueKey: "moyenne" | "moyenne_scientifique" | "moyenne_litteraire" = "moyenne") {
  const entries = Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0], "fr", { numeric: true, sensitivity: "base" }));
  if (!entries.length) return `<section class="block"><h2>${escapeHtml(title)}</h2><p class="empty-text">Aucune donnée exploitable.</p></section>`;

  return `<section class="block"><h2>${escapeHtml(title)}</h2>${entries
    .map(
      ([label, items]) => `<div class="subblock">
        <h3>${escapeHtml(label)}</h3>
        <table><thead><tr><th>Rang</th><th>Matricule</th><th>Nom et prénoms</th><th>Classe</th><th>Moyenne</th></tr></thead><tbody>${renderStudentRows(items, valueKey)}</tbody></table>
      </div>`,
    )
    .join("")}</section>`;
}

function buildReportHtml(data: ReportData) {
  const inst = data.institution || {};
  const instName = institutionName(data);
  const logoUrl = safeText(inst.logo_url);
  const logoHtml = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="Logo" />`
    : `<span>Logo</span>`;
  const period = data.selected_period;
  const docTitle = data.mode === "annual" ? "Bilan annuel" : "Bilan trimestriel";
  const periodText = data.mode === "annual"
    ? `Année scolaire ${data.academic_year} (${formatDateFr(data.meta?.report_from || period?.start_date)} - ${formatDateFr(data.meta?.report_to || period?.end_date)})`
    : `${periodLabel(period)} (${formatDateFr(period?.start_date)} - ${formatDateFr(period?.end_date)})`;
  const metaLine = [inst.postal_address, inst.phone ? `Tél : ${inst.phone}` : "", inst.email, inst.code ? `Code : ${inst.code}` : ""]
    .map(safeText)
    .filter(Boolean)
    .map(escapeHtml)
    .join(" • ");

  const topByClass = data.top_by_class
    .map(
      (group) => `<div class="subblock keep">
        <h3>${escapeHtml(group.class_label)} <span>${escapeHtml(group.level)}</span></h3>
        <table><thead><tr><th>Rang</th><th>Matricule</th><th>Nom et prénoms</th><th>Classe</th><th>Moyenne</th></tr></thead><tbody>${renderStudentRows(group.items)}</tbody></table>
      </div>`,
    )
    .join("");

  const classMeritRows = data.class_merit
    .map(
      (row, idx) => `<tr>
        <td class="rank">${idx + 1}</td><td class="strong">${escapeHtml(row.class_label)}</td><td>${escapeHtml(row.level)}</td>
        <td class="num">${escapeHtml(formatInt(row.effectif))}</td><td class="num">${escapeHtml(formatInt(row.classes_count))}</td><td class="num strong">${escapeHtml(formatAvg(row.moyenne_classe))}</td>
      </tr>`,
    )
    .join("") || `<tr><td colspan="6" class="empty">Aucune donnée exploitable.</td></tr>`;

  const absenceRows = data.class_absence_merit
    .map(
      (row, idx) => `<tr>
        <td class="rank">${idx + 1}</td><td class="strong">${escapeHtml(row.class_label)}</td><td>${escapeHtml(row.level)}</td>
        <td class="num strong">${escapeHtml(formatInt(row.absence_count))}</td><td class="num">${escapeHtml(formatInt(row.absence_minutes))}</td><td class="num">${escapeHtml(formatAvg(row.moyenne_classe))}</td>
      </tr>`,
    )
    .join("") || `<tr><td colspan="6" class="empty">Aucune donnée exploitable.</td></tr>`;

  const teacherRows = data.teacher_evaluation_leaders
    .slice(0, 20)
    .map((row, idx) => `<tr><td class="rank">${idx + 1}</td><td class="strong">${escapeHtml(row.label)}</td><td class="num strong">${escapeHtml(formatInt(row.count))}</td></tr>`)
    .join("") || `<tr><td colspan="3" class="empty">Aucune évaluation publiée sur la période.</td></tr>`;

  const classEvalRows = data.class_evaluation_leaders
    .slice(0, 20)
    .map((row, idx) => `<tr><td class="rank">${idx + 1}</td><td class="strong">${escapeHtml(row.label)}</td><td>${escapeHtml(row.meta || "")}</td><td class="num strong">${escapeHtml(formatInt(row.count))}</td></tr>`)
    .join("") || `<tr><td colspan="4" class="empty">Aucune évaluation publiée sur la période.</td></tr>`;

  const footer = `<div class="footer"><strong>${BRAND_SITE}</strong> - ${escapeHtml(BRAND_SLOGAN)}</div>`;

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(docTitle)} - ${escapeHtml(instName)}</title>
<style>
  @page { size: A4 portrait; margin: 12mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; color: #0f172a; background: #eef2f7; font-family: Inter, Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { padding: 14px; }
  .page { min-height: calc(297mm - 24mm); background: white; border: 1px solid #dbe3ee; border-radius: 18px; padding: 16px; position: relative; page-break-after: always; box-shadow: 0 20px 55px rgba(15,23,42,.08); }
  .page:last-child { page-break-after: auto; }
  .cover { display: flex; flex-direction: column; justify-content: space-between; overflow: hidden; }
  .cover:before { content: ""; position: absolute; inset: 0; background: radial-gradient(circle at top right, rgba(16,185,129,.16), transparent 36%), linear-gradient(135deg, rgba(15,23,42,.04), rgba(16,185,129,.05)); pointer-events: none; }
  .cover-inner { position: relative; z-index: 1; }
  .official { display: grid; grid-template-columns: 96px 1fr; gap: 16px; align-items: center; border: 1px solid #cbd5e1; border-radius: 18px; padding: 14px; background: rgba(255,255,255,.9); }
  .logo { width: 82px; height: 82px; border: 1px solid #cbd5e1; border-radius: 16px; display: flex; align-items: center; justify-content: center; color: #94a3b8; font-size: 11px; font-weight: 900; overflow: hidden; background: white; }
  .logo img { width: 100%; height: 100%; object-fit: contain; padding: 6px; }
  .inst h1 { margin: 0; font-size: 20px; line-height: 1.1; text-transform: uppercase; color: #0f172a; }
  .meta { margin-top: 5px; font-size: 10px; line-height: 1.4; color: #475569; }
  .title-zone { margin: 58px 0 40px; text-align: center; }
  .kicker { display: inline-block; border-radius: 999px; background: #064e3b; color: white; padding: 7px 14px; font-size: 11px; font-weight: 950; letter-spacing: .12em; text-transform: uppercase; }
  .title-zone h2 { margin: 18px auto 0; max-width: 720px; font-size: 34px; line-height: 1.08; color: #0f172a; text-transform: uppercase; }
  .title-zone p { margin: 12px auto 0; max-width: 650px; color: #475569; font-weight: 700; }
  .cover-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-top: 30px; }
  .cover-card { border: 1px solid #dbe3ee; border-radius: 16px; padding: 13px; background: white; }
  .cover-card span { display: block; color: #64748b; font-size: 10px; font-weight: 900; text-transform: uppercase; letter-spacing: .08em; }
  .cover-card strong { display: block; margin-top: 4px; color: #0f172a; font-size: 16px; }
  .block h2 { margin: 0 0 12px; padding: 9px 12px; border-radius: 14px; background: #0f172a; color: white; font-size: 15px; text-transform: uppercase; letter-spacing: .04em; }
  .subblock { margin: 0 0 14px; break-inside: avoid; }
  .subblock h3 { margin: 0 0 7px; color: #065f46; font-size: 13px; }
  .subblock h3 span { color: #64748b; font-size: 11px; font-weight: 800; }
  table { width: 100%; border-collapse: collapse; margin: 0 0 10px; font-size: 10.5px; }
  th { background: #e2e8f0; color: #0f172a; text-transform: uppercase; font-size: 9px; letter-spacing: .04em; }
  th, td { border: 1px solid #cbd5e1; padding: 6px 7px; vertical-align: top; }
  tr:nth-child(even) td { background: #f8fafc; }
  .rank { width: 42px; text-align: center; font-weight: 950; color: #064e3b; }
  .num { text-align: right; white-space: nowrap; }
  .strong { font-weight: 950; color: #0f172a; }
  .empty, .empty-text { color: #64748b; font-style: italic; text-align: center; }
  .two-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; align-items: start; }
  .footer { position: absolute; left: 16px; right: 16px; bottom: 8px; padding-top: 6px; border-top: 1px solid #cbd5e1; text-align: center; color: #475569; font-size: 9.5px; }
  .footer strong { color: #047857; }
  @media print { body { padding: 0; background: white; } .page { border: 0; border-radius: 0; box-shadow: none; min-height: 273mm; } }
</style>
</head>
<body>
  <section class="page cover">
    <div class="cover-inner">
      <div class="official">
        <div class="logo">${logoHtml}</div>
        <div class="inst"><h1>${escapeHtml(instName)}</h1><div class="meta">${metaLine || "Document généré par Mon Cahier"}</div></div>
      </div>
      <div class="title-zone">
        <div class="kicker">${escapeHtml(docTitle)}</div>
        <h2>Rapport de synthèse des résultats, absences et évaluations publiées</h2>
        <p>${escapeHtml(periodText)} • Année scolaire ${escapeHtml(data.academic_year)}</p>
      </div>
      <div class="cover-grid">
        <div class="cover-card"><span>Classes analysées</span><strong>${escapeHtml(formatInt(data.meta?.classes_count))}</strong></div>
        <div class="cover-card"><span>Élèves classés</span><strong>${escapeHtml(formatInt(data.meta?.classed_students_count))}</strong></div>
        <div class="cover-card"><span>Évaluations publiées</span><strong>${escapeHtml(formatInt(data.meta?.total_published_evaluations))}</strong></div>
        <div class="cover-card"><span>Généré le</span><strong>${escapeHtml(generatedAtLabel(data.meta?.generated_at))}</strong></div>
      </div>
    </div>
    ${footer}
  </section>

  <section class="page">
    <div class="block"><h2>1. Les trois premiers de chaque classe</h2>${topByClass || `<p class="empty-text">Aucune donnée exploitable.</p>`}</div>
    ${footer}
  </section>

  <section class="page">
    ${renderGroupedStudents("2. Les trois premiers de chaque niveau", data.top_by_level)}
    ${renderGroupedStudents("3. Les trois premiers de chaque cycle", data.top_by_cycle)}
    <section class="block"><h2>4. Les trois meilleurs de l’école</h2><table><thead><tr><th>Rang</th><th>Matricule</th><th>Nom et prénoms</th><th>Classe</th><th>Moyenne</th></tr></thead><tbody>${renderStudentRows(data.top_school)}</tbody></table></section>
    ${footer}
  </section>

  <section class="page">
    <div class="two-cols">
      ${renderGroupedStudents("5. Les trois meilleurs scientifiques par niveau", data.top_scientific_by_level, "moyenne_scientifique")}
      ${renderGroupedStudents("6. Les trois meilleurs littéraires par niveau", data.top_literary_by_level, "moyenne_litteraire")}
    </div>
    ${footer}
  </section>

  <section class="page">
    <section class="block"><h2>7. Classement des classes par moyenne générale de classe</h2><table><thead><tr><th>Rang</th><th>Classe</th><th>Niveau</th><th>Effectif</th><th>Classés</th><th>Moyenne classe</th></tr></thead><tbody>${classMeritRows}</tbody></table></section>
    <section class="block"><h2>8. Classement des classes par mérite d’assiduité</h2><table><thead><tr><th>Rang</th><th>Classe</th><th>Niveau</th><th>Absences</th><th>Minutes</th><th>Moyenne classe</th></tr></thead><tbody>${absenceRows}</tbody></table></section>
    ${footer}
  </section>

  <section class="page">
    <section class="block"><h2>9. Enseignants ayant le plus d’évaluations publiées</h2><table><thead><tr><th>Rang</th><th>Enseignant</th><th>Évaluations publiées</th></tr></thead><tbody>${teacherRows}</tbody></table></section>
    <section class="block"><h2>10. Classes ayant le plus d’évaluations publiées</h2><table><thead><tr><th>Rang</th><th>Classe</th><th>Niveau</th><th>Évaluations publiées</th></tr></thead><tbody>${classEvalRows}</tbody></table></section>
    ${footer}
  </section>
</body>
</html>`;
}

function printHtmlDocument(html: string, onError: (message: string) => void) {
  if (typeof document === "undefined") return;

  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", "Impression du bilan");
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

export default function BilanTrimestrielAnnuelPage() {
  const [data, setData] = useState<ReportData | null>(null);
  const [academicYear, setAcademicYear] = useState("");
  const [selectedPeriodId, setSelectedPeriodId] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [classes, setClasses] = useState<EducationScopedClass[]>([]);
  const [educationScope, setEducationScope] =
    useState<EducationScopeValue>(DEFAULT_EDUCATION_SCOPE);

  const periods = data?.periods || [];
  const selectedPeriod = useMemo(
    () =>
      selectedPeriodId === ANNUAL_SELECTOR_VALUE
        ? periods[periods.length - 1] || data?.selected_period || null
        : periods.find((p) => p.id === selectedPeriodId) || data?.selected_period || null,
    [periods, selectedPeriodId, data?.selected_period],
  );

  async function loadReport(nextYear = academicYear, nextPeriodId = selectedPeriodId) {
    setLoading(true);
    setErrorMsg(null);

    try {
      const params = buildEducationScopeSearchParams(educationScope, {
        includeClass: false,
      });
      const annualMode = nextPeriodId === ANNUAL_SELECTOR_VALUE;
      const periodIdForRequest = annualMode
        ? periods[periods.length - 1]?.id || data?.selected_period?.id || ""
        : nextPeriodId;

      if (nextYear) params.set("academic_year", nextYear);
      if (periodIdForRequest) params.set("period_id", periodIdForRequest);
      if (annualMode) params.set("report_mode", "annual");

      const res = await fetch(`/api/admin/notes/bilan${params.toString() ? `?${params.toString()}` : ""}`, {
        cache: "no-store",
      });

      const json = (await res.json().catch(() => null)) as ReportData | null;
      if (!res.ok || !json?.ok) throw new Error((json as any)?.error || `Erreur ${res.status}`);

      setData(json);
      setAcademicYear(json.academic_year || nextYear || "");
      setSelectedPeriodId(json.mode === "annual" ? ANNUAL_SELECTOR_VALUE : json.selected_period?.id || nextPeriodId || "");
    } catch (e: any) {
      setErrorMsg(e?.message || "Impossible de charger le bilan.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    void fetch("/api/admin/classes?education_type=all&limit=5000", {
      cache: "no-store",
    })
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        setClasses(
          Array.isArray(json?.items)
            ? (json.items as EducationScopedClass[])
            : [],
        );
      })
      .catch(() => {
        if (!cancelled) setClasses([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void loadReport("", "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function changeEducationScope(nextScope: EducationScopeValue) {
    setEducationScope(nextScope);
    setData(null);
    setErrorMsg(null);
  }

  function printReport() {
    if (!data) return;
    setErrorMsg(null);
    const html = buildReportHtml({ ...data, selected_period: selectedPeriod ?? data.selected_period ?? null });
    printHtmlDocument(html, setErrorMsg);
  }

  const topClasses = data?.top_by_class || [];

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-5 text-slate-900 md:px-6">
      <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm md:p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-start gap-4">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
              <FileText className="h-6 w-6" />
            </div>
            <div>
              <div className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Correspondant fichier</div>
              <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950 md:text-3xl">Bilan trimestriel / annuel</h1>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
                Rapport multi-pages basé sur les bulletins publiés : meilleurs élèves, mérite des classes, absences et évaluations publiées.
              </p>
            </div>
          </div>

          <div className="grid w-full gap-3 rounded-3xl border border-slate-200 bg-slate-50 p-3 md:grid-cols-[150px_minmax(230px,1fr)_auto] xl:max-w-3xl">
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Année</label>
              <input
                value={academicYear}
                onChange={(e) => setAcademicYear(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 shadow-sm outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/20"
                placeholder="2025-2026"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Période</label>
              <Select
                value={selectedPeriodId}
                onChange={(e) => setSelectedPeriodId(e.target.value)}
                disabled={!periods.length}
              >
                {periods.length ? (
                  <>
                    {periods.map((p) => (
                      <option key={p.id} value={p.id}>
                        {periodLabel(p)} — {formatDateFr(p.start_date)} au {formatDateFr(p.end_date)}
                      </option>
                    ))}
                    <option value={ANNUAL_SELECTOR_VALUE}>Annuel — {academicYear || data?.academic_year || "année scolaire"}</option>
                  </>
                ) : (
                  <option value="">Aucune période</option>
                )}
              </Select>
            </div>
            <div className="flex items-end gap-2">
              <Button onClick={() => loadReport()} disabled={loading} className="min-w-[112px]">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Charger
              </Button>
              <Button tone="amber" onClick={printReport} disabled={!data || loading} className="min-w-[132px]">
                <Printer className="h-4 w-4" /> Générer PDF
              </Button>
            </div>
          </div>
        </div>
      </section>

      <EducationScopeFilter
        value={educationScope}
        onChange={changeEducationScope}
        classes={classes}
        showClass={false}
        title="Contexte du bilan"
        className="mt-4"
      />

      {errorMsg && (
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {errorMsg}
        </div>
      )}

      <section className="mt-5 grid gap-4 md:grid-cols-4">
        <StatCard label="Mode" value={data?.mode === "annual" ? "Annuel" : "Trimestriel"} icon={<CalendarDays className="h-5 w-5" />} />
        <StatCard label="Classes" value={formatInt(data?.meta?.classes_count)} icon={<School className="h-5 w-5" />} />
        <StatCard label="Élèves classés" value={formatInt(data?.meta?.classed_students_count)} icon={<Trophy className="h-5 w-5" />} />
        <StatCard label="Évaluations publiées" value={formatInt(data?.meta?.total_published_evaluations)} icon={<BarChart3 className="h-5 w-5" />} />
      </section>

      <section className="mt-5 grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm ring-1 ring-slate-100">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-black text-slate-950">Les 3 premiers de chaque classe</h2>
              <p className="text-sm text-slate-500">
                {reportLabel(data, selectedPeriod)}
              </p>
            </div>
          </div>

          <div className="space-y-5">
            {topClasses.length ? (
              topClasses.map((group) => (
                <div key={group.class_id} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="font-black text-slate-900">{group.class_label}</h3>
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-500 ring-1 ring-slate-200">
                      {group.level}
                    </span>
                  </div>
                  <StudentMiniTable items={group.items} />
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">
                Aucun classement disponible pour cette période.
              </div>
            )}
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-black text-slate-950">Top 3 école</h2>
            <div className="mt-4">
              <StudentMiniTable items={data?.top_school || []} />
            </div>
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-black text-slate-950">Mérite des classes</h2>
            <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr><th className="px-3 py-2">Rang</th><th className="px-3 py-2">Classe</th><th className="px-3 py-2 text-right">Moyenne</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(data?.class_merit || []).slice(0, 10).map((row, idx) => (
                    <tr key={row.class_id}>
                      <td className="px-3 py-2 font-black">{idx + 1}</td>
                      <td className="px-3 py-2 font-bold">{row.class_label}</td>
                      <td className="px-3 py-2 text-right font-black text-emerald-700">{formatAvg(row.moyenne_classe)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
