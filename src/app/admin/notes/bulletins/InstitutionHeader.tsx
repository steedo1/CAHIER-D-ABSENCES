// src/app/admin/notes/bulletins/InstitutionHeader.tsx
"use client";

import React from "react";

export type InstitutionSettings = {
  institution_name: string;
  institution_logo_url: string;
  institution_phone: string;
  institution_email: string;
  institution_region: string;
  institution_postal_address: string;
  institution_status: string;
  institution_head_name: string;
  institution_head_title: string;
};

type Props = {
  settings: InstitutionSettings;
  academicYearLabel: string;   // ex: "2024-2025"
  periodLabel: string;         // ex: "1er Trimestre" / "1st Term"
};

export function InstitutionHeader({ settings, academicYearLabel, periodLabel }: Props) {
  const s = settings;

  return (
    <header className="flex items-start justify-between gap-4 border-b pb-2 text-[11px] leading-tight">
      {/* Bloc gauche : autorité / région / statut */}
      <div className="flex-1">
        {s.institution_region && (
          <div className="uppercase tracking-[0.08em] text-[10px] text-slate-700">
            {s.institution_region}
          </div>
        )}
        {s.institution_status && (
          <div className="mt-1 text-[10px] text-slate-600">
            {s.institution_status}
          </div>
        )}
      </div>

      {/* Bloc centre : titre du bulletin */}
      <div className="flex flex-col items-center flex-[1.6]">
        <div className="text-[9px] uppercase tracking-[0.18em] text-slate-600">
          {/* à traduire plus tard via i18n */}
          BULLETIN DE NOTES
        </div>
        <div className="mt-0.5 text-xs font-semibold uppercase tracking-[0.12em] text-slate-900">
          {periodLabel}
        </div>
        <div className="mt-0.5 text-[10px] text-slate-600">
          {/* ex : "Année scolaire 2024-2025 / School year 2024-2025" */}
          Année scolaire&nbsp;{academicYearLabel}
        </div>
      </div>

      {/* Bloc droit : logo + nom établissement */}
      <div className="flex flex-1 flex-col items-end gap-1">
        <div className="flex items-center gap-2">
          {s.institution_logo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={s.institution_logo_url}
              alt={s.institution_name}
              className="h-10 w-10 rounded border bg-white object-contain"
            />
          )}
          <div className="text-right">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-900">
              {s.institution_name}
            </div>
            {s.institution_postal_address && (
              <div className="text-[10px] text-slate-600">
                {s.institution_postal_address}
              </div>
            )}
          </div>
        </div>
        {(s.institution_phone || s.institution_email) && (
          <div className="text-[9px] text-slate-500">
            {s.institution_phone && <span>Tél. {s.institution_phone}</span>}
            {s.institution_phone && s.institution_email && " — "}
            {s.institution_email && <span>{s.institution_email}</span>}
          </div>
        )}
      </div>
    </header>
  );
}
