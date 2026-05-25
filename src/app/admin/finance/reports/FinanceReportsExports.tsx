"use client";

import { Download, FileSpreadsheet, FileText, Printer } from "lucide-react";

export type FinanceReportSummaryItem = {
  label: string;
  value: string;
  hint?: string;
};

export type FinanceReportCategoryItem = {
  name: string;
  count: number;
  expected: number;
  paid: number;
  due: number;
  rate: number;
};

export type FinanceReportExpenseCategoryItem = {
  name: string;
  count: number;
  total: number;
};

export type FinanceReportClassItem = {
  classLabel: string;
  level: string;
  academicYear: string;
  students: number;
  expected: number;
  paid: number;
  due: number;
  rate: number;
};

export type FinanceReportStudentItem = {
  matricule: string;
  fullName: string;
  classLabel: string;
  expected: number;
  paid: number;
  due: number;
  rate: number;
  status: string;
};

export type FinanceReportStatusItem = {
  label: string;
  count: number;
  amount: number;
};

export type FinanceReportPaymentGroupItem = {
  label: string;
  amount: number;
  count: number;
  studentCount: number;
};

export type FinanceReportCategorySubRubricItem = {
  category: string;
  subRubric: string;
  amount: number;
  count: number;
  studentCount: number;
};

export type FinanceReportCycleClassPaymentItem = {
  cycle: string;
  classLabel: string;
  amount: number;
  count: number;
  studentCount: number;
};

export type FinanceReportStudentDebtItem = {
  matricule: string;
  fullName: string;
  classLabel: string;
  expected: number;
  paid: number;
  due: number;
  status: string;
};

export type FinanceReportDebtDetailItem = {
  matricule: string;
  fullName: string;
  classLabel: string;
  level: string;
  category: string;
  subRubric: string;
  expected: number;
  paid: number;
  due: number;
  status: string;
  dueDate: string;
};

export type FinanceReportScheduleItem = {
  label: string;
  category: string;
  classLabel: string;
  dueDate: string;
  amount: number;
  active: string;
};

export type FinanceReportMonthItem = {
  month: string;
  receipts: number;
  expenses: number;
  balance: number;
};

export type FinanceReportMovementItem = {
  date: string;
  label: string;
  category: string;
  amount: number;
};

export type FinanceReportExportPayload = {
  title: string;
  institutionName: string;
  academicYear: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  summary: FinanceReportSummaryItem[];
  categories: FinanceReportCategoryItem[];
  expenseCategories: FinanceReportExpenseCategoryItem[];
  classes: FinanceReportClassItem[];
  statuses: FinanceReportStatusItem[];
  students: FinanceReportStudentItem[];
  paymentByAffectation: FinanceReportPaymentGroupItem[];
  paymentByBoarding: FinanceReportPaymentGroupItem[];
  paymentByCategorySubRubric: FinanceReportCategorySubRubricItem[];
  paymentByLevel: FinanceReportPaymentGroupItem[];
  paymentByCycleClass: FinanceReportCycleClassPaymentItem[];
  studentDebtsByClass: FinanceReportStudentDebtItem[];
  debtDetails: FinanceReportDebtDetailItem[];
  schedules: FinanceReportScheduleItem[];
  months: FinanceReportMonthItem[];
  receipts: FinanceReportMovementItem[];
  expenses: FinanceReportMovementItem[];
};

type ExportScope = "global" | "detailed";
type ExportMode = "excel" | "pdf";

function formatMoney(value: number) {
  return `${Number(value || 0).toLocaleString("fr-FR")} F CFA`;
}

