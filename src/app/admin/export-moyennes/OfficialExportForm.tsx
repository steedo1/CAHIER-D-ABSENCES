"use client";

import { FormEvent, useState } from "react";
import { Download, FileSpreadsheet, Loader2 } from "lucide-react";

type SelectOption = {
  value: string;
  label: string;
  academicYear: string;
};

type DiagnosticIssue = {
  className: string;
  studentName: string;
  matricule: string;
  code: string;
  detail: string;
  severity: "blocking";
};

type DiagnosticReport = {
  ok: true;
  academicYear: string;
  scope: string;
  classes: number;
  enrollments: number;
  girls: number;
  boys: number;
  unknown: number;
  blockingCount: number;
  byCode: Record<string, number>;
  issues: DiagnosticIssue[];
  alerts: string[];
  generatedAt: string;
};

function excelSafe(value: string): string {
  // Empêcher l'interprétation de noms/matricules comme formules Excel.
  return /^[=+@\-\t\r]/.test(value) ? "'" + value : value;
}

function csvCell(value: unknown): string {
  const safe = excelSafe(String(value ?? ""));
  return '"' + safe.replace(/"/g, '""') + '"';
}

function downloadDiagnosticCsv(report: DiagnosticReport) {
  const headers = ["Année scolaire", "Classe", "Nom et prénoms", "Matricule national", "Anomalie", "Détail"];
  const rows = [
    headers,
    ...report.issues.map((i) => [report.academicYear, i.className, i.studentName, i.matricule, i.code, i.detail]),
  ];
  const content = "\uFEFF" + rows.map((row) => row.map(csvCell).join(";")).join("\r\n");
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "anomalies-desps-" + report.academicYear + ".csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 3000);
}

type ExportColor = "emerald" | "violet" | "amber";

const selectColorClass: Record<ExportColor, string> = {
  emerald: "focus:border-emerald-500 focus:ring-emerald-500/15",
  violet: "focus:border-violet-500 focus:ring-violet-500/15",
  amber: "focus:border-amber-500 focus:ring-amber-500/15",
};

const buttonColorClass: Record<ExportColor, string> = {
  emerald: "bg-emerald-600 hover:bg-emerald-700",
  violet: "bg-violet-600 hover:bg-violet-700",
  amber: "bg-amber-600 hover:bg-amber-700",
};

function filenameFromDisposition(value: string | null, fallback: string) {
  if (!value) return fallback;

  const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim().replace(/^"|"$/g, ""));
    } catch {
      return utf8Match[1].trim().replace(/^"|"$/g, "") || fallback;
    }
  }

  const match = value.match(/filename="?([^";]+)"?/i);
  return match?.[1]?.trim() || fallback;
}

function fallbackFileName(fields: Record<string, string>) {
  const kind = fields.export_kind || "export";
  const extension = fields.export_kind === "rapport_f_official" ? "xlsm" : "xlsx";
  return `${kind}.${extension}`;
}

