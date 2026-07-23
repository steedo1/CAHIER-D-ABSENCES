"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  BookOpenCheck,
  Check,
  ChevronRight,
  CircleAlert,
  GraduationCap,
  Loader2,
  Plus,
  Save,
  School,
  Trash2,
  Wrench,
} from "lucide-react";
import {
  EDUCATION_TYPE_OPTIONS,
  FORMATION_CATALOG,
  RELIABILITY_LABELS,
  type CustomFormation,
  type EducationOrganizationSettings,
  type EducationType,
  type FormationReliability,
} from "@/lib/education-organization";

type ApiResponse = {
  ok: boolean;
  error?: string;
  institution?: { id: string; name: string; code: string };
  hasExistingClasses?: boolean;
  organization?: EducationOrganizationSettings;
};

type ValueChangeEvent = { target: { value: string } };

type CustomDraft = {
  educationType: Exclude<EducationType, "general_secondary">;
  diplomaCode: string;
  diplomaLabel: string;
  name: string;
  shortCode: string;
  levelsText: string;
};

const EMPTY_DRAFT: CustomDraft = {
  educationType: "vocational_training",
  diplomaCode: "AUTRE",
  diplomaLabel: "Autre diplôme ou certificat",
  name: "",
  shortCode: "",
  levelsText: "1re année\n2e année",
};

const RELIABILITY_STYLES: Record<FormationReliability, string> = {
  verified: "border-emerald-200 bg-emerald-50 text-emerald-800",
  documented: "border-sky-200 bg-sky-50 text-sky-800",
  partial: "border-amber-200 bg-amber-50 text-amber-800",
  to_document: "border-slate-200 bg-slate-100 text-slate-700",
};

