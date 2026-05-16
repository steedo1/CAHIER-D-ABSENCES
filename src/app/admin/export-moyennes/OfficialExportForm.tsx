"use client";

import { FormEvent, useState } from "react";
import { Download, Loader2 } from "lucide-react";

type SelectOption = {
  value: string;
  label: string;
};

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
  academicYears,
  defaultAcademicYear,
  classes,
  hasAcademicYears,
  hasClasses,
  disabled = false,
  color = "emerald",
  className = "grid gap-3",
}: {
  fields: Record<string, string>;
  academicYears: string[];
  defaultAcademicYear: string;
  classes: SelectOption[];
  hasAcademicYears: boolean;
  hasClasses: boolean;
  disabled?: boolean;
  color?: ExportColor;
  className?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isDisabled = disabled || loading || !hasAcademicYears;

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
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      <select
        name="academic_year"
        required
        disabled={loading || !hasAcademicYears}
        className={`w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none transition focus:ring-4 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 ${selectColorClass[color]}`}
        defaultValue={defaultAcademicYear}
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
        disabled={loading}
        className={`w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none transition focus:ring-4 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 ${selectColorClass[color]}`}
        defaultValue=""
      >
        <option value="">{hasClasses ? "Toutes les classes" : "Aucune classe disponible"}</option>
        {classes.map((cls) => (
          <option key={`${fields.export_kind || "export"}-class-${cls.value}`} value={cls.value}>
            {cls.label}
          </option>
        ))}
      </select>

      <button
        type="submit"
        disabled={isDisabled}
        className={`inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-black text-white shadow-sm transition disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 ${buttonColorClass[color]}`}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        {loading ? "Préparation du fichier…" : "Télécharger Excel officiel"}
      </button>

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
          {error}
        </div>
      )}
    </form>
  );
}