function formatPercent(value: number) {
  return `${Number(value || 0).toLocaleString("fr-FR", {
    maximumFractionDigits: 1,
  })} %`;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function makeFileName(
  payload: FinanceReportExportPayload,
  extension: string,
  scope: ExportScope,
) {
  const safeInstitution = (payload.institutionName || "etablissement")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  const safeYear = (payload.academicYear || "annee")
    .replace(/[^a-zA-Z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const safePeriod = `${payload.periodStart || "debut"}-${payload.periodEnd || "fin"}`
    .replace(/[^a-zA-Z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `rapport-financier-${scope}-${safeInstitution || "etablissement"}-${safeYear || "annee"}-${safePeriod || "periode"}.${extension}`;
}

function buildTable<T>(
  title: string,
  headers: string[],
  rows: T[],
  render: (row: T) => Array<string | number>,
) {
  const body = rows.length
    ? rows
        .map((row) => {
          const cells = render(row)
            .map((cell) => `<td>${escapeHtml(cell)}</td>`)
            .join("");
          return `<tr>${cells}</tr>`;
        })
        .join("")
    : `<tr><td colspan="${headers.length}">Aucune donnée disponible</td></tr>`;

  return `
    <section class="report-section">
      <h2>${escapeHtml(title)}</h2>
      <table>
        <thead>
          <tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </section>
  `;
}

function buildReportHtml(
  payload: FinanceReportExportPayload,
  mode: ExportMode,
  scope: ExportScope,
) {
  const generatedDate = new Date(payload.generatedAt).toLocaleString("fr-FR");
  const scopeLabel = scope === "global" ? "Statistiques globales" : "Statistiques détaillées";
  const isDetailed = scope === "detailed";
  const css = `
    html, body { background: #ffffff; }
    body { font-family: Arial, sans-serif; color: #0f172a; margin: ${mode === "pdf" ? "24px" : "16px"}; }
    .header { border: 1px solid #cbd5e1; border-radius: 18px; padding: 18px; margin-bottom: 18px; background: #f8fafc; }
    .eyebrow { font-size: 11px; letter-spacing: .18em; text-transform: uppercase; color: #047857; font-weight: 700; }
    h1 { margin: 8px 0 6px; font-size: 24px; }
    h2 { margin: 22px 0 8px; font-size: 16px; color: #0f172a; }
    .meta { color: #475569; font-size: 12px; line-height: 1.55; }
    .summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 14px 0 18px; }
    .card { border: 1px solid #cbd5e1; border-radius: 14px; padding: 10px; background: white; }
    .card-label { font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: #64748b; font-weight: 700; }
    .card-value { font-size: 17px; margin-top: 5px; font-weight: 800; }
    .card-hint { font-size: 11px; margin-top: 3px; color: #64748b; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 12px; }
    th { background: #e2e8f0; text-align: left; font-weight: 800; }
    th, td { border: 1px solid #cbd5e1; padding: 7px; vertical-align: top; }
    .footer { margin-top: 24px; border-top: 1px solid #cbd5e1; padding-top: 10px; text-align: center; font-size: 11px; color: #475569; }
    .report-section { break-inside: avoid; page-break-inside: avoid; }
    @media print {
      @page { size: A4 landscape; margin: 12mm; }
      html, body { background: white !important; }
      body { margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .summary { grid-template-columns: repeat(4, minmax(0, 1fr)); }
      h2 { break-after: avoid; page-break-after: avoid; }
      table { page-break-inside: auto; }
      tr { page-break-inside: avoid; page-break-after: auto; }
    }
  `;

  const summaryCards = payload.summary
    .map(
      (item) => `
        <div class="card">
          <div class="card-label">${escapeHtml(item.label)}</div>
          <div class="card-value">${escapeHtml(item.value)}</div>
          ${item.hint ? `<div class="card-hint">${escapeHtml(item.hint)}</div>` : ""}
        </div>
      `,
    )
    .join("");

  const globalSections = `
    ${buildTable(
      "Montant encaissé : affectés / non affectés",
      ["Statut", "Montant encaissé", "Lignes", "Élèves"],
      payload.paymentByAffectation,
      (row) => [row.label, formatMoney(row.amount), row.count, row.studentCount],
    )}

    ${buildTable(
      "Montant encaissé : internes / non internes",
      ["Statut", "Montant encaissé", "Lignes", "Élèves"],
      payload.paymentByBoarding,
      (row) => [row.label, formatMoney(row.amount), row.count, row.studentCount],
    )}

    ${buildTable(
      "Montant encaissé par catégorie et sous-rubrique",
      ["Catégorie", "Sous-rubrique", "Montant encaissé", "Lignes", "Élèves"],
      payload.paymentByCategorySubRubric,
      (row) => [row.category, row.subRubric, formatMoney(row.amount), row.count, row.studentCount],
    )}

    ${buildTable(
      "Montant encaissé par niveau",
      ["Niveau", "Montant encaissé", "Lignes", "Élèves"],
      payload.paymentByLevel,
      (row) => [row.label, formatMoney(row.amount), row.count, row.studentCount],
    )}

    ${buildTable(
      "Montant encaissé par classe et par cycle",
      ["Cycle", "Classe", "Montant encaissé", "Lignes", "Élèves"],
      payload.paymentByCycleClass,
      (row) => [row.cycle, row.classLabel, formatMoney(row.amount), row.count, row.studentCount],
    )}

    ${buildTable(
      "Recouvrement par catégorie de frais",
      ["Catégorie", "Écritures", "Attendu", "Encaissé", "Reste", "Taux"],
      payload.categories,
      (row) => [
        row.name,
        row.count,
        formatMoney(row.expected),
        formatMoney(row.paid),
        formatMoney(row.due),
        formatPercent(row.rate),
      ],
    )}

    ${buildTable(
      "Recouvrement par classe",
      ["Classe", "Niveau", "Année", "Élèves", "Attendu", "Encaissé", "Reste", "Taux"],
      payload.classes,
      (row) => [
        row.classLabel,
        row.level,
        row.academicYear,
        row.students,
        formatMoney(row.expected),
        formatMoney(row.paid),
        formatMoney(row.due),
        formatPercent(row.rate),
      ],
    )}

    ${buildTable(
      "Flux mensuels",
      ["Mois", "Encaissements", "Dépenses", "Solde"],
      payload.months,
      (row) => [row.month, formatMoney(row.receipts), formatMoney(row.expenses), formatMoney(row.balance)],
    )}

    ${buildTable(
      "Dépenses par catégorie",
      ["Catégorie", "Nombre", "Total"],
      payload.expenseCategories,
      (row) => [row.name, row.count, formatMoney(row.total)],
    )}
  `;

  const detailedSections = `
    ${buildTable(
      "Situation des créances par statut",
      ["Statut", "Nombre", "Montant concerné"],
      payload.statuses,
      (row) => [row.label, row.count, formatMoney(row.amount)],
    )}

    ${buildTable(
      "Liste des élèves et leurs dettes par classe",
      ["Matricule", "Élève", "Classe", "Attendu", "Encaissé", "Dette", "Statut"],
      payload.studentDebtsByClass,
      (row) => [
        row.matricule,
        row.fullName,
        row.classLabel,
        formatMoney(row.expected),
        formatMoney(row.paid),
        formatMoney(row.due),
        row.status,
      ],
    )}

    ${buildTable(
      "Liste des dettes par élève, catégorie et classe",
      ["Classe", "Matricule", "Élève", "Catégorie", "Sous-rubrique", "Attendu", "Encaissé", "Dette", "Échéance", "Statut"],
      payload.debtDetails,
      (row) => [
        row.classLabel,
        row.matricule,
        row.fullName,
        row.category,
        row.subRubric,
        formatMoney(row.expected),
        formatMoney(row.paid),
        formatMoney(row.due),
        row.dueDate,
        row.status,
      ],
    )}

    ${buildTable(
      "Détail global par élève",
      ["Matricule", "Élève", "Classe", "Attendu", "Encaissé", "Reste", "Taux", "Statut"],
      payload.students,
      (row) => [
        row.matricule,
        row.fullName,
        row.classLabel,
        formatMoney(row.expected),
        formatMoney(row.paid),
        formatMoney(row.due),
        formatPercent(row.rate),
        row.status,
      ],
    )}

    ${buildTable(
      "Barèmes configurés",
      ["Libellé", "Catégorie", "Classe", "Échéance", "Montant", "Statut"],
      payload.schedules,
      (row) => [row.label, row.category, row.classLabel, row.dueDate, formatMoney(row.amount), row.active],
    )}

    ${buildTable(
      "Encaissements validés sur la période",
      ["Date", "Reçu / payeur", "Référence", "Montant"],
      payload.receipts,
      (row) => [row.date, row.label, row.category, formatMoney(row.amount)],
    )}

    ${buildTable(
      "Dépenses validées sur la période",
      ["Date", "Libellé", "Catégorie / bénéficiaire", "Montant"],
      payload.expenses,
      (row) => [row.date, row.label, row.category, formatMoney(row.amount)],
    )}
  `;

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(payload.title)} — ${escapeHtml(scopeLabel)}</title>
  <style>${css}</style>
</head>
<body>
  <div class="header">
    <div class="eyebrow">Mon Cahier — Rapport financier</div>
    <h1>${escapeHtml(payload.title)} — ${escapeHtml(scopeLabel)}</h1>
    <div class="meta">
      Établissement : <strong>${escapeHtml(payload.institutionName)}</strong><br />
      Année scolaire : <strong>${escapeHtml(payload.academicYear)}</strong><br />
      Période : <strong>${escapeHtml(payload.periodLabel)}</strong><br />
      Généré le : ${escapeHtml(generatedDate)}
    </div>
  </div>

  <div class="summary">${summaryCards}</div>

  ${globalSections}
  ${isDetailed ? detailedSections : ""}

  <div class="footer">
    www.mon-cahier.com — La plateforme idéale pour une école connectée, l’école du futur.
  </div>
</body>
</html>`;
}

function downloadExcelFile(payload: FinanceReportExportPayload, scope: ExportScope) {
  const html = buildReportHtml(payload, "excel", scope);
  const blob = new Blob(["\ufeff", html], {
    type: "application/vnd.ms-excel;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = makeFileName(payload, "xls", scope);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 500);
}

function printPdf(payload: FinanceReportExportPayload, scope: ExportScope) {
  const html = buildReportHtml(payload, "pdf", scope);
  const iframe = document.createElement("iframe");

  iframe.setAttribute("title", "Impression du rapport financier");
  iframe.style.position = "fixed";
  iframe.style.left = "-10000px";
  iframe.style.top = "0";
  iframe.style.width = "1123px";
  iframe.style.height = "794px";
  iframe.style.border = "0";
  iframe.style.opacity = "0";
  iframe.style.pointerEvents = "none";

  let printed = false;
  const cleanup = () => {
    window.setTimeout(() => {
      iframe.remove();
    }, 1500);
  };

  iframe.onload = () => {
    if (printed) return;
    printed = true;
    window.setTimeout(() => {
      const printWindow = iframe.contentWindow;
      if (!printWindow) {
        window.alert("Impossible de préparer l’impression du rapport. Réessayez avec un autre navigateur.");
        cleanup();
        return;
      }

      printWindow.focus();
      printWindow.print();
      cleanup();
    }, 450);
  };

  document.body.appendChild(iframe);
  iframe.srcdoc = html;
}

export default function FinanceReportsExports({
  payload,
}: {
  payload: FinanceReportExportPayload;
}) {
  return (
    <div className="rounded-[28px] border border-emerald-200 bg-emerald-50/70 p-4 shadow-sm print:hidden">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-black uppercase tracking-[0.16em] text-emerald-800 ring-1 ring-emerald-200">
            <Download className="h-3.5 w-3.5" />
            Exports du rapport
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-emerald-900/80">
            Choisissez un export global pour la direction, ou un export détaillé avec encaissements
            par statut, internat, catégorie, niveau, classe et dettes par élève.
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 xl:min-w-[560px]">
          <button
            type="button"
            onClick={() => downloadExcelFile(payload, "global")}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-black text-emerald-800 shadow-sm ring-1 ring-emerald-200 hover:bg-emerald-50"
          >
            <FileSpreadsheet className="h-4 w-4" />
            Excel global
          </button>
          <button
            type="button"
            onClick={() => downloadExcelFile(payload, "detailed")}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-black text-emerald-800 shadow-sm ring-1 ring-emerald-200 hover:bg-emerald-50"
          >
            <FileText className="h-4 w-4" />
            Excel détaillé
          </button>
          <button
            type="button"
            onClick={() => printPdf(payload, "global")}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-black text-white shadow-sm hover:bg-emerald-800"
          >
            <Printer className="h-4 w-4" />
            PDF global
          </button>
          <button
            type="button"
            onClick={() => printPdf(payload, "detailed")}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-black text-white shadow-sm hover:bg-slate-800"
          >
            <Printer className="h-4 w-4" />
            PDF détaillé
          </button>
        </div>
      </div>
    </div>
  );
}
