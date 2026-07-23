"use client";

import {
  EDUCATION_TYPE_OPTIONS,
  type EducationType,
} from "@/lib/education-organization";

export type EducationSettingsScope = "common" | EducationType;

export default function EducationScopeSwitcher({
  value,
  onChange,
  enabledEducationTypes,
  label = "Enseignement concerné",
  includeCommon = true,
}: {
  value: EducationSettingsScope;
  onChange: (value: EducationSettingsScope) => void;
  enabledEducationTypes: EducationType[];
  label?: string;
  includeCommon?: boolean;
}) {
  const options = EDUCATION_TYPE_OPTIONS.filter((option) =>
    enabledEducationTypes.includes(option.id),
  );

  return (
    <div className="mb-5 rounded-2xl border border-slate-200 bg-slate-50/80 p-3 sm:p-4">
      <div className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-slate-500">
        {label}
      </div>
      <div className="flex flex-wrap gap-2">
        {includeCommon ? (
          <button
            type="button"
            onClick={() => onChange("common")}
            className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
              value === "common"
                ? "border-sky-500 bg-sky-50 text-sky-800 ring-2 ring-sky-100"
                : "border-slate-200 bg-white text-slate-700 hover:border-sky-300"
            }`}
          >
            Commun à tous
          </button>
        ) : null}
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
              value === option.id
                ? "border-sky-500 bg-sky-50 text-sky-800 ring-2 ring-sky-100"
                : "border-slate-200 bg-white text-slate-700 hover:border-sky-300"
            }`}
          >
            {option.shortLabel}
          </button>
        ))}
      </div>
    </div>
  );
}
