"use client";

import { Download, FileSpreadsheet, Printer } from "lucide-react";

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
  generatedAt: string;
  summary: FinanceReportSummaryItem[];
  categories: FinanceReportCategoryItem[];
  expenseCategories: FinanceReportExpenseCategoryItem[];
  classes: FinanceReportClassItem[];
  months: FinanceReportMonthItem[];
  receipts: FinanceReportMovementItem[];
  expenses: FinanceReportMovementItem[];
};

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

function makeFileName(payload: FinanceReportExportPayload, extension: string) {
  const safeInstitution = (payload.institutionName || "etablissement")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  const safeYear = (payload.academicYear || "annee")
    .replace(/[^a-zA-Z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `rapport-financier-${safeInstitution || "etablissement"}-${safeYear || "annee"}.${extension}`;
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
    <h2>${escapeHtml(title)}</h2>
    <table>
      <thead>
        <tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

function buildReportHtml(payload: FinanceReportExportPayload, mode: "excel" | "pdf") {
  const generatedDate = new Date(payload.generatedAt).toLocaleString("fr-FR");
  const css = `
    body { font-family: Arial, sans-serif; color: #0f172a; margin: ${mode === "pdf" ? "24px" : "16px"}; }
    .header { border: 1px solid #cbd5e1; border-radius: 18px; padding: 18px; margin-bottom: 18px; background: #f8fafc; }
    .eyebrow { font-size: 11px; letter-spacing: .18em; text-transform: uppercase; color: #047857; font-weight: 700; }
    h1 { margin: 8px 0 6px; font-size: 24px; }
    h2 { margin: 22px 0 8px; font-size: 16px; color: #0f172a; }
    .meta { color: #475569; font-size: 12px; line-height: 1.5; }
    .summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 14px 0 18px; }
    .card { border: 1px solid #cbd5e1; border-radius: 14px; padding: 10px; background: white; }
    .card-label { font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: #64748b; font-weight: 700; }
    .card-value { font-size: 17px; margin-top: 5px; font-weight: 800; }
    .card-hint { font-size: 11px; margin-top: 3px; color: #64748b; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 12px; }
    th { background: #e2e8f0; text-align: left; font-weight: 800; }
    th, td { border: 1px solid #cbd5e1; padding: 7px; vertical-align: top; }
    tfoot td { font-weight: 800; }
    .footer { margin-top: 24px; border-top: 1px solid #cbd5e1; padding-top: 10px; text-align: center; font-size: 11px; color: #475569; }
    @media print {
      @page { size: A4 landscape; margin: 12mm; }
      body { margin: 0; }
      .no-print { display: none !important; }
      .summary { grid-template-columns: repeat(4, minmax(0, 1fr)); }
      h2 { break-after: avoid; }
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

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(payload.title)}</title>
  <style>${css}</style>
</head>
<body>
  <div class="header">
    <div class="eyebrow">Mon Cahier — Rapport financier</div>
    <h1>${escapeHtml(payload.title)}</h1>
    <div class="meta">
      Établissement : <strong>${escapeHtml(payload.institutionName)}</strong><br />
      Année scolaire : <strong>${escapeHtml(payload.academicYear)}</strong><br />
      Généré le : ${escapeHtml(generatedDate)}
    </div>
  </div>

  <div class="summary">${summaryCards}</div>

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

  ${buildTable(
    "Derniers encaissements",
    ["Date", "Reçu / payeur", "Référence", "Montant"],
    payload.receipts,
    (row) => [row.date, row.label, row.category, formatMoney(row.amount)],
  )}

  ${buildTable(
    "Dernières dépenses",
    ["Date", "Libellé", "Catégorie / bénéficiaire", "Montant"],
    payload.expenses,
    (row) => [row.date, row.label, row.category, formatMoney(row.amount)],
  )}

  <div class="footer">
    www.mon-cahier.com — La plateforme idéale pour une école connectée, l’école du futur.
  </div>
</body>
</html>`;
}

function downloadHtmlFile(payload: FinanceReportExportPayload) {
  const html = buildReportHtml(payload, "excel");
  const blob = new Blob(["\ufeff", html], {
    type: "application/vnd.ms-excel;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = makeFileName(payload, "xls");
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function printPdf(payload: FinanceReportExportPayload) {
  const reportWindow = window.open("", "_blank", "noopener,noreferrer");
  if (!reportWindow) {
    window.alert("Le navigateur a bloqué la fenêtre d’impression. Autorisez les pop-ups puis réessayez.");
    return;
  }

  reportWindow.document.open();
  reportWindow.document.write(buildReportHtml(payload, "pdf"));
  reportWindow.document.close();
  reportWindow.focus();

  window.setTimeout(() => {
    reportWindow.print();
  }, 350);
}

export default function FinanceReportsExports({
  payload,
}: {
  payload: FinanceReportExportPayload;
}) {
  return (
    <div className="rounded-[28px] border border-emerald-200 bg-emerald-50/70 p-4 shadow-sm print:hidden">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-sm font-black uppercase tracking-[0.16em] text-emerald-800">
            Exports du rapport
          </div>
          <p className="mt-1 text-sm text-emerald-900/80">
            Exportez les statistiques enrichies en fichier Excel ou imprimez le rapport au format PDF.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => downloadHtmlFile(payload)}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-black text-emerald-800 shadow-sm ring-1 ring-emerald-200 hover:bg-emerald-50"
          >
            <FileSpreadsheet className="h-4 w-4" />
            Export Excel
          </button>
          <button
            type="button"
            onClick={() => printPdf(payload)}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-black text-white shadow-sm hover:bg-emerald-800"
          >
            <Printer className="h-4 w-4" />
            Export PDF
          </button>
          <div className="hidden items-center gap-2 rounded-2xl border border-emerald-200 bg-white/70 px-3 py-2 text-xs font-bold text-emerald-800 xl:flex">
            <Download className="h-4 w-4" />
            Rapport complet
          </div>
        </div>
      </div>
    </div>
  );
}
