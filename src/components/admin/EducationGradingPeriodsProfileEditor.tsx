"use client";

import { useEffect, useMemo, useState } from "react";
import type { EducationType } from "@/lib/education-organization";
import type {
  EducationParameterProfile,
  ScopedGradingPeriod,
} from "@/lib/education-parameter-profiles";

type AcademicYearRow = {
  id: string;
  code: string;
  label: string;
  is_current: boolean;
};

type ProfileResponse = {
  ok?: boolean;
  error?: string;
  profile?: EducationParameterProfile;
};

function tempId() {
  return `temp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeCommonPeriods(rows: any[]): ScopedGradingPeriod[] {
  return rows.map((row, index) => ({
    id: String(row?.id || tempId()),
    code: String(row?.code || `P${index + 1}`),
    label: String(row?.label || `Période ${index + 1}`),
    short_label: String(row?.short_label || row?.label || `P${index + 1}`),
    kind: String(row?.kind || ""),
    start_date: row?.start_date ? String(row.start_date).slice(0, 10) : "",
    end_date: row?.end_date ? String(row.end_date).slice(0, 10) : "",
    order_index: index + 1,
    is_active: row?.is_active !== false,
    coeff: Number(row?.coeff ?? row?.weight ?? 1) || 1,
  }));
}

function preset(kind: "trimesters" | "semesters" | "compositions") {
  const labels =
    kind === "semesters"
      ? ["1er semestre", "2e semestre"]
      : kind === "compositions"
        ? ["1re composition", "2e composition", "3e composition"]
        : ["1er trimestre", "2e trimestre", "3e trimestre"];

  return labels.map((label, index): ScopedGradingPeriod => ({
    id: tempId(),
    code:
      kind === "semesters"
        ? `S${index + 1}`
        : kind === "compositions"
          ? `C${index + 1}`
          : `T${index + 1}`,
    label,
    short_label: label,
    kind:
      kind === "semesters"
        ? "semester"
        : kind === "compositions"
          ? "composition"
          : "trimester",
    start_date: "",
    end_date: "",
    order_index: index + 1,
    is_active: true,
    coeff: 1,
  }));
}

export default function EducationGradingPeriodsProfileEditor({
  educationType,
  educationLabel,
}: {
  educationType: EducationType;
  educationLabel: string;
}) {
  const [profile, setProfile] = useState<EducationParameterProfile | null>(null);
  const [academicYears, setAcademicYears] = useState<AcademicYearRow[]>([]);
  const [academicYear, setAcademicYear] = useState("");
  const [commonPeriods, setCommonPeriods] = useState<ScopedGradingPeriod[]>([]);
  const [periods, setPeriods] = useState<ScopedGradingPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void loadBase();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [educationType]);

  useEffect(() => {
    if (!academicYear || !profile) return;
    void loadPeriodsForYear(academicYear, profile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [academicYear]);

  async function loadBase() {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const [profileResponse, yearsResponse] = await Promise.all([
        fetch(
          `/api/admin/institution/education-parameter-profiles?education_type=${encodeURIComponent(
            educationType,
          )}`,
          { cache: "no-store" },
        ),
        fetch("/api/admin/institution/academic-years", { cache: "no-store" }),
      ]);
      const profilePayload = (await profileResponse.json().catch(() => ({}))) as ProfileResponse;
      const yearsPayload = await yearsResponse.json().catch(() => ({}));
      if (!profileResponse.ok || !profilePayload.ok || !profilePayload.profile) {
        throw new Error(profilePayload.error || "Impossible de charger le découpage spécifique.");
      }
      if (!yearsResponse.ok || !yearsPayload?.ok) {
        throw new Error(yearsPayload?.error || "Impossible de charger les années scolaires.");
      }

      const years: AcademicYearRow[] = (Array.isArray(yearsPayload.items) ? yearsPayload.items : []).map(
        (row: any) => ({
          id: String(row.id || row.code || ""),
          code: String(row.code || ""),
          label: String(row.label || row.code || "Année scolaire"),
          is_current: row.is_current === true,
        }),
      );
      const selected = years.find((row) => row.is_current)?.code || years[0]?.code || "";
      setAcademicYears(years);
      setProfile(profilePayload.profile);
      setAcademicYear(selected);
      if (selected) await loadPeriodsForYear(selected, profilePayload.profile);
    } catch (loadError: any) {
      setError(loadError?.message || "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }

  async function loadPeriodsForYear(year: string, currentProfile = profile) {
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/institution/grading-periods?academic_year=${encodeURIComponent(year)}`,
        { cache: "no-store" },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Impossible de charger les périodes communes.");
      }
      const common = normalizeCommonPeriods(Array.isArray(payload.items) ? payload.items : []);
      setCommonPeriods(common);
      const custom = currentProfile?.gradingPeriodsByAcademicYear?.[year] || [];
      setPeriods(custom.length > 0 ? custom : common);
    } catch (loadError: any) {
      setError(loadError?.message || "Chargement impossible.");
    }
  }

  const usesCommon = profile?.useCommonGradingPeriods !== false;
  const activeCount = useMemo(() => periods.filter((row) => row.is_active).length, [periods]);

  function startCustomization() {
    setPeriods(
      (profile?.gradingPeriodsByAcademicYear?.[academicYear] || []).length > 0
        ? profile!.gradingPeriodsByAcademicYear[academicYear]
        : commonPeriods,
    );
    setProfile((current) =>
      current ? { ...current, useCommonGradingPeriods: false } : current,
    );
  }

  function addPeriod() {
    setPeriods((current) => [
      ...current,
      {
        id: tempId(),
        code: `P${current.length + 1}`,
        label: `Période ${current.length + 1}`,
        short_label: `P${current.length + 1}`,
        kind: "",
        start_date: "",
        end_date: "",
        order_index: current.length + 1,
        is_active: true,
        coeff: 1,
      },
    ]);
  }

  function updatePeriod(id: string, patch: Partial<ScopedGradingPeriod>) {
    setPeriods((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function removePeriod(id: string) {
    setPeriods((current) =>
      current
        .filter((row) => row.id !== id)
        .map((row, index) => ({ ...row, order_index: index + 1 })),
    );
  }

  async function save(useCommon: boolean) {
    if (!profile || !academicYear) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(
        "/api/admin/institution/education-parameter-profiles",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            educationType,
            useCommonGradingPeriods: useCommon,
            academicYear,
            gradingPeriods: periods.map((row, index) => ({
              ...row,
              order_index: index + 1,
            })),
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as ProfileResponse;
      if (!response.ok || !payload.ok || !payload.profile) {
        throw new Error(payload.error || "Enregistrement impossible.");
      }
      setProfile(payload.profile);
      setPeriods(
        useCommon
          ? commonPeriods
          : payload.profile.gradingPeriodsByAcademicYear?.[academicYear] || periods,
      );
      setMessage(
        useCommon
          ? `${educationLabel} utilise de nouveau le découpage commun.`
          : `Découpage propre à ${educationLabel} enregistré pour ${academicYear}.`,
      );
    } catch (saveError: any) {
      setError(saveError?.message || "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="rounded-2xl border bg-white p-5 text-sm text-slate-500">Chargement…</div>;
  }

  if (!profile) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
        {error || "Découpage indisponible."}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <label className="block max-w-sm text-sm">
          <span className="mb-1 block text-xs font-semibold text-slate-500">Année scolaire</span>
          <select
            className="w-full rounded-xl border bg-white px-3 py-2"
            value={academicYear}
            onChange={(event) => setAcademicYear(event.target.value)}
          >
            {academicYears.map((row) => (
              <option key={row.code || row.id} value={row.code}>
                {row.label}{row.is_current ? " — courante" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      {usesCommon ? (
        <div className="rounded-3xl border border-sky-200 bg-sky-50 p-5">
          <div className="text-base font-black text-sky-950">
            {educationLabel} utilise le découpage commun
          </div>
          <p className="mt-2 text-sm leading-6 text-sky-800">
            Les périodes ci-dessous sont celles déjà définies pour tout l’établissement.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {commonPeriods.length > 0 ? commonPeriods.map((row) => (
              <span key={row.id} className="rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800">
                {row.label}
              </span>
            )) : <span className="text-sm text-sky-800">Aucune période commune définie.</span>}
          </div>
          <button
            type="button"
            onClick={startCustomization}
            className="mt-4 rounded-xl bg-sky-700 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-800"
          >
            Personnaliser le découpage de {educationLabel}
          </button>
        </div>
      ) : (
        <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-lg font-black text-slate-900">Découpage propre à {educationLabel}</div>
              <p className="mt-1 text-sm text-slate-600">
                {activeCount} période(s) active(s) pour {academicYear || "l’année sélectionnée"}.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setPeriods(preset("trimesters"))} className="rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-slate-50">3 trimestres</button>
              <button type="button" onClick={() => setPeriods(preset("semesters"))} className="rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-slate-50">2 semestres</button>
              <button type="button" onClick={() => setPeriods(preset("compositions"))} className="rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-slate-50">3 compositions</button>
            </div>
          </div>

          {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div> : null}
          {message ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</div> : null}

          <div className="space-y-3">
            {periods.map((row, index) => (
              <div key={row.id} className="grid gap-2 rounded-2xl border border-slate-200 p-3 md:grid-cols-12">
                <input className="rounded-xl border px-3 py-2 text-sm md:col-span-1" value={row.code} onChange={(e) => updatePeriod(row.id, { code: e.target.value })} placeholder="Code" />
                <input className="rounded-xl border px-3 py-2 text-sm md:col-span-3" value={row.label} onChange={(e) => updatePeriod(row.id, { label: e.target.value })} placeholder="Libellé" />
                <input className="rounded-xl border px-3 py-2 text-sm md:col-span-2" value={row.short_label} onChange={(e) => updatePeriod(row.id, { short_label: e.target.value })} placeholder="Bulletin" />
                <input type="date" className="rounded-xl border px-3 py-2 text-sm md:col-span-2" value={row.start_date} onChange={(e) => updatePeriod(row.id, { start_date: e.target.value })} />
                <input type="date" className="rounded-xl border px-3 py-2 text-sm md:col-span-2" value={row.end_date} onChange={(e) => updatePeriod(row.id, { end_date: e.target.value })} />
                <input type="number" min={0} step="0.1" className="rounded-xl border px-3 py-2 text-sm md:col-span-1" value={row.coeff} onChange={(e) => updatePeriod(row.id, { coeff: Math.max(0, Number(e.target.value || 1)) })} title="Coefficient" />
                <button type="button" onClick={() => removePeriod(row.id)} className="rounded-xl border border-rose-200 bg-rose-50 px-2 py-2 text-sm font-semibold text-rose-700 md:col-span-1" title={`Supprimer ${index + 1}`}>×</button>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <button type="button" onClick={addPeriod} className="rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-slate-50">+ Ajouter une période</button>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void save(true)} disabled={saving} className="rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60">Revenir au découpage commun</button>
              <button type="button" onClick={() => void save(false)} disabled={saving || !academicYear} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">{saving ? "Enregistrement…" : "Enregistrer ce découpage"}</button>
            </div>
          </div>

          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
            Ce découpage est désormais utilisé automatiquement par le cahier de notes pour les classes de cet enseignement. Les périodes communes du secondaire général restent inchangées.
          </div>
        </div>
      )}
    </div>
  );
}
