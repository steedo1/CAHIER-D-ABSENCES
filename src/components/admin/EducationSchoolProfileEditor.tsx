"use client";

import { useEffect, useState } from "react";
import type { EducationType } from "@/lib/education-organization";
import {
  EMPTY_SCOPED_INSTITUTION_SETTINGS,
  type EducationParameterProfile,
  type ScopedInstitutionSettings,
} from "@/lib/education-parameter-profiles";

type ApiResponse = {
  ok?: boolean;
  error?: string;
  profile?: EducationParameterProfile;
};

function copyCommonSettings(value: any): ScopedInstitutionSettings {
  return {
    tz: String(value?.tz || "Africa/Abidjan"),
    auto_lateness: value?.auto_lateness !== false,
    default_session_minutes: Math.max(1, Number(value?.default_session_minutes || 60)),
    institution_region: String(value?.institution_region || ""),
    institution_status: String(value?.institution_status || ""),
    institution_head_name: String(value?.institution_head_name || ""),
    institution_head_title: String(value?.institution_head_title || ""),
    country_name: String(value?.country_name || ""),
    country_motto: String(value?.country_motto || ""),
    ministry_name: String(value?.ministry_name || ""),
    institution_code: String(value?.institution_code || ""),
  };
}

export default function EducationSchoolProfileEditor({
  educationType,
  educationLabel,
}: {
  educationType: EducationType;
  educationLabel: string;
}) {
  const [profile, setProfile] = useState<EducationParameterProfile | null>(null);
  const [commonSettings, setCommonSettings] = useState<ScopedInstitutionSettings>(
    EMPTY_SCOPED_INSTITUTION_SETTINGS,
  );
  const [settings, setSettings] = useState<ScopedInstitutionSettings>(
    EMPTY_SCOPED_INSTITUTION_SETTINGS,
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [educationType]);

  async function load() {
    setLoading(true);
    setMessage(null);
    setError(null);
    try {
      const [profileResponse, commonResponse] = await Promise.all([
        fetch(
          `/api/admin/institution/education-parameter-profiles?education_type=${encodeURIComponent(
            educationType,
          )}`,
          { cache: "no-store" },
        ),
        fetch("/api/admin/institution/settings", { cache: "no-store" }),
      ]);
      const profilePayload = (await profileResponse.json().catch(() => ({}))) as ApiResponse;
      const commonPayload = await commonResponse.json().catch(() => ({}));
      if (!profileResponse.ok || !profilePayload.ok || !profilePayload.profile) {
        throw new Error(profilePayload.error || "Impossible de charger les paramètres spécifiques.");
      }
      if (!commonResponse.ok) {
        throw new Error(commonPayload?.error || "Impossible de charger les paramètres communs.");
      }

      const copiedCommon = copyCommonSettings(commonPayload);
      setCommonSettings(copiedCommon);
      setProfile(profilePayload.profile);
      setSettings(profilePayload.profile.institutionSettings || copiedCommon);
    } catch (loadError: any) {
      setError(loadError?.message || "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }

  async function save(nextUseCommon?: boolean) {
    if (!profile) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    const useCommon =
      typeof nextUseCommon === "boolean"
        ? nextUseCommon
        : profile.useCommonInstitutionSettings;

    try {
      const response = await fetch(
        "/api/admin/institution/education-parameter-profiles",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            educationType,
            useCommonInstitutionSettings: useCommon,
            institutionSettings: settings,
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as ApiResponse;
      if (!response.ok || !payload.ok || !payload.profile) {
        throw new Error(payload.error || "Enregistrement impossible.");
      }
      setProfile(payload.profile);
      setSettings(payload.profile.institutionSettings || commonSettings);
      setMessage(
        useCommon
          ? `${educationLabel} utilise de nouveau les paramètres communs.`
          : `Paramètres spécifiques de ${educationLabel} enregistrés.`,
      );
    } catch (saveError: any) {
      setError(saveError?.message || "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  function startCustomization() {
    setSettings(profile?.institutionSettings || commonSettings);
    setProfile((current) =>
      current ? { ...current, useCommonInstitutionSettings: false } : current,
    );
  }

  if (loading) {
    return <div className="rounded-2xl border bg-white p-5 text-sm text-slate-500">Chargement…</div>;
  }

  if (!profile) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
        {error || "Paramètres indisponibles."}
      </div>
    );
  }

  if (profile.useCommonInstitutionSettings) {
    return (
      <div className="rounded-3xl border border-sky-200 bg-sky-50 p-5">
        <div className="text-base font-black text-sky-950">
          {educationLabel} utilise les paramètres communs
        </div>
        <p className="mt-2 text-sm leading-6 text-sky-800">
          Le ministère, la direction de tutelle, le code administratif et les paramètres horaires
          restent ceux définis dans « Commun à tous ».
        </p>
        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl bg-white/80 p-3">
            <div className="text-xs font-semibold text-slate-500">Ministère</div>
            <div className="mt-1 font-medium text-slate-800">{commonSettings.ministry_name || "Non renseigné"}</div>
          </div>
          <div className="rounded-xl bg-white/80 p-3">
            <div className="text-xs font-semibold text-slate-500">Direction / région</div>
            <div className="mt-1 font-medium text-slate-800">{commonSettings.institution_region || "Non renseignée"}</div>
          </div>
          <div className="rounded-xl bg-white/80 p-3">
            <div className="text-xs font-semibold text-slate-500">Durée de séance</div>
            <div className="mt-1 font-medium text-slate-800">{commonSettings.default_session_minutes} min</div>
          </div>
        </div>
        <button
          type="button"
          onClick={startCustomization}
          className="mt-4 rounded-xl bg-sky-700 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-800"
        >
          Personnaliser pour {educationLabel}
        </button>
      </div>
    );
  }

  const update = <K extends keyof ScopedInstitutionSettings>(
    key: K,
    value: ScopedInstitutionSettings[K],
  ) => setSettings((current) => ({ ...current, [key]: value }));

  return (
    <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-lg font-black text-slate-900">Paramètres propres à {educationLabel}</div>
          <p className="mt-1 text-sm text-slate-600">
            Ces valeurs remplacent uniquement les informations officielles communes pour cet enseignement.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void save(true)}
          disabled={saving}
          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          Revenir aux paramètres communs
        </button>
      </div>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div> : null}
      {message ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</div> : null}

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold text-slate-500">Ministère / tutelle</span>
          <input className="w-full rounded-xl border px-3 py-2" value={settings.ministry_name} onChange={(e) => update("ministry_name", e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold text-slate-500">Direction régionale / direction de tutelle</span>
          <input className="w-full rounded-xl border px-3 py-2" value={settings.institution_region} onChange={(e) => update("institution_region", e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold text-slate-500">Code administratif</span>
          <input className="w-full rounded-xl border px-3 py-2" value={settings.institution_code} onChange={(e) => update("institution_code", e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold text-slate-500">Nom du responsable</span>
          <input className="w-full rounded-xl border px-3 py-2" value={settings.institution_head_name} onChange={(e) => update("institution_head_name", e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold text-slate-500">Fonction du responsable</span>
          <input className="w-full rounded-xl border px-3 py-2" value={settings.institution_head_title} onChange={(e) => update("institution_head_title", e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold text-slate-500">Statut / nature</span>
          <input className="w-full rounded-xl border px-3 py-2" value={settings.institution_status} onChange={(e) => update("institution_status", e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold text-slate-500">Pays</span>
          <input className="w-full rounded-xl border px-3 py-2" value={settings.country_name} onChange={(e) => update("country_name", e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold text-slate-500">Devise nationale</span>
          <input className="w-full rounded-xl border px-3 py-2" value={settings.country_motto} onChange={(e) => update("country_motto", e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold text-slate-500">Fuseau horaire</span>
          <select className="w-full rounded-xl border bg-white px-3 py-2" value={settings.tz} onChange={(e) => update("tz", e.target.value)}>
            <option value="Africa/Abidjan">Africa/Abidjan (UTC+0)</option>
            <option value="Africa/Lagos">Africa/Lagos (UTC+1)</option>
            <option value="Africa/Dakar">Africa/Dakar (UTC+0)</option>
            <option value="UTC">UTC</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold text-slate-500">Durée par séance (minutes)</span>
          <input type="number" min={1} className="w-full rounded-xl border px-3 py-2" value={settings.default_session_minutes} onChange={(e) => update("default_session_minutes", Math.max(1, Number(e.target.value || 60)))} />
        </label>
        <label className="flex items-end gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm">
          <input type="checkbox" checked={settings.auto_lateness} onChange={(e) => update("auto_lateness", e.target.checked)} />
          Calcul automatique des retards
        </label>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void save(false)}
          disabled={saving}
          className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {saving ? "Enregistrement…" : "Enregistrer ces paramètres"}
        </button>
      </div>
    </div>
  );
}