export default function OfficialExportForm({
  fields,
  periodRefByYear,
  academicYears,
  defaultAcademicYear,
  classes,
  hasAcademicYears,
  disabled = false,
  color = "emerald",
  className = "grid gap-3",
}: {
  fields: Record<string, string>;
  periodRefByYear?: Record<string, string>;
  academicYears: string[];
  defaultAcademicYear: string;
  classes: SelectOption[];
  hasAcademicYears: boolean;
  disabled?: boolean;
  color?: ExportColor;
  className?: string;
}) {
  const [selectedAcademicYear, setSelectedAcademicYear] = useState(defaultAcademicYear);
  const [selectedClassId, setSelectedClassId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diagnosticLoading, setDiagnosticLoading] = useState(false);
  const [diagnosticError, setDiagnosticError] = useState<string | null>(null);
  const [diagnosticReport, setDiagnosticReport] = useState<DiagnosticReport | null>(null);
  const selectedPeriodRef = periodRefByYear?.[selectedAcademicYear] || "";
  const availableClasses = classes.filter((cls) => cls.academicYear === selectedAcademicYear);
  const isDisabled = disabled || loading || diagnosticLoading || !hasAcademicYears || !availableClasses.length ||
    (!!periodRefByYear && !selectedPeriodRef) || !!diagnosticReport?.blockingCount;

  function handleYearChange(year: string) {
    setSelectedAcademicYear(year);
    // Une classe de l'année précédente ne doit jamais rester sélectionnée.
    setSelectedClassId("");
    setError(null);
    setDiagnosticError(null);
    setDiagnosticReport(null);
  }

  async function handleDiagnostic() {
    if (diagnosticLoading || !selectedAcademicYear || !availableClasses.length) return;
    setDiagnosticLoading(true);
    setDiagnosticError(null);
    setDiagnosticReport(null);
    try {
      const params = new URLSearchParams({ academic_year: selectedAcademicYear });
      if (selectedClassId) params.set("class_id", selectedClassId);
      const response = await fetch("/api/admin/exports/averages/diagnostic?" + params.toString(), {
        method: "GET", credentials: "include", cache: "no-store",
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ok) {
        throw new Error(result?.error || "Diagnostic DESPS indisponible.");
      }
      setDiagnosticReport(result as DiagnosticReport);
    } catch (err) {
      setDiagnosticError(err instanceof Error ? err.message : "Diagnostic DESPS indisponible.");
    } finally {
      setDiagnosticLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isDisabled) return;

    const formData = new FormData(event.currentTarget);
    const params = new URLSearchParams();

    for (const [key, value] of formData.entries()) {
      params.set(key, String(value));
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/admin/exports/averages?${params.toString()}`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const message =
          typeof payload?.message === "string"
            ? payload.message
            : typeof payload?.error === "string"
              ? payload.error
              : "Le fichier n’a pas pu être préparé.";
        throw new Error(message);
      }

      const blob = await response.blob();
      const filename = filenameFromDisposition(
        response.headers.get("content-disposition"),
        fallbackFileName(fields),
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Téléchargement impossible.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className={className}>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={name === "period_ref" && periodRefByYear ? selectedPeriodRef : value} />
      ))}

      <select
        name="academic_year"
        required
        disabled={loading || diagnosticLoading || !hasAcademicYears}
        className={`w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none transition focus:ring-4 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 ${selectColorClass[color]}`}
        value={selectedAcademicYear}
        onChange={(event) => handleYearChange(event.target.value)}
      >
        {!hasAcademicYears ? (
          <option value="">Aucune année disponible</option>
        ) : (
          academicYears.map((year) => (
            <option key={`${fields.export_kind || "export"}-year-${year}`} value={year}>
              {year}
            </option>
          ))
        )}
      </select>

      <select
        name="class_id"
        value={selectedClassId}
        onChange={(event) => {
          setSelectedClassId(event.target.value);
          setDiagnosticReport(null);
          setDiagnosticError(null);
        }}
        disabled={loading || diagnosticLoading || !availableClasses.length}
        className={`w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none transition focus:ring-4 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 ${selectColorClass[color]}`}
      >
        <option value="">{availableClasses.length ? "Toutes les classes" : "Aucune classe pour cette année"}</option>
        {availableClasses.map((cls) => (
          <option key={`${fields.export_kind || "export"}-class-${cls.value}`} value={cls.value}>
            {cls.label}
          </option>
        ))}
      </select>

      <button
        type="button"
        disabled={loading || diagnosticLoading || !hasAcademicYears || !availableClasses.length}
        onClick={handleDiagnostic}
        className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-slate-100 px-5 py-3 text-sm font-extrabold text-slate-800 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {diagnosticLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
        {diagnosticLoading ? "Contrôle en cours…" : "Vérifier les inscriptions"}
      </button>

      <button
        type="submit"
        disabled={isDisabled}
        className={`inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-black text-white shadow-sm transition disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 ${buttonColorClass[color]}`}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        {loading ? "Préparation du fichier…" : "Télécharger Excel officiel"}
      </button>

      {hasAcademicYears && !availableClasses.length && (
        <p className="text-xs font-semibold text-amber-700">
          Aucune classe pour {selectedAcademicYear}. Le téléchargement est désactivé.
        </p>
      )}

      {periodRefByYear && !selectedPeriodRef && (
        <p className="text-xs font-semibold text-amber-700">
          Aucun trimestre correspondant à l'année scolaire sélectionnée. Téléchargement désactivé.
        </p>
      )}

      {diagnosticReport && (
        <section className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800" aria-live="polite">
          <p className="font-black text-sm">
            Diagnostic {diagnosticReport.academicYear} — {diagnosticReport.scope}
          </p>
          <p className="mt-1">
            {diagnosticReport.enrollments} inscriptions actives, {diagnosticReport.classes} classes,{" "}
            <strong className={diagnosticReport.blockingCount ? "text-rose-700" : "text-emerald-700"}>
              {diagnosticReport.blockingCount} anomalies bloquantes
            </strong>
          </p>
          <p className="mt-1">Sexes déclarés : {diagnosticReport.girls} F / {diagnosticReport.boys} M / {diagnosticReport.unknown} inconnus.</p>
          {diagnosticReport.alerts.map((alert, i) => (
            <p key={i} className="mt-2 font-semibold text-amber-800">{alert}</p>
          ))}
          {diagnosticReport.issues.length > 0 && (
            <>
              <ul className="mt-3 max-h-44 space-y-1 overflow-auto">
                {diagnosticReport.issues.slice(0, 15).map((item, i) => (
                  <li key={i} className="rounded-lg bg-white p-2">
                    <strong>{item.className}</strong> — {item.studentName} ({item.matricule || "sans matricule"}) : {item.detail}
                  </li>
                ))}
              </ul>
              {diagnosticReport.issues.length > 15 && (
                <p className="mt-1 text-slate-600">Les autres anomalies figurent dans le rapport CSV.</p>
              )}
              <button type="button" onClick={() => downloadDiagnosticCsv(diagnosticReport)}
                className="mt-3 rounded-xl bg-slate-800 px-3 py-2 font-bold text-white hover:bg-slate-900">
                Télécharger toutes les anomalies (CSV)
              </button>
            </>
          )}
          {!diagnosticReport.issues.length && (
            <p className="mt-2 font-semibold text-emerald-700">
              Aucun défaut d'identité détecté dans la sélection. Le rapprochement national reste obligatoire.
            </p>
          )}
        </section>
      )}

      {diagnosticError && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
          {diagnosticError}
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
          {error}
        </div>
      )}
    </form>
  );
}