function normalizeKey(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function errorMessage(code?: string) {
  switch (code) {
    case "education_type_required":
      return "Sélectionnez au moins un type d’enseignement.";
    case "formation_required_for_education_type":
      return "Choisissez ou créez au moins une formation pour chaque enseignement technique, professionnel ou BTS sélectionné.";
    case "invalid_catalog_formation":
      return "Une formation sélectionnée ne correspond plus au catalogue disponible.";
    case "forbidden":
      return "Votre rôle ne permet pas de modifier cette organisation.";
    case "unauthorized":
      return "Votre session a expiré. Reconnectez-vous.";
    default:
      return code || "Une erreur est survenue.";
  }
}

function groupCatalogByDiploma(educationType: EducationType) {
  const groups = new Map<string, typeof FORMATION_CATALOG>();

  for (const item of FORMATION_CATALOG.filter(
    (formation) => formation.educationType === educationType,
  )) {
    const list = groups.get(item.diplomaLabel) || [];
    list.push(item);
    groups.set(item.diplomaLabel, list);
  }

  return Array.from(groups.entries());
}

export default function OrganisationPedagogiquePage() {
  const [institution, setInstitution] = useState<ApiResponse["institution"]>();
  const [hasExistingClasses, setHasExistingClasses] = useState(false);
  const [educationTypes, setEducationTypes] = useState<EducationType[]>([]);
  const [selectedCatalogIds, setSelectedCatalogIds] = useState<string[]>([]);
  const [customFormations, setCustomFormations] = useState<CustomFormation[]>([]);
  const [configuredAt, setConfiguredAt] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [customOpen, setCustomOpen] = useState(false);
  const [draft, setDraft] = useState<CustomDraft>(EMPTY_DRAFT);
  const [customError, setCustomError] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/institution/education-organization", {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as ApiResponse;

      if (!response.ok || !payload.ok || !payload.organization) {
        throw new Error(errorMessage(payload.error));
      }

      setInstitution(payload.institution);
      setHasExistingClasses(payload.hasExistingClasses === true);
      setEducationTypes(payload.organization.educationTypes || []);
      setSelectedCatalogIds(payload.organization.selectedCatalogFormationIds || []);
      setCustomFormations(payload.organization.customFormations || []);
      setConfiguredAt(payload.organization.configuredAt || null);
    } catch (loadError: any) {
      setError(loadError?.message || "Impossible de charger l’organisation pédagogique.");
    } finally {
      setLoading(false);
    }
  }

  function toggleEducationType(type: EducationType) {
    setSaved(false);
    setEducationTypes((current) => {
      const enabled = current.includes(type);
      const next = enabled ? current.filter((item) => item !== type) : [...current, type];

      if (enabled && type !== "general_secondary") {
        const catalogIdsForType = new Set(
          FORMATION_CATALOG.filter((item) => item.educationType === type).map(
            (item) => item.id,
          ),
        );
        setSelectedCatalogIds((ids) => ids.filter((id) => !catalogIdsForType.has(id)));
        setCustomFormations((items) => items.filter((item) => item.educationType !== type));
      }

      return next;
    });
  }

  function toggleCatalogFormation(id: string) {
    setSaved(false);
    setSelectedCatalogIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  function openCustomForm(educationType?: EducationType) {
    const allowedType =
      educationType && educationType !== "general_secondary"
        ? educationType
        : educationTypes.find((type) => type !== "general_secondary") ||
          "vocational_training";

    setDraft({ ...EMPTY_DRAFT, educationType: allowedType });
    setCustomError(null);
    setCustomOpen(true);
  }

  function addCustomFormation() {
    const name = draft.name.trim();
    if (!name) {
      setCustomError("Renseignez le nom de la formation.");
      return;
    }

    if (!educationTypes.includes(draft.educationType)) {
      setCustomError("Activez d’abord le type d’enseignement correspondant.");
      return;
    }

    const levels = draft.levelsText
      .split(/\r?\n|,|;/)
      .map((item) => item.trim())
      .filter(Boolean)
      .filter((item, index, array) => array.indexOf(item) === index)
      .slice(0, 12);

    const signature = `${draft.educationType}:${draft.diplomaCode}:${name}`.toLocaleLowerCase("fr");
    const duplicate = customFormations.some(
      (item) =>
        `${item.educationType}:${item.diplomaCode}:${item.name}`.toLocaleLowerCase("fr") ===
        signature,
    );

    if (duplicate) {
      setCustomError("Cette formation locale existe déjà.");
      return;
    }

    const id = `local_${Date.now()}_${normalizeKey(name) || "formation"}`;
    const next: CustomFormation = {
      id,
      educationType: draft.educationType,
      diplomaCode: draft.diplomaCode.trim().toUpperCase() || "AUTRE",
      diplomaLabel: draft.diplomaLabel.trim() || "Autre diplôme ou certificat",
      name,
      shortCode: draft.shortCode.trim().toUpperCase(),
      levels,
      createdAt: new Date().toISOString(),
    };

    setCustomFormations((current) => [...current, next]);
    setSaved(false);
    setCustomOpen(false);
  }

  function removeCustomFormation(id: string) {
    setCustomFormations((current) => current.filter((item) => item.id !== id));
    setSaved(false);
  }

  const nonGeneralEducationTypes = educationTypes.filter(
    (type) => type !== "general_secondary",
  );

  const missingFormationTypes = useMemo(
    () =>
      nonGeneralEducationTypes.filter((type) => {
        const hasCatalog = FORMATION_CATALOG.some(
          (item) => item.educationType === type && selectedCatalogIds.includes(item.id),
        );
        const hasCustom = customFormations.some((item) => item.educationType === type);
        return !hasCatalog && !hasCustom;
      }),
    [customFormations, nonGeneralEducationTypes, selectedCatalogIds],
  );

  const selectedCatalogFormations = useMemo(
    () => FORMATION_CATALOG.filter((item) => selectedCatalogIds.includes(item.id)),
    [selectedCatalogIds],
  );

  const canSave = educationTypes.length > 0 && missingFormationTypes.length === 0;

  async function save() {
    if (!canSave) {
      setError(
        educationTypes.length === 0
          ? "Sélectionnez au moins un type d’enseignement."
          : "Choisissez ou créez au moins une formation pour chaque type d’enseignement sélectionné.",
      );
      return;
    }

    setSaving(true);
    setSaved(false);
    setError(null);

    try {
      const response = await fetch("/api/admin/institution/education-organization", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          educationTypes,
          selectedCatalogFormationIds: selectedCatalogIds,
          customFormations,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as ApiResponse;

      if (!response.ok || !payload.ok || !payload.organization) {
        throw new Error(errorMessage(payload.error));
      }

      setEducationTypes(payload.organization.educationTypes);
      setSelectedCatalogIds(payload.organization.selectedCatalogFormationIds);
      setCustomFormations(payload.organization.customFormations);
      setConfiguredAt(payload.organization.configuredAt || null);
      setSaved(true);
    } catch (saveError: any) {
      setError(saveError?.message || "Impossible d’enregistrer l’organisation pédagogique.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="grid min-h-[55vh] place-items-center">
        <div className="flex items-center gap-3 text-sm text-slate-600">
          <Loader2 className="h-5 w-5 animate-spin" />
          Chargement de l’organisation pédagogique…
        </div>
      </div>
    );
  }

  return (
    <main className="w-full min-w-0 space-y-4 overflow-x-hidden px-3 py-4 sm:px-4 lg:px-5">
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="bg-gradient-to-r from-sky-700 via-cyan-700 to-emerald-700 px-4 py-4 text-white sm:px-5">
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-sky-100">
                <School className="h-4 w-4" /> Organisation scolaire
              </div>
              <h1 className="text-xl font-bold sm:text-2xl">Organisation pédagogique</h1>
              <p className="mt-1 max-w-4xl text-sm leading-5 text-sky-50">
                Déclarez les enseignements et les formations réellement proposés par votre établissement.
                Mon Cahier utilisera ensuite cette organisation pour adapter progressivement les interfaces existantes.
              </p>
            </div>
            <div className="w-full shrink-0 rounded-xl bg-white/10 px-3 py-2 text-xs backdrop-blur sm:w-auto sm:min-w-52">
              <div className="font-semibold">{institution?.name || "Votre établissement"}</div>
              {institution?.code ? <div className="mt-1 text-sky-100">Code : {institution.code}</div> : null}
            </div>
          </div>
        </div>

      </section>

      {error ? (
        <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <CircleAlert className="mt-0.5 h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {saved ? (
        <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <BadgeCheck className="mt-0.5 h-5 w-5 shrink-0" />
          <span>L’organisation pédagogique a été enregistrée sans modifier les classes existantes.</span>
        </div>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex items-start gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-sky-100 text-sky-700">
            <span className="font-bold">1</span>
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">Types d’enseignement</h2>
            <p className="mt-1 text-sm text-slate-600">
              Cochez indépendamment chaque enseignement proposé. Un établissement peut être général,
              technique, professionnel, mixte ou accueillir également un cycle BTS.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {EDUCATION_TYPE_OPTIONS.map((option) => {
            const selected = educationTypes.includes(option.id);
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => toggleEducationType(option.id)}
                aria-pressed={selected}
                className={`min-w-0 rounded-xl border p-3.5 text-left transition ${
                  selected
                    ? "border-sky-500 bg-sky-50 ring-2 ring-sky-100"
                    : "border-slate-200 bg-white hover:border-sky-300 hover:bg-slate-50"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md border ${
                      selected
                        ? "border-sky-600 bg-sky-600 text-white"
                        : "border-slate-300 bg-white text-transparent"
                    }`}
                  >
                    <Check className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-semibold text-slate-900">{option.label}</div>
                    </div>
                    <p className="mt-1 text-sm leading-6 text-slate-600">{option.description}</p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {nonGeneralEducationTypes.length > 0 ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex items-start gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-cyan-100 text-cyan-700">
              <span className="font-bold">2</span>
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-bold text-slate-900">Formations disponibles</h2>
              <p className="mt-1 text-sm text-slate-600">
                Sélectionnez les formations réellement ouvertes dans l’établissement. Les badges indiquent
                le niveau actuel de documentation ; aucune matière ni aucun coefficient incomplet ne sera inventé.
              </p>
            </div>
          </div>

          <div className="mt-5 space-y-5">
            {nonGeneralEducationTypes.map((educationType) => {
              const typeOption = EDUCATION_TYPE_OPTIONS.find((item) => item.id === educationType);
              const groups = groupCatalogByDiploma(educationType);
              const localItems = customFormations.filter(
                (item) => item.educationType === educationType,
              );

              return (
                <div key={educationType} className="min-w-0 rounded-xl border border-slate-200 p-3.5 sm:p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="font-bold text-slate-900">{typeOption?.label}</h3>
                      <p className="mt-1 text-sm text-slate-500">
                        Cochez au moins une formation ou créez une formation propre à l’établissement.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => openCustomForm(educationType)}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-sky-300 bg-white px-3 py-2 text-sm font-semibold text-sky-800 hover:bg-sky-50"
                    >
                      <Plus className="h-4 w-4" /> Créer une formation
                    </button>
                  </div>

                  <div className="mt-5 space-y-5">
                    {groups.map(([diploma, formations]) => (
                      <div key={diploma}>
                        <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                          {diploma}
                        </div>
                        <div className="grid min-w-0 gap-3 xl:grid-cols-2">
                          {formations.map((formation) => {
                            const selected = selectedCatalogIds.includes(formation.id);
                            return (
                              <button
                                key={formation.id}
                                type="button"
                                onClick={() => toggleCatalogFormation(formation.id)}
                                className={`min-w-0 rounded-xl border p-3.5 text-left transition ${
                                  selected
                                    ? "border-cyan-500 bg-cyan-50 ring-2 ring-cyan-100"
                                    : "border-slate-200 hover:border-cyan-300 hover:bg-slate-50"
                                }`}
                              >
                                <div className="flex items-start gap-3">
                                  <div
                                    className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md border ${
                                      selected
                                        ? "border-cyan-600 bg-cyan-600 text-white"
                                        : "border-slate-300 text-transparent"
                                    }`}
                                  >
                                    <Check className="h-4 w-4" />
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="font-semibold text-slate-900">{formation.name}</span>
                                      <span
                                        className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                                          RELIABILITY_STYLES[formation.reliability]
                                        }`}
                                      >
                                        {RELIABILITY_LABELS[formation.reliability]}
                                      </span>
                                    </div>
                                    <div className="mt-1 text-xs font-medium text-slate-500">
                                      Code proposé : {formation.shortCode}
                                    </div>
                                    {formation.note ? (
                                      <p className="mt-2 text-xs leading-5 text-slate-600">{formation.note}</p>
                                    ) : null}
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>

                  {localItems.length > 0 ? (
                    <div className="mt-5 border-t border-slate-200 pt-5">
                      <div className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">
                        Formations locales
                      </div>
                      <div className="grid min-w-0 gap-3 xl:grid-cols-2">
                        {localItems.map((item) => (
                          <div key={item.id} className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-semibold text-slate-900">{item.name}</span>
                                  <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-800">
                                    Formation locale
                                  </span>
                                </div>
                                <div className="mt-1 text-xs text-slate-600">
                                  {item.diplomaLabel}
                                  {item.shortCode ? ` • ${item.shortCode}` : ""}
                                </div>
                                {item.levels.length > 0 ? (
                                  <div className="mt-2 text-xs text-slate-600">
                                    Niveaux : {item.levels.join(" • ")}
                                  </div>
                                ) : null}
                              </div>
                              <button
                                type="button"
                                title="Retirer cette formation locale"
                                onClick={() => removeCustomFormation(item.id)}
                                className="rounded-lg p-2 text-rose-600 hover:bg-rose-100"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          {missingFormationTypes.length > 0 ? (
            <div className="mt-5 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <CircleAlert className="mt-0.5 h-5 w-5 shrink-0" />
              <span>
                Une formation doit encore être choisie ou créée pour :{" "}
                {missingFormationTypes
                  .map(
                    (type) =>
                      EDUCATION_TYPE_OPTIONS.find((item) => item.id === type)?.label || type,
                  )
                  .join(", ")}.
              </span>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex items-start gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-700">
            <span className="font-bold">3</span>
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">Synthèse avant enregistrement</h2>
            <p className="mt-1 text-sm text-slate-600">
              Cette opération enregistre uniquement l’organisation. Elle ne renomme aucune classe et ne modifie
              aucune matière, note, moyenne ou bulletin existant.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <GraduationCap className="h-4 w-4 text-sky-700" /> Enseignements
            </div>
            <div className="mt-3 space-y-2 text-sm text-slate-700">
              {educationTypes.length > 0 ? (
                educationTypes.map((type) => (
                  <div key={type} className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-600" />
                    {EDUCATION_TYPE_OPTIONS.find((item) => item.id === type)?.label || type}
                  </div>
                ))
              ) : (
                <div className="text-amber-700">Aucun enseignement sélectionné.</div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <BookOpenCheck className="h-4 w-4 text-cyan-700" /> Formations du catalogue
            </div>
            <div className="mt-3 text-3xl font-bold text-slate-900">
              {selectedCatalogFormations.length}
            </div>
            <div className="mt-1 text-xs text-slate-500">formation(s) sélectionnée(s)</div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Wrench className="h-4 w-4 text-violet-700" /> Formations locales
            </div>
            <div className="mt-3 text-3xl font-bold text-slate-900">{customFormations.length}</div>
            <div className="mt-1 text-xs text-slate-500">formation(s) créée(s) par l’établissement</div>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-slate-500">
            {configuredAt
              ? `Configuration initiale enregistrée le ${new Date(configuredAt).toLocaleDateString("fr-FR")}.`
              : hasExistingClasses
                ? "Le secondaire général existant est reconnu automatiquement."
                : "Cette configuration doit être faite avant la création guidée des premières classes."}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={save}
              disabled={!canSave || saving}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Enregistrer l’organisation
            </button>
            <Link
              href="/admin/classes"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Créer vos classes <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {customOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
            <div className="border-b border-slate-200 px-5 py-4 sm:px-6">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-2xl bg-violet-100 text-violet-700">
                  <Plus className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900">Créer une formation locale</h3>
                  <p className="text-sm text-slate-500">Elle restera propre à cet établissement.</p>
                </div>
              </div>
            </div>

            <div className="space-y-4 px-5 py-5 sm:px-6">
              {customError ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                  {customError}
                </div>
              ) : null}

              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-slate-700">Type d’enseignement</span>
                <select
                  value={draft.educationType}
                  onChange={(event: ValueChangeEvent) =>
                    setDraft((current) => ({
                      ...current,
                      educationType: event.target.value as CustomDraft["educationType"],
                    }))
                  }
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"
                >
                  {nonGeneralEducationTypes.map((type) => (
                    <option key={type} value={type}>
                      {EDUCATION_TYPE_OPTIONS.find((item) => item.id === type)?.label || type}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-sm font-semibold text-slate-700">Diplôme ou certificat</span>
                  <input
                    value={draft.diplomaLabel}
                    onChange={(event: ValueChangeEvent) =>
                      setDraft((current) => ({ ...current, diplomaLabel: event.target.value }))
                    }
                    className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
                    placeholder="Ex. Brevet de technicien"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm font-semibold text-slate-700">Code du diplôme</span>
                  <input
                    value={draft.diplomaCode}
                    onChange={(event: ValueChangeEvent) =>
                      setDraft((current) => ({ ...current, diplomaCode: event.target.value }))
                    }
                    className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm uppercase"
                    placeholder="Ex. BT"
                  />
                </label>
              </div>

              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-slate-700">Nom de la formation ou filière</span>
                <input
                  value={draft.name}
                  onChange={(event: ValueChangeEvent) => setDraft((current) => ({ ...current, name: event.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
                  placeholder="Ex. Installation et maintenance solaire"
                  autoFocus
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-slate-700">Code court proposé</span>
                <input
                  value={draft.shortCode}
                  onChange={(event: ValueChangeEvent) =>
                    setDraft((current) => ({ ...current, shortCode: event.target.value }))
                  }
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm uppercase"
                  placeholder="Ex. IMS"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-slate-700">
                  Niveaux proposés — un par ligne
                </span>
                <textarea
                  value={draft.levelsText}
                  onChange={(event: ValueChangeEvent) =>
                    setDraft((current) => ({ ...current, levelsText: event.target.value }))
                  }
                  rows={5}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
                  placeholder={"1re année\n2e année\n3e année"}
                />
                <span className="mt-1 block text-xs text-slate-500">
                  Ces libellés pourront être ajustés lors de l’adaptation de la création des classes.
                </span>
              </label>
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-slate-200 px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
              <button
                type="button"
                onClick={() => setCustomOpen(false)}
                className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={addCustomFormation}
                className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-700"
              >
                Ajouter la formation
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
